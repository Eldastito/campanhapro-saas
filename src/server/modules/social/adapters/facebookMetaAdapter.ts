/**
 * FacebookMetaAdapter — wrapper para `facebookPageClient.ts` que implementa
 * `SocialProviderAdapter` (§11 do PRD).
 *
 * Mesma nuance de storage do InstagramMetaAdapter: SocialProvider é `'facebook'`,
 * MAS a credencial em `social_tokens` fica em `provider='meta'` (compartilhada
 * com Instagram). O adapter espelha isso — `resolveFacebookPage` interno lê
 * `provider='meta'` e deriva a Page + Page access_token via `/me/accounts`.
 *
 * PR 5 entrega LEITURAS reais (page profile, posts, comments) para elevar
 * Facebook de `limited` para `beta` no capability registry. Meta OAuth
 * unificado (long-lived exchange via `fb_exchange_token`, disconnect por
 * provider) fica para PR futuro — mantém escopo tight.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveFacebookPage as realResolveFacebookPage,
  fetchFbPageProfile as realFetchFbPageProfile,
  fetchFbPagePostsWithComments as realFetchFbPagePostsWithComments,
  type FbPageConnection,
  type FbPageProfile,
  type FbPagePost,
  type FbPagePostComment,
} from '../../integrations/facebookPageClient.js';
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

export interface FacebookMetaAdapterDeps {
  resolveFacebookPage?: (
    supabase: SupabaseClient,
    campaignId: string,
  ) => Promise<FbPageConnection | null>;
  fetchFbPageProfile?: (conn: FbPageConnection) => Promise<FbPageProfile>;
  fetchFbPagePostsWithComments?: (
    conn: FbPageConnection,
    postLimit?: number,
    commentsPerPost?: number,
  ) => Promise<Array<FbPagePost & { comments: FbPagePostComment[] }>>;
}

/**
 * Resolve `connectionId` (uuid de social_tokens.id, provider='meta') para
 * `FbPageConnection`. Reusa o pipeline do facebookPageClient — auto-derivar
 * pageId via /me/accounts se settings.pageId não estiver salvo.
 */
async function resolveFbConnectionForAdapter(
  supabase: SupabaseClient,
  connectionId: string,
  resolveFn: (supabase: SupabaseClient, campaignId: string) => Promise<FbPageConnection | null>,
): Promise<FbPageConnection> {
  if (!connectionId) throw new SocialConnectionNotFoundError('facebook', connectionId);

  const { data, error } = await supabase
    .from('social_tokens')
    .select('id, "campaignId"')
    .eq('id', connectionId)
    .eq('provider', 'meta')
    .maybeSingle();

  if (error) throw new Error(`resolveFbConnectionForAdapter failed: ${error.message}`);
  if (!data) throw new SocialConnectionNotFoundError('facebook', connectionId);

  const conn = await resolveFn(supabase, (data as any).campaignId);
  if (!conn) {
    throw new SocialCapabilityNotAvailableError(
      'facebook', 'profileRead', 'not_configured',
      'Nenhuma Page acessível via user token. Verifique escopos pages_show_list + pages_read_engagement.',
    );
  }
  return conn;
}

function mapFbContentType(mediaType: FbPagePost['mediaType']): NormalizedSocialPost['contentType'] {
  switch (mediaType) {
    case 'photo': return 'image';
    case 'video': return 'video';
    case 'status': return 'text';
    case 'link': return 'other';
    default: return 'other';
  }
}

export function createFacebookMetaAdapter(
  supabase: SupabaseClient,
  deps: FacebookMetaAdapterDeps = {},
): SocialProviderAdapter {
  const resolveFn = deps.resolveFacebookPage ?? realResolveFacebookPage;
  const fetchProfileFn = deps.fetchFbPageProfile ?? realFetchFbPageProfile;
  const fetchPostsFn =
    deps.fetchFbPagePostsWithComments ?? realFetchFbPagePostsWithComments;

  return {
    provider: 'facebook',

    getCapabilities(): SocialProviderCapabilitySnapshot {
      return capsFromRegistry('facebook');
    },

    async connect(_input: ConnectInput): Promise<ConnectionResult> {
      throw new SocialCapabilityNotAvailableError(
        'facebook', 'profileRead', 'not_configured',
        'Meta OAuth unificado + disconnect por provider entram em PR futuro. Hoje: paste manual.',
      );
    },

    async disconnect(_connectionId: string): Promise<void> {
      throw new SocialCapabilityNotAvailableError(
        'facebook', 'profileRead', 'not_configured',
        'Credencial Meta compartilhada com Instagram — disconnect por-provider entra em PR futuro.',
      );
    },

    async refreshCredentials(_connectionId: string): Promise<void> {
      throw new SocialCapabilityNotAvailableError(
        'facebook', 'profileRead', 'not_configured',
        'Meta long-lived token exchange (fb_exchange_token) entra em PR futuro.',
      );
    },

    async getProfile(connectionId: string): Promise<NormalizedSocialProfile> {
      const conn = await resolveFbConnectionForAdapter(supabase, connectionId, resolveFn);
      const snap = await fetchProfileFn(conn);

      // followers vs fans: Meta descontinuou likes (fan_count) em favor de
      // followers_count na v17+. Preferimos followersCount; fallback fanCount.
      const followers = snap.followersCount ?? snap.fanCount ?? null;

      return {
        provider: 'facebook',
        externalId: snap.pageId,
        handle: undefined, // Page não tem @handle canônico
        displayName: snap.name ?? conn.pageName ?? undefined,
        bio: snap.about ?? undefined,
        followers,
        following: null,  // Page não segue ninguém no sentido normal
        postsCount: null, // não vem no fields atual — cost extra call
        avatarUrl: snap.pictureUrl ?? undefined,
        raw: { pageId: snap.pageId, category: snap.category, link: snap.link },
      };
    },

    async getPosts(connectionId: string, params?: GetPostsParams): Promise<NormalizedSocialPost[]> {
      const conn = await resolveFbConnectionForAdapter(supabase, connectionId, resolveFn);
      const limit = params?.limit ?? 10;
      const posts = await fetchPostsFn(conn, limit, 30);

      return posts
        .filter(p => {
          if (!params?.since) return true;
          if (!p.createdTime) return false;
          return new Date(p.createdTime).getTime() >= params.since.getTime();
        })
        .map(p => ({
          provider: 'facebook' as const,
          externalId: p.id,
          accountExternalId: conn.pageId,
          publishedAt: p.createdTime ? new Date(p.createdTime) : new Date(0),
          contentType: mapFbContentType(p.mediaType),
          text: p.message ?? undefined,
          permalink: p.permalinkUrl ?? undefined,
          metrics: {
            views: null,        // requer /insights (page_impressions_unique) — PR 6
            reach: null,        // idem
            impressions: null,  // idem
            likes: p.reactionsCount, // total_count de reactions ~= "likes" no Facebook moderno
            comments: p.commentsCount,
            shares: p.sharesCount,
            saves: null,        // FB não expõe saves para Pages
            watchTime: null,    // requer video_insights — PR 6
          },
        }));
    },

    async getComments(connectionId: string, params?: GetCommentsParams): Promise<NormalizedSocialComment[]> {
      const conn = await resolveFbConnectionForAdapter(supabase, connectionId, resolveFn);
      const commentsLimit = params?.limit ?? 30;
      const postLimit = params?.postExternalId ? 25 : 8;
      const posts = await fetchPostsFn(conn, postLimit, commentsLimit);

      const collectedAt = new Date();
      const result: NormalizedSocialComment[] = [];

      for (const post of posts) {
        if (params?.postExternalId && post.id !== params.postExternalId) continue;

        for (const c of post.comments) {
          if (!c.createdTime && !c.message) continue;
          if (params?.since && c.createdTime) {
            if (new Date(c.createdTime).getTime() < params.since.getTime()) continue;
          }
          result.push({
            provider: 'facebook',
            externalId: c.id,
            postExternalId: post.id,
            authorPublicId: c.fromId,
            text: c.message ?? undefined,
            publishedAt: c.createdTime ? new Date(c.createdTime) : collectedAt,
            likes: c.likeCount,
            replies: null, // Graph atual não devolve replies embutidos
            provenance: {
              provider: 'facebook',
              sourceType: 'owned',
              collectedAt,
              sourceUrl: post.permalinkUrl ?? undefined,
              dataAvailability: 'observed',
            },
          });
        }
      }

      return result;
    },

    async getMetrics(_connectionId: string, _params?: MetricsParams): Promise<NormalizedSocialMetrics> {
      throw new SocialCapabilityNotAvailableError(
        'facebook', 'metricsRead', 'not_configured',
        'Normalização de /insights (page_impressions_unique, page_engaged_users) entra com PR 6 (Ingestion Engine).',
      );
    },
  };
}
