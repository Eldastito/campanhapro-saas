/**
 * Testes do PR 6 do PRD Social Intelligence — YouTubeAdapter.
 *
 * Escopo coberto: getCapabilities, auth resolution (OAuth vs API-key
 * fallback), getProfile normalização, getPosts com detecção de Short,
 * getComments com e sem postExternalId, throw claros nos métodos fora
 * de escopo.
 *
 * DI de fetchers evita rede real.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';

import {
  createSocialAdapters,
  SocialCapabilityNotAvailableError,
  SocialConnectionNotFoundError,
} from '../src/server/modules/social/adapters';
import { createYouTubeAdapter } from '../src/server/modules/social/adapters/youtubeAdapter';
import { parseIsoDurationSeconds } from '../src/server/modules/integrations/youtubeDataClient';

const CAMP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function seedYtConnection(opts: {
  id: string;
  campaignId?: string;
  channelId?: string | null;
  accessToken?: string | null;
}) {
  return {
    id: opts.id,
    campaignId: opts.campaignId ?? CAMP,
    provider: 'youtube',
    access_token: null,
    refresh_token: null,
    settings: {
      ...(opts.channelId !== null ? { channelId: opts.channelId ?? 'UC_CANDIDATO' } : {}),
      ...(opts.accessToken ? { accessToken: opts.accessToken } : {}),
    },
    status: 'active',
  };
}

const CHANNEL_SNAP = {
  channelId: 'UC_CANDIDATO',
  title: 'Canal do Candidato',
  description: 'Canal oficial da campanha',
  customUrl: '@candidato',
  publishedAt: '2020-01-01T00:00:00Z',
  subscriberCount: 12_000,
  videoCount: 87,
  viewCount: 1_500_000,
  thumbnailUrl: 'https://yt3.ggpht.com/pic.jpg',
  hiddenSubscriberCount: false,
};

const VIDEO_LONG = {
  id: 'video-1',
  channelId: 'UC_CANDIDATO',
  title: 'Debate completo',
  description: 'Live do debate',
  publishedAt: '2026-08-25T20:00:00Z',
  durationIso: 'PT1H15M',
  durationSeconds: 4500,
  isShort: false,
  viewCount: 42_000,
  likeCount: 1_800,
  commentCount: 320,
  thumbnailUrl: 'https://yt3.ggpht.com/1.jpg',
  permalink: 'https://www.youtube.com/watch?v=video-1',
};

const VIDEO_SHORT = {
  id: 'video-2',
  channelId: 'UC_CANDIDATO',
  title: 'Corte do debate',
  description: 'Best of',
  publishedAt: '2026-08-26T10:00:00Z',
  durationIso: 'PT45S',
  durationSeconds: 45,
  isShort: true,
  viewCount: 100_000,
  likeCount: 4_500,
  commentCount: 210,
  thumbnailUrl: 'https://yt3.ggpht.com/2.jpg',
  permalink: 'https://www.youtube.com/watch?v=video-2',
};

const COMMENT_1 = {
  id: 'comm-a',
  videoId: 'video-1',
  authorDisplayName: 'Ana Silva',
  authorChannelId: 'UC_ana',
  textDisplay: 'Parabéns pelo debate!',
  publishedAt: '2026-08-25T20:30:00Z',
  likeCount: 12,
  totalReplyCount: 2,
};

const COMMENT_2 = {
  id: 'comm-b',
  videoId: 'video-1',
  authorDisplayName: 'Beto Costa',
  authorChannelId: 'UC_beto',
  textDisplay: 'Não gostei da posição sobre X',
  publishedAt: '2026-08-25T21:00:00Z',
  likeCount: 3,
  totalReplyCount: 0,
};

// ── Suites ────────────────────────────────────────────────────────────

describe('YouTubeAdapter — getCapabilities', () => {
  test('adapterMaturity=beta; reads públicos supported; audience insights permission_required', () => {
    const supabase = createMockSupabase({ social_tokens: [] });
    const adapters = createSocialAdapters(supabase);
    const caps = adapters.youtube!.getCapabilities();
    assert.equal(caps.adapterMaturity, 'beta');
    assert.equal(caps.capabilities.profileRead, 'supported');
    assert.equal(caps.capabilities.postsRead, 'supported');
    assert.equal(caps.capabilities.ownCommentsRead, 'supported');
    assert.equal(caps.capabilities.thirdPartyCommentsRead, 'supported');
    assert.equal(caps.capabilities.metricsRead, 'supported');
    assert.equal(caps.capabilities.audienceInsights, 'permission_required');
    assert.equal(caps.capabilities.publishText, 'unsupported');
    assert.equal(caps.capabilities.publishVideo, 'not_configured');
    assert.equal(caps.capabilities.webhook, 'unsupported');
  });
});

describe('YouTubeAdapter — resolveYtConnection', () => {
  test('usa accessToken quando presente (OAuth mode)', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedYtConnection({ id: 'yt-oauth', accessToken: 'MY_OAUTH_TOKEN' })],
    });
    let authSeen: any = null;
    const adapters = createSocialAdapters(supabase, {
      youtube: {
        fetchChannel: async (auth) => {
          authSeen = auth;
          return CHANNEL_SNAP;
        },
      },
    });
    await adapters.youtube!.getProfile('yt-oauth');
    assert.deepEqual(authSeen, { accessToken: 'MY_OAUTH_TOKEN' });
  });

  test('cai pra apiKey do env quando accessToken ausente', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedYtConnection({ id: 'yt-apikey' })],
    });
    let authSeen: any = null;
    const adapter = createYouTubeAdapter(
      supabase,
      { fetchChannel: async (auth) => { authSeen = auth; return CHANNEL_SNAP; } },
      'FAKE_YT_API_KEY',
    );
    await adapter.getProfile('yt-apikey');
    assert.deepEqual(authSeen, { apiKey: 'FAKE_YT_API_KEY' });
  });

  test('sem accessToken nem apiKey → SocialCapabilityNotAvailableError not_configured', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedYtConnection({ id: 'yt-empty' })],
    });
    const adapter = createYouTubeAdapter(supabase, {}, undefined);
    await assert.rejects(
      () => adapter.getProfile('yt-empty'),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        err.level === 'not_configured' &&
        /API_KEY/.test(err.message),
    );
  });

  test('sem settings.channelId → SocialCapabilityNotAvailableError not_configured', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedYtConnection({ id: 'yt-no-ch', channelId: null })],
    });
    const adapter = createYouTubeAdapter(supabase, {}, 'K');
    await assert.rejects(
      () => adapter.getProfile('yt-no-ch'),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        /channelId/.test(err.message),
    );
  });

  test('connectionId fantasma → SocialConnectionNotFoundError', async () => {
    const supabase = createMockSupabase({ social_tokens: [] });
    const adapter = createYouTubeAdapter(supabase, {}, 'K');
    await assert.rejects(
      () => adapter.getProfile('00000000-0000-0000-0000-000000000000'),
      SocialConnectionNotFoundError,
    );
  });
});

describe('YouTubeAdapter — getProfile normalização', () => {
  test('mapeia snippet+statistics; hiddenSubscriberCount=false devolve subscriberCount', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedYtConnection({ id: 'yt-prof', accessToken: 'T' })],
    });
    const adapters = createSocialAdapters(supabase, {
      youtube: { fetchChannel: async () => CHANNEL_SNAP },
    });
    const p = await adapters.youtube!.getProfile('yt-prof');
    assert.equal(p.provider, 'youtube');
    assert.equal(p.externalId, 'UC_CANDIDATO');
    assert.equal(p.handle, '@candidato');
    assert.equal(p.displayName, 'Canal do Candidato');
    assert.equal(p.followers, 12_000);
    assert.equal(p.postsCount, 87);
    assert.equal(p.following, null, 'YouTube não tem following count');
  });

  test('hiddenSubscriberCount=true → followers null (§20/§103)', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedYtConnection({ id: 'yt-hidden', accessToken: 'T' })],
    });
    const adapters = createSocialAdapters(supabase, {
      youtube: {
        fetchChannel: async () => ({
          ...CHANNEL_SNAP,
          hiddenSubscriberCount: true,
          subscriberCount: 12_000, // ainda vem no payload mas ignoramos
        }),
      },
    });
    const p = await adapters.youtube!.getProfile('yt-hidden');
    assert.equal(p.followers, null);
  });
});

describe('YouTubeAdapter — getPosts normalização + Short detection', () => {
  test('detecta Short (≤60s) e mapeia contentType', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedYtConnection({ id: 'yt-posts', accessToken: 'T' })],
    });
    const adapters = createSocialAdapters(supabase, {
      youtube: {
        fetchVideos: async () => [VIDEO_LONG, VIDEO_SHORT] as any,
      },
    });
    const posts = await adapters.youtube!.getPosts('yt-posts');
    assert.equal(posts.length, 2);
    assert.equal(posts[0].contentType, 'video');
    assert.equal(posts[1].contentType, 'short');
    assert.equal(posts[0].metrics.views, 42_000);
    assert.equal(posts[1].metrics.views, 100_000);
    assert.equal(posts[0].metrics.watchTime, null, 'watchTime null (Analytics API só)');
    assert.equal(posts[0].accountExternalId, 'UC_CANDIDATO');
    assert.equal(posts[0].permalink, 'https://www.youtube.com/watch?v=video-1');
    assert.equal((posts[0].rawMetadata as any).durationSeconds, 4500);
  });

  test('params.since filtra videos antigos', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedYtConnection({ id: 'yt-since', accessToken: 'T' })],
    });
    const adapters = createSocialAdapters(supabase, {
      youtube: {
        fetchVideos: async () => [VIDEO_LONG, VIDEO_SHORT] as any,
      },
    });
    const recentOnly = await adapters.youtube!.getPosts('yt-since', {
      since: new Date('2026-08-26T00:00:00Z'),
    });
    assert.equal(recentOnly.length, 1);
    assert.equal(recentOnly[0].externalId, 'video-2');
  });
});

describe('YouTubeAdapter — getComments', () => {
  test('com postExternalId chama commentThreads uma vez', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedYtConnection({ id: 'yt-c-post', accessToken: 'T' })],
    });
    let callCount = 0;
    let videoIdSeen: string | null = null;
    const adapters = createSocialAdapters(supabase, {
      youtube: {
        fetchVideoComments: async (_a, videoId) => {
          callCount += 1;
          videoIdSeen = videoId;
          return [COMMENT_1, COMMENT_2] as any;
        },
      },
    });
    const comments = await adapters.youtube!.getComments('yt-c-post', {
      postExternalId: 'video-1',
      limit: 5,
    });
    assert.equal(callCount, 1, 'só 1 chamada quando postExternalId presente');
    assert.equal(videoIdSeen, 'video-1');
    assert.equal(comments.length, 2);
    assert.equal(comments[0].provider, 'youtube');
    assert.equal(comments[0].postExternalId, 'video-1');
    assert.equal(comments[0].authorPublicId, 'UC_ana');
    assert.equal(comments[0].text, 'Parabéns pelo debate!');
    assert.equal(comments[0].likes, 12);
    assert.equal(comments[0].replies, 2);
    assert.equal(comments[0].provenance.sourceType, 'owned');
    assert.match(comments[0].provenance.sourceUrl!, /lc=comm-a/);
  });

  test('sem postExternalId busca videos recentes e concatena comments', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedYtConnection({ id: 'yt-c-all', accessToken: 'T' })],
    });
    const adapters = createSocialAdapters(supabase, {
      youtube: {
        fetchVideos: async () => [VIDEO_LONG, VIDEO_SHORT] as any,
        fetchVideoComments: async (_a, videoId) => {
          if (videoId === 'video-1') return [COMMENT_1] as any;
          if (videoId === 'video-2') return [COMMENT_2] as any;
          return [];
        },
      },
    });
    const all = await adapters.youtube!.getComments('yt-c-all');
    assert.equal(all.length, 2);
    assert.equal(all[0].postExternalId, 'video-1');
    assert.equal(all[1].postExternalId, 'video-2');
  });

  test('video com comments desabilitados (throw) não quebra o batch', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedYtConnection({ id: 'yt-c-fail', accessToken: 'T' })],
    });
    const adapters = createSocialAdapters(supabase, {
      youtube: {
        fetchVideos: async () => [VIDEO_LONG, VIDEO_SHORT] as any,
        fetchVideoComments: async (_a, videoId) => {
          if (videoId === 'video-1') throw new Error('youtube_error_403:comments_disabled');
          return [COMMENT_2] as any;
        },
      },
    });
    const all = await adapters.youtube!.getComments('yt-c-fail');
    assert.equal(all.length, 1, 'só video-2 sobra; video-1 pulou');
    assert.equal(all[0].postExternalId, 'video-2');
  });

  test('params.since filtra comments antigos', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedYtConnection({ id: 'yt-c-since', accessToken: 'T' })],
    });
    const adapters = createSocialAdapters(supabase, {
      youtube: {
        fetchVideoComments: async () => [COMMENT_1, COMMENT_2] as any,
      },
    });
    const recent = await adapters.youtube!.getComments('yt-c-since', {
      postExternalId: 'video-1',
      since: new Date('2026-08-25T20:45:00Z'), // COMMENT_1 é 20:30 → filtra; COMMENT_2 é 21:00 → mantém
    });
    assert.equal(recent.length, 1);
    assert.equal(recent[0].externalId, 'comm-b');
  });
});

describe('YouTubeAdapter — connect/disconnect/refresh/getMetrics throw', () => {
  test('cada método lança SocialCapabilityNotAvailableError com hint', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedYtConnection({ id: 'yt-throw', accessToken: 'T' })],
    });
    const adapters = createSocialAdapters(supabase);
    const yt = adapters.youtube!;
    await assert.rejects(() => yt.connect({ campaignId: CAMP, payload: {} }), SocialCapabilityNotAvailableError);
    await assert.rejects(() => yt.disconnect('yt-throw'), SocialCapabilityNotAvailableError);
    await assert.rejects(() => yt.refreshCredentials('yt-throw'), SocialCapabilityNotAvailableError);
    await assert.rejects(() => yt.getMetrics('yt-throw'), SocialCapabilityNotAvailableError);
  });
});

describe('YouTubeAdapter — parseIsoDurationSeconds helper', () => {
  test('parses PT1H15M, PT45S, PT2M30S, etc', () => {
    assert.equal(parseIsoDurationSeconds('PT1H15M'), 4500);
    assert.equal(parseIsoDurationSeconds('PT45S'), 45);
    assert.equal(parseIsoDurationSeconds('PT2M30S'), 150);
    assert.equal(parseIsoDurationSeconds('PT0S'), 0);
    assert.equal(parseIsoDurationSeconds(''), 0);
    assert.equal(parseIsoDurationSeconds('garbage'), 0);
  });
});
