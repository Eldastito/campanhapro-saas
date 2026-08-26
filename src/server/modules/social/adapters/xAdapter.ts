/**
 * XAdapter — wrapper para `src/lib/socialSyncX.ts` que implementa o
 * `SocialProviderAdapter` (§11 do PRD).
 *
 * NÃO toca em nenhum caminho vivo. O `socialSyncRunner.ts` atual continua
 * chamando `fetchXSnapshot` diretamente — este adapter existe como um path
 * paralelo que futuras fatias (PR 5 do Publisher, migração do runner) vão
 * consumir. Nenhuma regressão de comportamento.
 *
 * Dependências (`XAdapterDeps`) são injetáveis para tornar o adapter
 * testável sem tocar em rede — o default aponta para os módulos reais.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchXSnapshot as realFetchXSnapshot,
  refreshXToken as realRefreshXToken,
  type XSnapshot,
  type XTokenResponse,
} from '../../../../lib/socialSyncX.js';
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
  describeConnection,
  revealTokens,
  updateTokensAfterRefresh,
  markRevoked,
} from '../socialCredentialService.js';
import { resolveConnection } from './resolveConnection.js';
import { SocialCapabilityNotAvailableError, SocialConnectionNotFoundError } from './errors.js';

export interface XAdapterDeps {
  fetchProfile?: (accessToken: string) => Promise<XSnapshot>;
  refreshToken?: (opts: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }) => Promise<XTokenResponse>;
}

interface RefreshCredentials {
  clientId?: string;
  clientSecret?: string;
}

export function createXAdapter(
  supabase: SupabaseClient,
  deps: XAdapterDeps = {},
  refreshCredentials: RefreshCredentials = {
    clientId: process.env.X_CLIENT_ID,
    clientSecret: process.env.X_CLIENT_SECRET,
  },
): SocialProviderAdapter {
  const fetchProfile = deps.fetchProfile ?? realFetchXSnapshot;
  const refreshTokenFn = deps.refreshToken ?? realRefreshXToken;

  return {
    provider: 'x',

    getCapabilities(): SocialProviderCapabilitySnapshot {
      return capsFromRegistry('x');
    },

    async connect(_input: ConnectInput): Promise<ConnectionResult> {
      // OAuth de X já existe em `socialRouter.ts` (POST /connect/:provider/start
      // e /connect/:provider/callback). Wireing pra passar por adapter é PR 5+.
      throw new SocialCapabilityNotAvailableError(
        'x',
        'profileRead',
        'not_configured',
        'Use POST /api/v1/social/connect/x/start; wiring pelo adapter entra em PR futuro.',
      );
    },

    async disconnect(connectionId: string): Promise<void> {
      const { campaignId } = await resolveConnection(supabase, 'x', connectionId);
      // Não chamamos a API do X pra revogar — o próprio provider expira o token
      // quando o usuário revoga em twitter.com/settings/connected_apps. Aqui só
      // marcamos localmente + audit.
      await markRevoked(supabase, campaignId, 'x');
    },

    async refreshCredentials(connectionId: string): Promise<void> {
      const { campaignId } = await resolveConnection(supabase, 'x', connectionId);
      const tokens = await revealTokens(supabase, campaignId, 'x');
      if (!tokens) throw new SocialConnectionNotFoundError('x', connectionId);
      if (!tokens.refreshToken) {
        throw new SocialCapabilityNotAvailableError(
          'x', 'profileRead', 'permission_required',
          'Conexão X não tem refresh_token — usuário precisa reautorizar com escopo offline.access.',
        );
      }
      if (!refreshCredentials.clientId || !refreshCredentials.clientSecret) {
        throw new SocialCapabilityNotAvailableError(
          'x', 'profileRead', 'not_configured',
          'X_CLIENT_ID / X_CLIENT_SECRET ausentes no server.',
        );
      }
      const next = await refreshTokenFn({
        clientId: refreshCredentials.clientId,
        clientSecret: refreshCredentials.clientSecret,
        refreshToken: tokens.refreshToken,
      });
      await updateTokensAfterRefresh(supabase, campaignId, 'x', {
        accessToken: next.access_token,
        refreshToken: next.refresh_token ?? tokens.refreshToken,
        expiresAt: new Date(Date.now() + next.expires_in * 1000),
      });
    },

    async getProfile(connectionId: string): Promise<NormalizedSocialProfile> {
      const { campaignId } = await resolveConnection(supabase, 'x', connectionId);
      const tokens = await revealTokens(supabase, campaignId, 'x');
      if (!tokens) throw new SocialConnectionNotFoundError('x', connectionId);

      const snap = await fetchProfile(tokens.accessToken);
      return {
        provider: 'x',
        externalId: snap.id,
        handle: snap.username,
        displayName: snap.name,
        bio: snap.bio ?? undefined,
        followers: snap.followers,
        following: snap.following,
        postsCount: snap.postsCount,
        raw: snap.raw,
      };
    },

    async getPosts(_connectionId: string, _params?: GetPostsParams): Promise<NormalizedSocialPost[]> {
      // X free tier: /users/:id/tweets é `provider_restricted` (`capabilityRegistry.ts`).
      // Normalização de posts de X está fora do escopo deste PR — ver GAP MATRIX §6.
      throw new SocialCapabilityNotAvailableError(
        'x', 'postsRead', capsFromRegistry('x').capabilities.postsRead,
        'X Free tier bloqueia; normalização entra com PR 6 (Ingestion Engine).',
      );
    },

    async getComments(_connectionId: string, _params?: GetCommentsParams): Promise<NormalizedSocialComment[]> {
      throw new SocialCapabilityNotAvailableError(
        'x', 'ownCommentsRead', capsFromRegistry('x').capabilities.ownCommentsRead,
      );
    },

    async getMetrics(_connectionId: string, _params?: MetricsParams): Promise<NormalizedSocialMetrics> {
      // Métricas normalizadas entram com Ingestion Engine (§6). Hoje o
      // `runSocialSync` grava em `social_metrics_daily` no caminho legado —
      // o adapter não duplica.
      throw new SocialCapabilityNotAvailableError(
        'x', 'metricsRead', 'not_configured',
        'Normalização de métricas entra com PR 6 (Ingestion Engine).',
      );
    },
  };
}

/** Re-export do helper — útil para health-check por adapter sem instanciar. */
export async function xAdapterDescribeConnection(
  supabase: SupabaseClient,
  connectionId: string,
) {
  const { campaignId } = await resolveConnection(supabase, 'x', connectionId);
  return describeConnection(supabase, campaignId, 'x');
}
