/**
 * KwaiAdapter — wrapper para `src/lib/socialSyncKwai.ts`.
 *
 * ATENÇÃO: Kwai não tem API pública. Este adapter usa scraping frágil de
 * og-tags e regex do HTML público. Regra §21 do PRD: manter
 * `adapterMaturity = 'limited'` e NUNCA aumentar cobertura via scraping
 * não autorizado (nem tentar bypass de bot detection).
 *
 * A "conexão" Kwai é apenas o handle do candidato — não há OAuth, não há
 * refresh_token, não há disconnect no lado do provider. Modelamos:
 *   - `settings.handle` guarda o @username escolhido pelo candidato
 *   - `connect()` não é o fluxo: a UI usa `POST /api/v1/social/connect/kwai`
 *     do socialRouter que já existe (socialRouter.ts:199-229).
 *   - `refreshCredentials()` é no-op (não há tokens para refrescar).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchKwaiPublicProfile as realFetchKwaiPublicProfile,
  type KwaiSnapshot,
} from '../../../../lib/socialSyncKwai.js';
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
import { markRevoked } from '../socialCredentialService.js';
import { resolveConnection } from './resolveConnection.js';
import { SocialCapabilityNotAvailableError, SocialConnectionNotFoundError } from './errors.js';

export interface KwaiAdapterDeps {
  fetchProfile?: (handleOrUrl: string) => Promise<KwaiSnapshot>;
}

export function createKwaiAdapter(
  supabase: SupabaseClient,
  deps: KwaiAdapterDeps = {},
): SocialProviderAdapter {
  const fetchProfile = deps.fetchProfile ?? realFetchKwaiPublicProfile;

  return {
    provider: 'kwai',

    getCapabilities(): SocialProviderCapabilitySnapshot {
      return capsFromRegistry('kwai');
    },

    async connect(_input: ConnectInput): Promise<ConnectionResult> {
      throw new SocialCapabilityNotAvailableError(
        'kwai', 'profileRead', 'not_configured',
        'Use POST /api/v1/social/connect/kwai (só handle público, sem OAuth).',
      );
    },

    async disconnect(connectionId: string): Promise<void> {
      const { campaignId } = await resolveConnection(supabase, 'kwai', connectionId);
      // Sem revogação lado provider — só marca localmente.
      await markRevoked(supabase, campaignId, 'kwai');
    },

    async refreshCredentials(_connectionId: string): Promise<void> {
      // No-op: Kwai não tem tokens para refrescar. Deixamos passar em vez de
      // throw para o caller poder tratar todos os providers uniformemente.
      // O `SocialConnectionNotFoundError` é o único erro possível — mas se
      // chegou aqui é porque a rotina de refresh do runner iterou; nada a fazer.
    },

    async getProfile(connectionId: string): Promise<NormalizedSocialProfile> {
      // Kwai não usa `revealTokens` — o "credencial" é o handle público no
      // `settings`. Puxamos direto de `social_tokens.settings`.
      const { data, error } = await supabase
        .from('social_tokens')
        .select('id, "campaignId", settings')
        .eq('id', connectionId)
        .eq('provider', 'kwai')
        .maybeSingle();

      if (error) throw new Error(`kwai getProfile lookup failed: ${error.message}`);
      if (!data) throw new SocialConnectionNotFoundError('kwai', connectionId);

      const handleOrUrl =
        (data as any).settings?.handle ?? (data as any).settings?.profileUrl;
      if (!handleOrUrl) {
        throw new SocialCapabilityNotAvailableError(
          'kwai', 'profileRead', 'not_configured',
          'settings.handle ou settings.profileUrl ausente na conexão Kwai.',
        );
      }

      const snap = await fetchProfile(String(handleOrUrl));
      return {
        provider: 'kwai',
        externalId: snap.handle ?? String(handleOrUrl),
        handle: snap.handle ?? undefined,
        displayName: snap.displayName ?? undefined,
        bio: snap.bio ?? undefined,
        followers: snap.followers,
        following: snap.following,
        postsCount: snap.videosCount,
        raw: snap.raw,
      };
    },

    async getPosts(_connectionId: string, _params?: GetPostsParams): Promise<NormalizedSocialPost[]> {
      throw new SocialCapabilityNotAvailableError(
        'kwai', 'postsRead', 'unsupported',
        'Kwai não tem API pública para listar posts — apenas contagem via scraping.',
      );
    },

    async getComments(_connectionId: string, _params?: GetCommentsParams): Promise<NormalizedSocialComment[]> {
      throw new SocialCapabilityNotAvailableError(
        'kwai', 'ownCommentsRead', 'unsupported',
      );
    },

    async getMetrics(_connectionId: string, _params?: MetricsParams): Promise<NormalizedSocialMetrics> {
      throw new SocialCapabilityNotAvailableError(
        'kwai', 'metricsRead', 'not_configured',
        'Normalização de métricas entra com PR 6 (Ingestion Engine).',
      );
    },
  };
}
