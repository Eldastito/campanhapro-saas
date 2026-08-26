/**
 * Testes do PR 5 do PRD Social Intelligence — FacebookMetaAdapter.
 *
 * Nuance idêntica ao InstagramMetaAdapter (PR 4): storage é
 * `provider='meta'` (compartilhado), mas o adapter apresenta `provider='facebook'`.
 * O `resolveFacebookPage` interno auto-deriva pageId + pageAccessToken via
 * /me/accounts se não estiverem salvos.
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

function seedMetaConnection(opts: {
  id: string;
  campaignId?: string;
  userToken?: string;
  pageId?: string;
  pageAccessToken?: string;
  pageName?: string;
}) {
  return {
    id: opts.id,
    campaignId: opts.campaignId ?? CAMP,
    provider: 'meta',
    access_token: null,
    refresh_token: null,
    settings: {
      accessToken: opts.userToken ?? 'META-USER-TOKEN',
      // Note: pageId/pageAccessToken opcionais — se omitidos, adapter deve
      // derivar via /me/accounts (simulado pelo resolveFacebookPage mockado).
      ...(opts.pageId ? { pageId: opts.pageId } : {}),
      ...(opts.pageAccessToken ? { pageAccessToken: opts.pageAccessToken } : {}),
      ...(opts.pageName ? { pageName: opts.pageName } : {}),
    },
    status: 'active',
  };
}

const FAKE_PAGE_CONN = {
  pageId: '101010101010',
  pageAccessToken: 'PAGE-TOKEN-LONG',
  pageName: 'Comitê Silva',
};

const FAKE_PAGE_PROFILE = {
  pageId: '101010101010',
  name: 'Comitê Silva',
  category: 'Political Organization',
  fanCount: 3200,
  followersCount: 4100,
  about: 'Página oficial da campanha',
  link: 'https://www.facebook.com/comitesilva',
  pictureUrl: 'https://scontent.fb.com/pic.jpg',
};

const FAKE_PAGE_POSTS = [
  {
    id: '101010101010_555',
    message: 'Novo posto de saúde aberto no bairro X!',
    createdTime: '2026-08-26T14:00:00+0000',
    permalinkUrl: 'https://www.facebook.com/comitesilva/posts/555',
    mediaType: 'photo' as const,
    reactionsCount: 240,
    commentsCount: 38,
    sharesCount: 15,
    comments: [
      { id: '555_c1', postId: '101010101010_555', message: 'Ótima notícia!', createdTime: '2026-08-26T14:05:00+0000', fromName: 'Ana', fromId: 'user_a', likeCount: 4 },
      { id: '555_c2', postId: '101010101010_555', message: 'Quando abre?', createdTime: '2026-08-26T14:10:00+0000', fromName: 'Beto', fromId: 'user_b', likeCount: 1 },
    ],
  },
  {
    id: '101010101010_556',
    message: 'Live hoje às 20h',
    createdTime: '2026-08-25T18:00:00+0000',
    permalinkUrl: 'https://www.facebook.com/comitesilva/posts/556',
    mediaType: 'video' as const,
    reactionsCount: 900,
    commentsCount: 120,
    sharesCount: 200,
    comments: [
      { id: '556_c1', postId: '101010101010_556', message: 'Vou assistir!', createdTime: '2026-08-25T18:05:00+0000', fromName: 'Carla', fromId: 'user_c', likeCount: 12 },
    ],
  },
  {
    id: '101010101010_557',
    message: null, // status sem texto
    createdTime: '2026-08-20T10:00:00+0000',
    permalinkUrl: 'https://www.facebook.com/comitesilva/posts/557',
    mediaType: 'status' as const,
    reactionsCount: 30,
    commentsCount: 2,
    sharesCount: 0,
    comments: [],
  },
];

describe('FacebookMetaAdapter — getCapabilities', () => {
  test('adapterMaturity=beta, postsRead=supported, ownCommentsRead=supported', () => {
    const supabase = createMockSupabase({ social_tokens: [] });
    const adapters = createSocialAdapters(supabase);
    const caps = adapters.facebook!.getCapabilities();
    assert.equal(caps.adapterMaturity, 'beta');
    assert.equal(caps.capabilities.profileRead, 'supported');
    assert.equal(caps.capabilities.postsRead, 'supported');
    assert.equal(caps.capabilities.ownCommentsRead, 'supported');
    assert.equal(caps.capabilities.thirdPartyCommentsRead, 'provider_restricted');
    assert.equal(caps.capabilities.publishText, 'not_configured');
  });
});

describe('FacebookMetaAdapter — resolveFbConnectionForAdapter (storage=meta)', () => {
  test('resolve via provider=meta e chama resolveFacebookPage', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'fb-conn-1' })],
    });

    let resolveCalledWith: string | null = null;
    const adapters = createSocialAdapters(supabase, {
      facebook: {
        resolveFacebookPage: async (_sb, campaignId) => {
          resolveCalledWith = campaignId;
          return FAKE_PAGE_CONN;
        },
        fetchFbPageProfile: async () => FAKE_PAGE_PROFILE,
      },
    });
    const p = await adapters.facebook!.getProfile('fb-conn-1');
    assert.equal(resolveCalledWith, CAMP);
    assert.equal(p.externalId, '101010101010');
    assert.equal(p.displayName, 'Comitê Silva');
  });

  test('resolveFacebookPage devolvendo null → SocialCapabilityNotAvailableError not_configured', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'fb-no-page' })],
    });
    const adapters = createSocialAdapters(supabase, {
      facebook: {
        resolveFacebookPage: async () => null,
      },
    });
    await assert.rejects(
      () => adapters.facebook!.getProfile('fb-no-page'),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        err.level === 'not_configured' &&
        /Page/.test(err.message),
    );
  });

  test('connectionId fantasma → SocialConnectionNotFoundError', async () => {
    const supabase = createMockSupabase({ social_tokens: [] });
    const adapters = createSocialAdapters(supabase);
    await assert.rejects(
      () => adapters.facebook!.getProfile('00000000-0000-0000-0000-000000000000'),
      SocialConnectionNotFoundError,
    );
  });
});

describe('FacebookMetaAdapter — getProfile normalização', () => {
  test('prefere followersCount sobre fanCount (§20/§103: nunca 0)', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'fb-prof' })],
    });
    const adapters = createSocialAdapters(supabase, {
      facebook: {
        resolveFacebookPage: async () => FAKE_PAGE_CONN,
        fetchFbPageProfile: async () => FAKE_PAGE_PROFILE,
      },
    });
    const p = await adapters.facebook!.getProfile('fb-prof');
    assert.equal(p.followers, 4100, 'followersCount ganha de fanCount');
    assert.equal(p.provider, 'facebook');
    assert.equal(p.postsCount, null, 'postsCount null quando não pedido');
    assert.equal(p.following, null, 'Page não segue ninguém');
  });

  test('fanCount usado quando followersCount é null', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'fb-fan' })],
    });
    const adapters = createSocialAdapters(supabase, {
      facebook: {
        resolveFacebookPage: async () => FAKE_PAGE_CONN,
        fetchFbPageProfile: async () => ({
          ...FAKE_PAGE_PROFILE,
          followersCount: null,
          fanCount: 999,
        }),
      },
    });
    const p = await adapters.facebook!.getProfile('fb-fan');
    assert.equal(p.followers, 999);
  });

  test('ambos null → followers null (nunca 0)', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'fb-nn' })],
    });
    const adapters = createSocialAdapters(supabase, {
      facebook: {
        resolveFacebookPage: async () => FAKE_PAGE_CONN,
        fetchFbPageProfile: async () => ({
          ...FAKE_PAGE_PROFILE,
          followersCount: null,
          fanCount: null,
        }),
      },
    });
    const p = await adapters.facebook!.getProfile('fb-nn');
    assert.equal(p.followers, null);
  });
});

describe('FacebookMetaAdapter — getPosts normalização', () => {
  test('mapeia mediaType e usa post.id como externalId', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'fb-posts' })],
    });
    const adapters = createSocialAdapters(supabase, {
      facebook: {
        resolveFacebookPage: async () => FAKE_PAGE_CONN,
        fetchFbPagePostsWithComments: async () => FAKE_PAGE_POSTS as any,
      },
    });
    const posts = await adapters.facebook!.getPosts('fb-posts');
    assert.equal(posts.length, 3);
    assert.equal(posts[0].externalId, '101010101010_555');
    assert.equal(posts[0].contentType, 'image');
    assert.equal(posts[1].contentType, 'video');
    assert.equal(posts[2].contentType, 'text');
    assert.equal(posts[0].metrics.likes, 240);
    assert.equal(posts[0].metrics.shares, 15);
    assert.equal(posts[0].metrics.reach, null, '§20/§103: null quando /insights não foi chamado');
    assert.equal(posts[0].accountExternalId, '101010101010');
  });

  test('params.since filtra posts mais antigos', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'fb-since' })],
    });
    const adapters = createSocialAdapters(supabase, {
      facebook: {
        resolveFacebookPage: async () => FAKE_PAGE_CONN,
        fetchFbPagePostsWithComments: async () => FAKE_PAGE_POSTS as any,
      },
    });
    const posts = await adapters.facebook!.getPosts('fb-since', {
      since: new Date('2026-08-25T00:00:00Z'),
    });
    assert.equal(posts.length, 2);
    assert.ok(!posts.find(p => p.externalId === '101010101010_557'));
  });
});

describe('FacebookMetaAdapter — getComments normalização', () => {
  test('extrai comments com proveniência owned + fromId como authorPublicId', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'fb-c' })],
    });
    const adapters = createSocialAdapters(supabase, {
      facebook: {
        resolveFacebookPage: async () => FAKE_PAGE_CONN,
        fetchFbPagePostsWithComments: async () => FAKE_PAGE_POSTS as any,
      },
    });
    const comments = await adapters.facebook!.getComments('fb-c');
    assert.equal(comments.length, 3);
    for (const c of comments) {
      assert.equal(c.provider, 'facebook');
      assert.equal(c.provenance.sourceType, 'owned');
      assert.equal(c.provenance.dataAvailability, 'observed');
    }
    assert.equal(comments[0].text, 'Ótima notícia!');
    assert.equal(comments[0].authorPublicId, 'user_a');
    assert.equal(comments[0].postExternalId, '101010101010_555');
    assert.equal(comments[0].likes, 4);
  });

  test('filtra por postExternalId', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'fb-cf' })],
    });
    const adapters = createSocialAdapters(supabase, {
      facebook: {
        resolveFacebookPage: async () => FAKE_PAGE_CONN,
        fetchFbPagePostsWithComments: async () => FAKE_PAGE_POSTS as any,
      },
    });
    const only = await adapters.facebook!.getComments('fb-cf', {
      postExternalId: '101010101010_556',
    });
    assert.equal(only.length, 1);
    assert.equal(only[0].postExternalId, '101010101010_556');
    assert.equal(only[0].authorPublicId, 'user_c');
  });
});

describe('FacebookMetaAdapter — connect/disconnect/refresh/metrics throw', () => {
  test('connect throw com hint sobre Meta OAuth futuro', async () => {
    const supabase = createMockSupabase({ social_tokens: [] });
    const adapters = createSocialAdapters(supabase);
    await assert.rejects(
      () => adapters.facebook!.connect({ campaignId: CAMP, payload: {} }),
      SocialCapabilityNotAvailableError,
    );
  });

  test('disconnect throw — credencial compartilhada com Instagram', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'fb-d' })],
    });
    const adapters = createSocialAdapters(supabase);
    await assert.rejects(
      () => adapters.facebook!.disconnect('fb-d'),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        /compartilhad/.test(err.message),
    );
  });

  test('refreshCredentials throw — fb_exchange_token é PR futuro', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'fb-r' })],
    });
    const adapters = createSocialAdapters(supabase);
    await assert.rejects(
      () => adapters.facebook!.refreshCredentials('fb-r'),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        /fb_exchange_token/.test(err.message),
    );
  });

  test('getMetrics throw — /insights entra com PR 6', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'fb-m' })],
    });
    const adapters = createSocialAdapters(supabase);
    await assert.rejects(
      () => adapters.facebook!.getMetrics('fb-m'),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        /Ingestion Engine/.test(err.message),
    );
  });
});
