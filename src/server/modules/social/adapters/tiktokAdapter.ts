/**
 * TikTokAdapter — wrapper para `tiktokDisplayClient.ts` implementando
 * `SocialProviderAdapter` (§11 do PRD).
 *
 * §32 do PRD (regra inegociável): SÓ capabilities aprovadas pelo app review
 * oficial da TikTok. Nada de scraping. Publishing (Content Posting API) fica
 * bloqueado até approval separada.
 *
 * Escopo MVP (PR 7):
 *   - getProfile: /v2/user/info
 *   - getPosts: /v2/video/list (do próprio usuário)
 *   - getComments: **unsupported** — Display API não expõe comments; existe
 *     Comment API mas requer approval separado + escopo específico.
 *
 * Login Kit (OAuth flow) + refresh token + disconnect efetivo ficam para PR
 * futuro. Hoje: paste manual do access_token no Hub, mesmo padrão do
 * Meta/YouTube MVPs anteriores.
 *
 * Storage: `social_tokens WHERE provider='tiktok'`, com `settings.accessToken`.
 * Sem API-key fallback (TikTok não oferece).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchTtUserInfo as realFetchTtUserInfo,
  fetchTtUserVideos as realFetchTtUserVideos,
  type TtAccessToken,
  type TtUserSnapshot,
  type TtVideo,
} from '../../integrations/tiktokDisplayClient.js';
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

export interface TikTokAdapterDeps {
  fetchUserInfo?: (auth: TtAccessToken) => Promise<TtUserSnapshot>;
  fetchUserVideos?: (auth: TtAccessToken, limit?: number, cursor?: number) => Promise<TtVideo[]>;
}

interface TtResolvedConnection {
  campaignId: string;
  auth: TtAccessToken;
}

async function resolveTtConnection(
  supabase: SupabaseClient,
  connectionId: string,
): Promise<TtResolvedConnection> {
  if (!connectionId) throw new SocialConnectionNotFoundError('tiktok', connectionId);

  const { data, error } = await supabase
    .from('social_tokens')
    .select('id, "campaignId", settings, access_token')
    .eq('id', connectionId)
    .eq('provider', 'tiktok')
    .maybeSingle();

  if (error) throw new Error(`resolveTtConnection failed: ${error.message}`);
  if (!data) throw new SocialConnectionNotFoundError('tiktok', connectionId);

  const settings = (data as any).settings ?? {};
  const accessToken: string | undefined =
    settings.accessToken ?? (data as any).access_token ?? undefined;
  if (!accessToken) {
    throw new SocialCapabilityNotAvailableError(
      'tiktok', 'profileRead', 'not_configured',
      'access_token TikTok ausente. TikTok não tem modo API-key — precisa OAuth via Login Kit (PR futuro) ou paste manual.',
    );
  }
  return { campaignId: (data as any).campaignId, auth: { accessToken } };
}

export function createTikTokAdapter(
  supabase: SupabaseClient,
  deps: TikTokAdapterDeps = {},
): SocialProviderAdapter {
  const fetchUserInfo = deps.fetchUserInfo ?? realFetchTtUserInfo;
  const fetchUserVideos = deps.fetchUserVideos ?? realFetchTtUserVideos;

  return {
    provider: 'tiktok',

    getCapabilities(): SocialProviderCapabilitySnapshot {
      return capsFromRegistry('tiktok');
    },

    async connect(_input: ConnectInput): Promise<ConnectionResult> {
      throw new SocialCapabilityNotAvailableError(
        'tiktok', 'profileRead', 'not_configured',
        'Login Kit (OAuth) entra em PR futuro. Hoje: paste manual do access_token no Hub.',
      );
    },

    async disconnect(_connectionId: string): Promise<void> {
      throw new SocialCapabilityNotAvailableError(
        'tiktok', 'profileRead', 'not_configured',
        'Disconnect efetivo (revoke server-side no TikTok) entra com Login Kit PR — hoje só apagar row no Hub.',
      );
    },

    async refreshCredentials(_connectionId: string): Promise<void> {
      throw new SocialCapabilityNotAvailableError(
        'tiktok', 'profileRead', 'not_configured',
        'TikTok token refresh (`grant_type=refresh_token`) entra com Login Kit PR.',
      );
    },

    async getProfile(connectionId: string): Promise<NormalizedSocialProfile> {
      const conn = await resolveTtConnection(supabase, connectionId);
      const snap = await fetchUserInfo(conn.auth);
      return {
        provider: 'tiktok',
        externalId: snap.openId,
        handle: snap.username ?? undefined,
        displayName: snap.displayName ?? undefined,
        bio: snap.bioDescription ?? undefined,
        followers: snap.followerCount,
        following: snap.followingCount,
        postsCount: snap.videoCount,
        avatarUrl: snap.avatarUrl ?? undefined,
        raw: {
          unionId: snap.unionId,
          isVerified: snap.isVerified,
          likesCount: snap.likesCount,
          profileDeepLink: snap.profileDeepLink,
        },
      };
    },

    async getPosts(connectionId: string, params?: GetPostsParams): Promise<NormalizedSocialPost[]> {
      const conn = await resolveTtConnection(supabase, connectionId);
      const limit = params?.limit ?? 10;
      const videos = await fetchUserVideos(conn.auth, limit);

      // Descobre o openId uma vez pra popular ownerOpenId dos posts.
      // (Display API não devolve isso por video — dono = usuário autenticado.)
      let ownerOpenId = '';
      try {
        const me = await fetchUserInfo(conn.auth);
        ownerOpenId = me.openId;
      } catch {
        // Se falhar, seguimos com string vazia — permalink ainda é o share_url.
      }

      return videos
        .filter(v => {
          if (!params?.since) return true;
          if (!v.createTime) return false;
          return v.createTime * 1000 >= params.since.getTime();
        })
        .map(v => ({
          provider: 'tiktok' as const,
          externalId: v.id,
          accountExternalId: ownerOpenId,
          publishedAt: new Date((v.createTime || 0) * 1000),
          // TikTok é 100% vertical short-form
          contentType: 'short' as const,
          text: v.videoDescription ?? v.title ?? undefined,
          permalink: v.shareUrl ?? undefined,
          metrics: {
            views: v.viewCount,
            reach: null,          // não vem no Display API
            impressions: null,    // idem
            likes: v.likeCount,
            comments: v.commentCount,
            shares: v.shareCount,
            saves: null,          // TikTok expõe favorites em Insights API, não Display
            watchTime: null,      // idem
          },
          rawMetadata: {
            durationSeconds: v.durationSeconds,
            coverImageUrl: v.coverImageUrl,
            embedLink: v.embedLink,
            title: v.title,
          },
        }));
    },

    async getComments(_connectionId: string, _params?: GetCommentsParams): Promise<NormalizedSocialComment[]> {
      throw new SocialCapabilityNotAvailableError(
        'tiktok', 'ownCommentsRead', 'permission_required',
        'TikTok Display API não expõe comments. Comment Management API exige app review + escopo específico — PR futuro.',
      );
    },

    async getMetrics(_connectionId: string, _params?: MetricsParams): Promise<NormalizedSocialMetrics> {
      throw new SocialCapabilityNotAvailableError(
        'tiktok', 'metricsRead', 'not_configured',
        'TikTok Business Insights API (reach, watchTime, demographics) entra em PR futuro.',
      );
    },
  };
}
