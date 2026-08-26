/**
 * InstagramMetaAdapter — wrapper para `instagramGraphClient.ts` que
 * implementa `SocialProviderAdapter` (§11 do PRD).
 *
 * ATENÇÃO — nuance de storage:
 *   O SocialProvider é `'instagram'`, MAS a credencial em `social_tokens`
 *   fica em `provider='meta'` (fonte única compartilhada com Facebook).
 *   Isto reflete o padrão real do repo — `resolveInstagram()` já lê de
 *   `provider='meta'`. O adapter espelha essa realidade em vez de forçar
 *   migração de dado.
 *
 * PR 4 preserva TUDO que já funciona no Instagram:
 *   - Pulso dos Bairros (socialRouter.ts:370)
 *   - Watchlist (socialRouter.ts:333)
 *   - /instagram/own-comments (socialRouter.ts:427)
 *   - Business Discovery (instagramGraphClient.ts:124)
 * Nenhum desses endpoints é modificado. O adapter é uma camada NOVA que
 * cortes futuros (Pulso Digital §53, Publisher §68) vão consumir.
 *
 * Meta OAuth (troca de token de curta duração → longa duração + refresh
 * via `fb_exchange_token`) é PR 5 (FacebookMetaAdapter). Aqui:
 *   - connect: throw (fluxo atual = paste manual no Hub)
 *   - refreshCredentials: throw (Meta long-lived precisa de `fb_exchange_token`)
 *   - disconnect: throw (credencial é compartilhada com FB — marcar revoked
 *     no lado do storage quebraria FB. PR 5 trata isso com escopo separado.)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchIgAccountProfile as realFetchIgAccountProfile,
  fetchOwnMediaWithComments as realFetchOwnMediaWithComments,
  type IgAccountProfile,
  type IgConnection,
  type IgPost,
  type IgComment,
} from '../../integrations/instagramGraphClient.js';
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
import { SocialCapabilityNotAvailableError, SocialConnectionNotFoundError } from './errors.js';

export interface InstagramMetaAdapterDeps {
  fetchAccountProfile?: (conn: IgConnection) => Promise<IgAccountProfile>;
  fetchOwnMediaWithComments?: (
    conn: IgConnection,
    mediaLimit?: number,
    commentsPerMedia?: number,
  ) => Promise<Array<IgPost & { comments: IgComment[] }>>;
}

/**
 * Resolve `connectionId` (uuid) para `IgConnection`. Storage é
 * `provider='meta'` (não `'instagram'`) — ver bloco de doc acima.
 */
async function resolveIgConnection(
  supabase: SupabaseClient,
  connectionId: string,
): Promise<IgConnection> {
  if (!connectionId) throw new SocialConnectionNotFoundError('instagram', connectionId);

  const { data, error } = await supabase
    .from('social_tokens')
    .select('id, "campaignId", settings, access_token, token')
    .eq('id', connectionId)
    .eq('provider', 'meta')
    .maybeSingle();

  if (error) throw new Error(`resolveIgConnection failed: ${error.message}`);
  if (!data) throw new SocialConnectionNotFoundError('instagram', connectionId);

  // Ordem exata do resolveInstagram legado:
  //   1. settings.accountId / settings.igUserId
  //   2. settings.accessToken → coluna access_token → coluna token
  const settings = (data as any).settings ?? {};
  const igUserId = (settings.accountId ?? settings.igUserId) as string | undefined;
  if (!igUserId) {
    throw new SocialCapabilityNotAvailableError(
      'instagram', 'profileRead', 'not_configured',
      'settings.accountId (IG Business Account ID) ausente na conexão Meta.',
    );
  }

  const token =
    settings.accessToken ??
    (data as any).access_token ??
    (data as any).token ??
    process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new SocialCapabilityNotAvailableError(
      'instagram', 'profileRead', 'not_configured',
      'access_token ausente (settings.accessToken, coluna access_token e META_ACCESS_TOKEN vazios).',
    );
  }

  return {
    igUserId,
    token,
    username: settings.username,
  };
}

/** Mapeia mediaType do Graph API para o tipo canônico do NormalizedSocialPost. */
function mapContentType(mediaType?: string): NormalizedSocialPost['contentType'] {
  switch (mediaType) {
    case 'IMAGE':
      return 'image';
    case 'VIDEO':
      return 'video';
    case 'CAROUSEL_ALBUM':
      return 'carousel';
    default:
      return 'other';
  }
}

/**
 * Extrai externalId estável do permalink. Formato:
 *   https://www.instagram.com/p/{shortcode}/     → shortcode
 *   https://www.instagram.com/reel/{shortcode}/  → shortcode
 * Falha silenciosa → devolve permalink inteiro (ainda único).
 */
function externalIdFromPermalink(permalink: string): string {
  const m = permalink.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)\/?/);
  return m?.[1] ?? permalink;
}

export function createInstagramMetaAdapter(
  supabase: SupabaseClient,
  deps: InstagramMetaAdapterDeps = {},
): SocialProviderAdapter {
  const fetchAccountProfile = deps.fetchAccountProfile ?? realFetchIgAccountProfile;
  const fetchOwnMediaWithComments =
    deps.fetchOwnMediaWithComments ?? realFetchOwnMediaWithComments;

  return {
    provider: 'instagram',

    getCapabilities(): SocialProviderCapabilitySnapshot {
      return capsFromRegistry('instagram');
    },

    async connect(_input: ConnectInput): Promise<ConnectionResult> {
      throw new SocialCapabilityNotAvailableError(
        'instagram', 'profileRead', 'not_configured',
        'Meta OAuth unificado entra em PR 5. Hoje: paste manual em SocialConnectionsHub.tsx.',
      );
    },

    async disconnect(_connectionId: string): Promise<void> {
      // Credencial é compartilhada com Facebook (provider='meta' no storage).
      // Marcar revoked aqui quebraria o Facebook. PR 5 (Meta OAuth unificado)
      // trata revoke por-escopo-IG-só.
      throw new SocialCapabilityNotAvailableError(
        'instagram', 'profileRead', 'not_configured',
        'Meta credentials são compartilhadas com Facebook — disconnect por-provider entra em PR 5.',
      );
    },

    async refreshCredentials(_connectionId: string): Promise<void> {
      // Meta usa long-lived tokens (60 dias) via `fb_exchange_token`, não o
      // fluxo de refresh_token do OAuth 2.0 usado em X/LinkedIn. PR 5.
      throw new SocialCapabilityNotAvailableError(
        'instagram', 'profileRead', 'not_configured',
        'Meta long-lived token exchange (fb_exchange_token) entra em PR 5.',
      );
    },

    async getProfile(connectionId: string): Promise<NormalizedSocialProfile> {
      const conn = await resolveIgConnection(supabase, connectionId);
      const snap = await fetchAccountProfile(conn);
      return {
        provider: 'instagram',
        externalId: snap.igUserId,
        handle: snap.username ?? undefined,
        displayName: snap.name ?? undefined,
        bio: snap.biography ?? undefined,
        followers: snap.followersCount,
        following: null,        // IG Graph não expõe following para próprio account
        postsCount: snap.mediaCount,
        avatarUrl: snap.profilePictureUrl ?? undefined,
        raw: { igUserId: snap.igUserId },
      };
    },

    async getPosts(connectionId: string, params?: GetPostsParams): Promise<NormalizedSocialPost[]> {
      const conn = await resolveIgConnection(supabase, connectionId);
      const limit = params?.limit ?? 8;
      const media = await fetchOwnMediaWithComments(conn, limit, 30);

      return media
        .filter(m => {
          if (!params?.since) return true;
          if (!m.timestamp) return false;
          return new Date(m.timestamp).getTime() >= params.since.getTime();
        })
        .map(m => ({
          provider: 'instagram' as const,
          externalId: externalIdFromPermalink(m.permalink || ''),
          accountExternalId: conn.igUserId,
          publishedAt: m.timestamp ? new Date(m.timestamp) : new Date(0),
          contentType: mapContentType(m.mediaType),
          text: m.caption || undefined,
          permalink: m.permalink || undefined,
          metrics: {
            views: null,        // não vem no fields atual
            reach: null,        // requer /insights endpoint
            impressions: null,  // idem
            likes: typeof m.likeCount === 'number' ? m.likeCount : null,
            comments: typeof m.commentsCount === 'number' ? m.commentsCount : null,
            shares: null,       // IG não expõe shares p/ posts orgânicos
            saves: null,        // idem
            watchTime: null,    // idem
          },
        }));
    },

    async getComments(connectionId: string, params?: GetCommentsParams): Promise<NormalizedSocialComment[]> {
      const conn = await resolveIgConnection(supabase, connectionId);
      const limit = params?.limit ?? 30;
      const mediaLimit = params?.postExternalId ? 32 : 8; // busca mais posts se estamos filtrando por um específico
      const media = await fetchOwnMediaWithComments(conn, mediaLimit, limit);

      const collectedAt = new Date();
      const result: NormalizedSocialComment[] = [];

      for (const post of media) {
        const postExternalId = externalIdFromPermalink(post.permalink || '');
        if (params?.postExternalId && postExternalId !== params.postExternalId) continue;

        for (const c of post.comments) {
          if (!c.timestamp && !c.text) continue;
          if (params?.since && c.timestamp) {
            if (new Date(c.timestamp).getTime() < params.since.getTime()) continue;
          }
          result.push({
            provider: 'instagram',
            externalId: c.text
              ? `${postExternalId}:${(c.timestamp || 'unknown').slice(0, 19)}:${(c.username || 'anon').slice(0, 30)}`
              : `${postExternalId}:${collectedAt.toISOString()}`,
            postExternalId,
            authorPublicId: c.username,
            text: c.text || undefined,
            publishedAt: c.timestamp ? new Date(c.timestamp) : collectedAt,
            likes: typeof c.likeCount === 'number' ? c.likeCount : null,
            replies: null, // Graph atual não devolve replies embutidos
            provenance: {
              provider: 'instagram',
              sourceType: 'owned',
              collectedAt,
              sourceUrl: post.permalink || undefined,
              dataAvailability: 'observed',
            },
          });
        }
      }

      return result;
    },

    async getMetrics(_connectionId: string, _params?: MetricsParams): Promise<NormalizedSocialMetrics> {
      // Métricas agregadas por janela vêm do endpoint /insights — normalização
      // entra com o Ingestion Engine (PR 6). Hoje o socialSyncRunner grava em
      // social_metrics_daily por outro caminho; o adapter não duplica.
      throw new SocialCapabilityNotAvailableError(
        'instagram', 'metricsRead', 'not_configured',
        'Normalização de /insights entra com PR 6 (Ingestion Engine).',
      );
    },
  };
}
