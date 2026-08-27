/**
 * YouTubeAdapter — wrapper para `youtubeDataClient.ts` implementando
 * `SocialProviderAdapter` (§11 do PRD).
 *
 * Storage:
 *   - Se existe linha em `social_tokens WHERE provider='youtube'`, usa
 *     `settings.channelId` (obrigatório) + `settings.accessToken` (opcional).
 *   - Se `settings.accessToken` presente → OAuth mode.
 *   - Senão → API-key mode (env `YOUTUBE_API_KEY`).
 *
 * Escopo MVP (PR 6): leitura pública (channel + videos + comments) via API
 * key ou OAuth token. OAuth Google flow + Analytics API (watch time,
 * retention, demografia agregada) ficam para PR futuro. Assim já cobrimos
 * Ingestion Engine (§6) sem bloquear em burocracia de GCP + verificação.
 *
 * Publish é `unsupported`: YouTube não tem "publicação de texto" no sentido
 * das outras redes; upload de video é out-of-scope no PRD.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchYtChannel as realFetchYtChannel,
  fetchYtVideos as realFetchYtVideos,
  fetchYtVideoComments as realFetchYtVideoComments,
  type YtAuth,
  type YtChannelSnapshot,
  type YtVideo,
  type YtComment,
} from '../../integrations/youtubeDataClient.js';
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

export interface YouTubeAdapterDeps {
  fetchChannel?: (auth: YtAuth, channelId?: string) => Promise<YtChannelSnapshot>;
  fetchVideos?: (auth: YtAuth, channelId: string, limit?: number) => Promise<YtVideo[]>;
  fetchVideoComments?: (auth: YtAuth, videoId: string, limit?: number) => Promise<YtComment[]>;
}

interface YtResolvedConnection {
  campaignId: string;
  channelId: string;
  auth: YtAuth;
}

async function resolveYtConnection(
  supabase: SupabaseClient,
  connectionId: string,
  fallbackApiKey?: string,
): Promise<YtResolvedConnection> {
  if (!connectionId) throw new SocialConnectionNotFoundError('youtube', connectionId);

  const { data, error } = await supabase
    .from('social_tokens')
    .select('id, "campaignId", settings, access_token')
    .eq('id', connectionId)
    .eq('provider', 'youtube')
    .maybeSingle();

  if (error) throw new Error(`resolveYtConnection failed: ${error.message}`);
  if (!data) throw new SocialConnectionNotFoundError('youtube', connectionId);

  const settings = (data as any).settings ?? {};
  const channelId: string | undefined = settings.channelId;
  if (!channelId) {
    throw new SocialCapabilityNotAvailableError(
      'youtube', 'profileRead', 'not_configured',
      'settings.channelId (UCxxxx…) ausente na conexão YouTube.',
    );
  }

  const accessToken: string | undefined =
    settings.accessToken ?? (data as any).access_token ?? undefined;
  if (accessToken) {
    return { campaignId: (data as any).campaignId, channelId, auth: { accessToken } };
  }
  if (fallbackApiKey) {
    return { campaignId: (data as any).campaignId, channelId, auth: { apiKey: fallbackApiKey } };
  }
  throw new SocialCapabilityNotAvailableError(
    'youtube', 'profileRead', 'not_configured',
    'Sem access_token OAuth nem YOUTUBE_API_KEY configurado.',
  );
}

function mapYtContentType(isShort: boolean): NormalizedSocialPost['contentType'] {
  return isShort ? 'short' : 'video';
}

export function createYouTubeAdapter(
  supabase: SupabaseClient,
  deps: YouTubeAdapterDeps = {},
  fallbackApiKey: string | undefined = process.env.YOUTUBE_API_KEY,
): SocialProviderAdapter {
  const fetchChannel = deps.fetchChannel ?? realFetchYtChannel;
  const fetchVideos = deps.fetchVideos ?? realFetchYtVideos;
  const fetchVideoComments = deps.fetchVideoComments ?? realFetchYtVideoComments;

  return {
    provider: 'youtube',

    getCapabilities(): SocialProviderCapabilitySnapshot {
      return capsFromRegistry('youtube');
    },

    async connect(_input: ConnectInput): Promise<ConnectionResult> {
      throw new SocialCapabilityNotAvailableError(
        'youtube', 'profileRead', 'not_configured',
        'OAuth Google (Login + refresh) entra em PR futuro. Hoje: paste manual do channelId + (opcional) access_token no Hub.',
      );
    },

    async disconnect(_connectionId: string): Promise<void> {
      throw new SocialCapabilityNotAvailableError(
        'youtube', 'profileRead', 'not_configured',
        'Disconnect efetivo (revoke no lado do Google) entra com OAuth PR — hoje só apagar row no Hub.',
      );
    },

    async refreshCredentials(_connectionId: string): Promise<void> {
      throw new SocialCapabilityNotAvailableError(
        'youtube', 'profileRead', 'not_configured',
        'YouTube OAuth refresh (`grant_type=refresh_token`) entra em PR futuro.',
      );
    },

    async getProfile(connectionId: string): Promise<NormalizedSocialProfile> {
      const conn = await resolveYtConnection(supabase, connectionId, fallbackApiKey);
      const snap = await fetchChannel(conn.auth, conn.channelId);
      return {
        provider: 'youtube',
        externalId: snap.channelId,
        handle: snap.customUrl ?? undefined,
        displayName: snap.title ?? undefined,
        bio: snap.description ?? undefined,
        followers: snap.hiddenSubscriberCount ? null : snap.subscriberCount,
        following: null,               // YouTube não tem "following count"
        postsCount: snap.videoCount,
        avatarUrl: snap.thumbnailUrl ?? undefined,
        raw: {
          viewCount: snap.viewCount,
          hiddenSubscriberCount: snap.hiddenSubscriberCount,
          publishedAt: snap.publishedAt,
        },
      };
    },

    async getPosts(connectionId: string, params?: GetPostsParams): Promise<NormalizedSocialPost[]> {
      const conn = await resolveYtConnection(supabase, connectionId, fallbackApiKey);
      const limit = params?.limit ?? 10;
      const videos = await fetchVideos(conn.auth, conn.channelId, limit);

      return videos
        .filter(v => {
          if (!params?.since) return true;
          if (!v.publishedAt) return false;
          return new Date(v.publishedAt).getTime() >= params.since.getTime();
        })
        .map(v => ({
          provider: 'youtube' as const,
          externalId: v.id,
          accountExternalId: v.channelId,
          publishedAt: v.publishedAt ? new Date(v.publishedAt) : new Date(0),
          contentType: mapYtContentType(v.isShort),
          text: v.description || v.title,
          permalink: v.permalink,
          metrics: {
            views: v.viewCount,
            reach: null,           // Analytics API required — PR futuro
            impressions: null,     // idem
            likes: v.likeCount,
            comments: v.commentCount,
            shares: null,          // YT não expõe shares em Data API
            saves: null,           // idem
            watchTime: null,       // Analytics API — PR futuro
          },
          rawMetadata: {
            durationSeconds: v.durationSeconds,
            isShort: v.isShort,
            thumbnailUrl: v.thumbnailUrl,
            title: v.title,
          },
        }));
    },

    async getComments(connectionId: string, params?: GetCommentsParams): Promise<NormalizedSocialComment[]> {
      const conn = await resolveYtConnection(supabase, connectionId, fallbackApiKey);
      const commentsLimit = params?.limit ?? 30;

      // Se pediram post específico, direto ao commentThreads.
      if (params?.postExternalId) {
        const comments = await fetchVideoComments(conn.auth, params.postExternalId, commentsLimit);
        return comments
          .map(c => normalizeYtComment(c, params.postExternalId!, params?.since))
          .filter((c): c is NormalizedSocialComment => c !== null);
      }

      // Sem post específico: puxa videos recentes e concatena os comments.
      const videos = await fetchVideos(conn.auth, conn.channelId, 5);
      const result: NormalizedSocialComment[] = [];
      for (const v of videos) {
        try {
          const comments = await fetchVideoComments(conn.auth, v.id, commentsLimit);
          for (const c of comments) {
            const normalized = normalizeYtComment(c, v.id, params?.since);
            if (normalized) result.push(normalized);
          }
        } catch (err) {
          // Video com comments desabilitados devolve 403 — não quebra o batch.
          console.warn(`[youtube] fetchVideoComments falhou para ${v.id}:`, (err as Error).message);
        }
      }
      return result;
    },

    async getMetrics(_connectionId: string, _params?: MetricsParams): Promise<NormalizedSocialMetrics> {
      throw new SocialCapabilityNotAvailableError(
        'youtube', 'metricsRead', 'not_configured',
        'YouTube Analytics API (watch time, retention, demografia) entra em PR futuro.',
      );
    },
  };
}

function normalizeYtComment(
  c: YtComment,
  videoId: string,
  since?: Date,
): NormalizedSocialComment | null {
  if (since && c.publishedAt) {
    if (new Date(c.publishedAt).getTime() < since.getTime()) return null;
  }
  return {
    provider: 'youtube',
    externalId: c.id,
    postExternalId: videoId,
    authorPublicId: c.authorChannelId ?? c.authorDisplayName ?? undefined,
    text: c.textDisplay || undefined,
    publishedAt: c.publishedAt ? new Date(c.publishedAt) : new Date(0),
    likes: c.likeCount,
    replies: c.totalReplyCount,
    provenance: {
      provider: 'youtube',
      sourceType: 'owned',
      collectedAt: new Date(),
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}&lc=${c.id}`,
      dataAvailability: 'observed',
    },
  };
}
