/**
 * Testes do PR 7 do PRD Social Intelligence — TikTokAdapter.
 *
 * Cobre:
 *  - getCapabilities (beta com reads supported, comments/insights permission_required)
 *  - Resolução de auth: exige accessToken; sem token → not_configured
 *    (TikTok não tem API-key mode)
 *  - getProfile normalização
 *  - getPosts normalização (contentType='short' sempre)
 *  - getComments throws permission_required (Comment API precisa approval)
 *  - connect/disconnect/refresh/getMetrics throw com hint
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

const CAMP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function seedTtConnection(opts: {
  id: string;
  campaignId?: string;
  accessToken?: string | null;
}) {
  return {
    id: opts.id,
    campaignId: opts.campaignId ?? CAMP,
    provider: 'tiktok',
    access_token: null,
    refresh_token: null,
    settings: opts.accessToken ? { accessToken: opts.accessToken } : {},
    status: 'active',
  };
}

const USER_SNAP = {
  openId: 'tt-open-xyz',
  unionId: 'tt-union-abc',
  username: 'candidato_tt',
  displayName: 'Candidato Silva',
  bioDescription: 'Vereador · Cidade X',
  profileDeepLink: 'https://www.tiktok.com/@candidato_tt',
  avatarUrl: 'https://p16-sign.tiktokcdn.com/avatar.jpg',
  followerCount: 22_500,
  followingCount: 130,
  likesCount: 480_000,
  videoCount: 65,
  isVerified: false,
};

const VIDEO_1 = {
  id: 'tt-vid-1',
  ownerOpenId: '',
  title: 'Corte do debate',
  description: 'Corte do debate',
  createTime: Math.floor(new Date('2026-08-26T14:00:00Z').getTime() / 1000),
  durationSeconds: 42,
  shareUrl: 'https://www.tiktok.com/@candidato_tt/video/tt-vid-1',
  embedLink: 'https://www.tiktok.com/embed/tt-vid-1',
  coverImageUrl: 'https://p16-sign.tiktokcdn.com/cover1.jpg',
  videoDescription: 'Melhor momento do debate #eleicoes',
  viewCount: 120_000,
  likeCount: 8_500,
  commentCount: 320,
  shareCount: 450,
  isShort: true,
};

const VIDEO_2 = {
  id: 'tt-vid-2',
  ownerOpenId: '',
  title: 'Bastidores',
  description: 'Bastidores',
  createTime: Math.floor(new Date('2026-08-20T10:00:00Z').getTime() / 1000),
  durationSeconds: 58,
  shareUrl: 'https://www.tiktok.com/@candidato_tt/video/tt-vid-2',
  embedLink: 'https://www.tiktok.com/embed/tt-vid-2',
  coverImageUrl: 'https://p16-sign.tiktokcdn.com/cover2.jpg',
  videoDescription: 'Bastidores da campanha',
  viewCount: 45_000,
  likeCount: 2_100,
  commentCount: 88,
  shareCount: 120,
  isShort: true,
};

// ── Suites ────────────────────────────────────────────────────────────

describe('TikTokAdapter — getCapabilities', () => {
  test('adapterMaturity=beta; reads supported; comments/insights permission_required', () => {
    const supabase = createMockSupabase({ social_tokens: [] });
    const adapters = createSocialAdapters(supabase);
    const caps = adapters.tiktok!.getCapabilities();
    assert.equal(caps.adapterMaturity, 'beta');
    assert.equal(caps.capabilities.profileRead, 'supported');
    assert.equal(caps.capabilities.postsRead, 'supported');
    assert.equal(caps.capabilities.metricsRead, 'supported');
    assert.equal(caps.capabilities.ownCommentsRead, 'permission_required');
    assert.equal(caps.capabilities.audienceInsights, 'permission_required');
    assert.equal(caps.capabilities.thirdPartyCommentsRead, 'unsupported');
    assert.equal(caps.capabilities.publishText, 'unsupported');
    assert.equal(caps.capabilities.publishVideo, 'not_configured');
  });
});

describe('TikTokAdapter — resolveTtConnection', () => {
  test('usa accessToken de settings', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedTtConnection({ id: 'tt-1', accessToken: 'TT-TOKEN' })],
    });
    let authSeen: any = null;
    const adapters = createSocialAdapters(supabase, {
      tiktok: {
        fetchUserInfo: async (auth) => {
          authSeen = auth;
          return USER_SNAP;
        },
      },
    });
    await adapters.tiktok!.getProfile('tt-1');
    assert.deepEqual(authSeen, { accessToken: 'TT-TOKEN' });
  });

  test('sem accessToken → SocialCapabilityNotAvailableError not_configured', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedTtConnection({ id: 'tt-empty', accessToken: null })],
    });
    const adapters = createSocialAdapters(supabase);
    await assert.rejects(
      () => adapters.tiktok!.getProfile('tt-empty'),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        err.level === 'not_configured' &&
        /access_token/.test(err.message),
    );
  });

  test('connectionId fantasma → SocialConnectionNotFoundError', async () => {
    const supabase = createMockSupabase({ social_tokens: [] });
    const adapters = createSocialAdapters(supabase);
    await assert.rejects(
      () => adapters.tiktok!.getProfile('00000000-0000-0000-0000-000000000000'),
      SocialConnectionNotFoundError,
    );
  });
});

describe('TikTokAdapter — getProfile normalização', () => {
  test('mapeia user snapshot completo', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedTtConnection({ id: 'tt-prof', accessToken: 'T' })],
    });
    const adapters = createSocialAdapters(supabase, {
      tiktok: { fetchUserInfo: async () => USER_SNAP },
    });
    const p = await adapters.tiktok!.getProfile('tt-prof');
    assert.equal(p.provider, 'tiktok');
    assert.equal(p.externalId, 'tt-open-xyz');
    assert.equal(p.handle, 'candidato_tt');
    assert.equal(p.displayName, 'Candidato Silva');
    assert.equal(p.followers, 22_500);
    assert.equal(p.following, 130);
    assert.equal(p.postsCount, 65);
    assert.equal(p.avatarUrl, 'https://p16-sign.tiktokcdn.com/avatar.jpg');
    assert.equal((p.raw as any).unionId, 'tt-union-abc');
    assert.equal((p.raw as any).isVerified, false);
  });

  test('follower/following/likes null quando API omite (§20/§103)', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedTtConnection({ id: 'tt-null', accessToken: 'T' })],
    });
    const adapters = createSocialAdapters(supabase, {
      tiktok: {
        fetchUserInfo: async () => ({
          ...USER_SNAP,
          followerCount: null,
          followingCount: null,
          likesCount: null,
        }),
      },
    });
    const p = await adapters.tiktok!.getProfile('tt-null');
    assert.equal(p.followers, null);
    assert.equal(p.following, null);
  });
});

describe('TikTokAdapter — getPosts normalização', () => {
  test('contentType sempre short; publishedAt converte createTime segundos → Date', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedTtConnection({ id: 'tt-posts', accessToken: 'T' })],
    });
    const adapters = createSocialAdapters(supabase, {
      tiktok: {
        fetchUserInfo: async () => USER_SNAP,
        fetchUserVideos: async () => [VIDEO_1, VIDEO_2],
      },
    });
    const posts = await adapters.tiktok!.getPosts('tt-posts');
    assert.equal(posts.length, 2);
    assert.equal(posts[0].contentType, 'short');
    assert.equal(posts[1].contentType, 'short');
    assert.equal(posts[0].externalId, 'tt-vid-1');
    assert.equal(posts[0].accountExternalId, 'tt-open-xyz');
    assert.equal(posts[0].publishedAt.toISOString(), '2026-08-26T14:00:00.000Z');
    assert.equal(posts[0].metrics.views, 120_000);
    assert.equal(posts[0].metrics.shares, 450);
    assert.equal(posts[0].metrics.reach, null, '§20/§103: Display API não expõe reach');
    assert.equal(posts[0].metrics.watchTime, null);
    assert.equal(posts[0].text, 'Melhor momento do debate #eleicoes');
    assert.equal(posts[0].permalink, 'https://www.tiktok.com/@candidato_tt/video/tt-vid-1');
    assert.equal((posts[0].rawMetadata as any).durationSeconds, 42);
  });

  test('params.since filtra videos antigos', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedTtConnection({ id: 'tt-since', accessToken: 'T' })],
    });
    const adapters = createSocialAdapters(supabase, {
      tiktok: {
        fetchUserInfo: async () => USER_SNAP,
        fetchUserVideos: async () => [VIDEO_1, VIDEO_2],
      },
    });
    const recent = await adapters.tiktok!.getPosts('tt-since', {
      since: new Date('2026-08-25T00:00:00Z'),
    });
    assert.equal(recent.length, 1);
    assert.equal(recent[0].externalId, 'tt-vid-1');
  });

  test('accountExternalId fica vazio se fetchUserInfo falhar (não crasha getPosts)', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedTtConnection({ id: 'tt-no-owner', accessToken: 'T' })],
    });
    const adapters = createSocialAdapters(supabase, {
      tiktok: {
        fetchUserInfo: async () => { throw new Error('rate_limited'); },
        fetchUserVideos: async () => [VIDEO_1],
      },
    });
    const posts = await adapters.tiktok!.getPosts('tt-no-owner');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].accountExternalId, '', 'fallback silencioso, permalink ainda serve');
    assert.equal(posts[0].permalink, VIDEO_1.shareUrl);
  });
});

describe('TikTokAdapter — getComments/getMetrics/connect/disconnect/refresh throw', () => {
  test('getComments throw permission_required (Comment API precisa approval)', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedTtConnection({ id: 'tt-c', accessToken: 'T' })],
    });
    const adapters = createSocialAdapters(supabase);
    await assert.rejects(
      () => adapters.tiktok!.getComments('tt-c'),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        err.level === 'permission_required',
    );
  });

  test('connect / disconnect / refresh / getMetrics todos lançam SocialCapabilityNotAvailableError', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedTtConnection({ id: 'tt-t', accessToken: 'T' })],
    });
    const adapters = createSocialAdapters(supabase);
    const tt = adapters.tiktok!;
    await assert.rejects(() => tt.connect({ campaignId: CAMP, payload: {} }), SocialCapabilityNotAvailableError);
    await assert.rejects(() => tt.disconnect('tt-t'), SocialCapabilityNotAvailableError);
    await assert.rejects(() => tt.refreshCredentials('tt-t'), SocialCapabilityNotAvailableError);
    await assert.rejects(() => tt.getMetrics('tt-t'), SocialCapabilityNotAvailableError);
  });
});
