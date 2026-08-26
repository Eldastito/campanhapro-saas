/**
 * LinkedInAdapter — wrapper para `src/lib/socialSyncLinkedIn.ts`.
 * Mesmo padrão do XAdapter (§11 do PRD).
 *
 * Diferença estrutural: LinkedIn expõe múltiplas organizações admin. O
 * `NormalizedSocialProfile` aqui reflete o USUÁRIO (OIDC userinfo). Métricas
 * de followers estão nas organizações — normalização per-organization entra
 * com Ingestion Engine.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchLinkedInSnapshot as realFetchLinkedInSnapshot,
  refreshLinkedInToken as realRefreshLinkedInToken,
  type LiSnapshot,
  type LiTokenResponse,
} from '../../../../lib/socialSyncLinkedIn.js';
import type {
  SocialProviderAdapter,
  ConnectInput,
  ConnectionResult,
  NormalizedSocialProfile,
  NormalizedSocialPost,
  NormalizedSocialComment,
  NormalizedSocialMetrics,
  GetPostsParams,
  GetCommentsParams,
  MetricsParams,
} from '../contracts/socialProviderAdapter.js';
import type { SocialProviderCapabilitySnapshot } from '../contracts/socialCapabilities.js';
import { getCapabilities as capsFromRegistry } from '../capabilityRegistry.js';
import {
  revealTokens,
  updateTokensAfterRefresh,
  markRevoked,
} from '../socialCredentialService.js';
import { resolveConnection } from './resolveConnection.js';
import { SocialCapabilityNotAvailableError, SocialConnectionNotFoundError } from './errors.js';

export interface LinkedInAdapterDeps {
  fetchProfile?: (accessToken: string) => Promise<LiSnapshot>;
  refreshToken?: (opts: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }) => Promise<LiTokenResponse>;
}

interface RefreshCredentials {
  clientId?: string;
  clientSecret?: string;
}

export function createLinkedInAdapter(
  supabase: SupabaseClient,
  deps: LinkedInAdapterDeps = {},
  refreshCredentials: RefreshCredentials = {
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
  },
): SocialProviderAdapter {
  const fetchProfile = deps.fetchProfile ?? realFetchLinkedInSnapshot;
  const refreshTokenFn = deps.refreshToken ?? realRefreshLinkedInToken;

  return {
    provider: 'linkedin',

    getCapabilities(): SocialProviderCapabilitySnapshot {
      return capsFromRegistry('linkedin');
    },

    async connect(_input: ConnectInput): Promise<ConnectionResult> {
      throw new SocialCapabilityNotAvailableError(
        'linkedin', 'profileRead', 'not_configured',
        'Use POST /api/v1/social/connect/linkedin/start; wiring pelo adapter entra em PR futuro.',
      );
    },

    async disconnect(connectionId: string): Promise<void> {
      const { campaignId } = await resolveConnection(supabase, 'linkedin', connectionId);
      await markRevoked(supabase, campaignId, 'linkedin');
    },

    async refreshCredentials(connectionId: string): Promise<void> {
      const { campaignId } = await resolveConnection(supabase, 'linkedin', connectionId);
      const tokens = await revealTokens(supabase, campaignId, 'linkedin');
      if (!tokens) throw new SocialConnectionNotFoundError('linkedin', connectionId);
      if (!tokens.refreshToken) {
        throw new SocialCapabilityNotAvailableError(
          'linkedin', 'profileRead', 'permission_required',
          'Conexão LinkedIn sem refresh_token — reautorize.',
        );
      }
      if (!refreshCredentials.clientId || !refreshCredentials.clientSecret) {
        throw new SocialCapabilityNotAvailableError(
          'linkedin', 'profileRead', 'not_configured',
          'LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET ausentes no server.',
        );
      }
      const next = await refreshTokenFn({
        clientId: refreshCredentials.clientId,
        clientSecret: refreshCredentials.clientSecret,
        refreshToken: tokens.refreshToken,
      });
      await updateTokensAfterRefresh(supabase, campaignId, 'linkedin', {
        accessToken: next.access_token,
        refreshToken: next.refresh_token ?? tokens.refreshToken,
        expiresAt: new Date(Date.now() + next.expires_in * 1000),
      });
    },

    async getProfile(connectionId: string): Promise<NormalizedSocialProfile> {
      const { campaignId } = await resolveConnection(supabase, 'linkedin', connectionId);
      const tokens = await revealTokens(supabase, campaignId, 'linkedin');
      if (!tokens) throw new SocialConnectionNotFoundError('linkedin', connectionId);

      const snap = await fetchProfile(tokens.accessToken);
      const totalFollowers = snap.organizations.reduce(
        (s, o) => s + (o.followers || 0),
        0,
      );
      return {
        provider: 'linkedin',
        externalId: snap.profile.id,
        displayName: snap.profile.name,
        handle: undefined, // LinkedIn não tem @handle; devolvemos undefined
        bio: snap.profile.headline ?? undefined,
        // Se o usuário não administra nenhuma organização, somamos 0 — mas
        // isso NÃO é `null`. Só é `null` quando NÃO conseguimos consultar.
        // §20/§103 do PRD: null ≠ 0. Aqui é 0 legítimo (nenhuma org).
        followers: snap.organizations.length === 0 ? null : totalFollowers,
        following: null, // OIDC userinfo não expõe following
        postsCount: null, // idem
        avatarUrl: snap.profile.pictureUrl ?? undefined,
        raw: snap.raw,
      };
    },

    async getPosts(_connectionId: string, _params?: GetPostsParams): Promise<NormalizedSocialPost[]> {
      throw new SocialCapabilityNotAvailableError(
        'linkedin', 'postsRead', capsFromRegistry('linkedin').capabilities.postsRead,
        'sharePosts sempre `[]` no tier atual — depende de Marketing Developer approval.',
      );
    },

    async getComments(_connectionId: string, _params?: GetCommentsParams): Promise<NormalizedSocialComment[]> {
      throw new SocialCapabilityNotAvailableError(
        'linkedin', 'ownCommentsRead', capsFromRegistry('linkedin').capabilities.ownCommentsRead,
      );
    },

    async getMetrics(_connectionId: string, _params?: MetricsParams): Promise<NormalizedSocialMetrics> {
      throw new SocialCapabilityNotAvailableError(
        'linkedin', 'metricsRead', 'not_configured',
        'Normalização de métricas entra com PR 6 (Ingestion Engine).',
      );
    },
  };
}
