/**
 * Testes do PR 4 do PRD Social Intelligence — InstagramMetaAdapter.
 *
 * Nuance importante: storage é `provider='meta'` (compartilhado com FB),
 * mas o adapter apresenta `provider='instagram'`. Os testes validam essa
 * ponte + normalização IgPost/IgComment → NormalizedSocialPost/Comment.
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
  igUserId?: string;
  token?: string;
  username?: string;
}) {
  return {
    id: opts.id,
    campaignId: opts.campaignId ?? CAMP,
    provider: 'meta',
    access_token: null,
    refresh_token: null,
    settings: {
      accountId: opts.igUserId ?? '17841000000000000',
      accessToken: opts.token ?? 'META-LONG-LIVED-TOKEN',
      username: opts.username ?? 'candidato',
    },
    status: 'active',
  };
}

const IG_ACCOUNT_PROFILE = {
  igUserId: '17841000000000000',
  username: 'candidato',
  name: 'Candidato Silva',
  followersCount: 45_000,
  mediaCount: 132,
  biography: 'Vereador · Cidade X',
  profilePictureUrl: 'https://cdn.instagram.com/pic.jpg',
};

const IG_MEDIA_WITH_COMMENTS = [
  {
    caption: 'Novo posto de saúde no bairro!',
    likeCount: 320,
    commentsCount: 47,
    timestamp: '2026-08-25T14:00:00+0000',
    permalink: 'https://www.instagram.com/p/AbCdEfGhIjK/',
    mediaType: 'IMAGE',
    comments: [
      { text: 'Enfim!', username: 'user_a', timestamp: '2026-08-25T14:05:00+0000', likeCount: 3 },
      { text: 'Quando abre?', username: 'user_b', timestamp: '2026-08-25T14:10:00+0000', likeCount: 1 },
    ],
  },
  {
    caption: 'Reel de campanha',
    likeCount: 900,
    commentsCount: 120,
    timestamp: '2026-08-24T10:00:00+0000',
    permalink: 'https://www.instagram.com/reel/ReelXyZ123/',
    mediaType: 'VIDEO',
    comments: [
      { text: 'Boa!', username: 'user_c', timestamp: '2026-08-24T10:15:00+0000', likeCount: 10 },
    ],
  },
  {
    caption: 'Carrossel semanal',
    likeCount: 150,
    commentsCount: 5,
    timestamp: '2026-08-20T09:00:00+0000',
    permalink: 'https://www.instagram.com/p/CarouselAaa/',
    mediaType: 'CAROUSEL_ALBUM',
    comments: [],
  },
];

describe('InstagramMetaAdapter — getCapabilities', () => {
  test('adapterMaturity=beta e ownCommentsRead=supported', () => {
    const supabase = createMockSupabase({ social_tokens: [] });
    const adapters = createSocialAdapters(supabase);
    const caps = adapters.instagram!.getCapabilities();
    assert.equal(caps.adapterMaturity, 'beta');
    assert.equal(caps.capabilities.ownCommentsRead, 'supported');
    assert.equal(caps.capabilities.competitorDiscovery, 'supported');
    // Third-party comments texto é explicitamente unsupported pela Meta.
    assert.equal(caps.capabilities.thirdPartyCommentsRead, 'unsupported');
  });
});

describe('InstagramMetaAdapter — resolveIgConnection (storage=meta)', () => {
  test('resolve pela linha provider=meta, não instagram', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'ig-conn-1' })],
    });

    let called = false;
    const adapters = createSocialAdapters(supabase, {
      instagram: {
        fetchAccountProfile: async (conn) => {
          called = true;
          assert.equal(conn.igUserId, '17841000000000000');
          assert.equal(conn.token, 'META-LONG-LIVED-TOKEN');
          assert.equal(conn.username, 'candidato');
          return IG_ACCOUNT_PROFILE as any;
        },
      },
    });
    const p = await adapters.instagram!.getProfile('ig-conn-1');
    assert.equal(called, true);
    assert.equal(p.provider, 'instagram');
    assert.equal(p.followers, 45_000);
    assert.equal(p.postsCount, 132);
  });

  test('sem settings.accountId → SocialCapabilityNotAvailableError not_configured', async () => {
    const supabase = createMockSupabase({
      social_tokens: [{
        id: 'ig-broken', campaignId: CAMP, provider: 'meta',
        settings: { accessToken: 't' }, // sem accountId
        access_token: null, status: 'active',
      }],
    });
    const adapters = createSocialAdapters(supabase);
    await assert.rejects(
      () => adapters.instagram!.getProfile('ig-broken'),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        err.level === 'not_configured' &&
        /accountId/.test(err.message),
    );
  });

  test('sem token em lugar nenhum → SocialCapabilityNotAvailableError not_configured', async () => {
    // Guarda o env pra restaurar
    const prev = process.env.META_ACCESS_TOKEN;
    delete process.env.META_ACCESS_TOKEN;
    try {
      const supabase = createMockSupabase({
        social_tokens: [{
          id: 'ig-no-token', campaignId: CAMP, provider: 'meta',
          settings: { accountId: '178' }, access_token: null, token: null,
          status: 'active',
        }],
      });
      const adapters = createSocialAdapters(supabase);
      await assert.rejects(
        () => adapters.instagram!.getProfile('ig-no-token'),
        (err: unknown) =>
          err instanceof SocialCapabilityNotAvailableError &&
          err.level === 'not_configured',
      );
    } finally {
      if (prev !== undefined) process.env.META_ACCESS_TOKEN = prev;
    }
  });

  test('connectionId fantasma → SocialConnectionNotFoundError', async () => {
    const supabase = createMockSupabase({ social_tokens: [] });
    const adapters = createSocialAdapters(supabase);
    await assert.rejects(
      () => adapters.instagram!.getProfile('00000000-0000-0000-0000-000000000000'),
      SocialConnectionNotFoundError,
    );
  });
});

describe('InstagramMetaAdapter — getPosts normalização', () => {
  test('mapeia mediaType para contentType e permalink → externalId (shortcode)', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'ig-1' })],
    });
    const adapters = createSocialAdapters(supabase, {
      instagram: {
        fetchOwnMediaWithComments: async () => IG_MEDIA_WITH_COMMENTS as any,
      },
    });

    const posts = await adapters.instagram!.getPosts('ig-1');
    assert.equal(posts.length, 3);
    assert.equal(posts[0].externalId, 'AbCdEfGhIjK');
    assert.equal(posts[0].contentType, 'image');
    assert.equal(posts[0].metrics.likes, 320);
    assert.equal(posts[0].metrics.comments, 47);
    assert.equal(posts[0].metrics.reach, null, '§20/§103: null quando API não expõe');
    assert.equal(posts[0].metrics.impressions, null);
    assert.equal(posts[0].accountExternalId, '17841000000000000');

    assert.equal(posts[1].externalId, 'ReelXyZ123');
    assert.equal(posts[1].contentType, 'video');
    assert.equal(posts[2].contentType, 'carousel');
  });

  test('respeita params.since (filtra posts mais antigos)', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'ig-since' })],
    });
    const adapters = createSocialAdapters(supabase, {
      instagram: {
        fetchOwnMediaWithComments: async () => IG_MEDIA_WITH_COMMENTS as any,
      },
    });
    // Só pega posts a partir de 2026-08-24
    const posts = await adapters.instagram!.getPosts('ig-since', {
      since: new Date('2026-08-24T00:00:00Z'),
    });
    assert.equal(posts.length, 2);
    assert.ok(!posts.find(p => p.externalId === 'CarouselAaa'));
  });
});

describe('InstagramMetaAdapter — getComments normalização', () => {
  test('extrai comentários com proveniência owned', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'ig-c' })],
    });
    const adapters = createSocialAdapters(supabase, {
      instagram: {
        fetchOwnMediaWithComments: async () => IG_MEDIA_WITH_COMMENTS as any,
      },
    });
    const comments = await adapters.instagram!.getComments('ig-c');
    assert.equal(comments.length, 3);
    for (const c of comments) {
      assert.equal(c.provider, 'instagram');
      assert.equal(c.provenance.sourceType, 'owned');
      assert.equal(c.provenance.dataAvailability, 'observed');
      assert.equal(c.provenance.provider, 'instagram');
    }
    assert.equal(comments[0].text, 'Enfim!');
    assert.equal(comments[0].authorPublicId, 'user_a');
    assert.equal(comments[0].postExternalId, 'AbCdEfGhIjK');
    assert.equal(comments[0].likes, 3);
    assert.equal(comments[0].replies, null);
  });

  test('filtra por postExternalId', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'ig-filter' })],
    });
    const adapters = createSocialAdapters(supabase, {
      instagram: {
        fetchOwnMediaWithComments: async () => IG_MEDIA_WITH_COMMENTS as any,
      },
    });
    const only = await adapters.instagram!.getComments('ig-filter', {
      postExternalId: 'ReelXyZ123',
    });
    assert.equal(only.length, 1);
    assert.equal(only[0].postExternalId, 'ReelXyZ123');
    assert.equal(only[0].authorPublicId, 'user_c');
  });
});

describe('InstagramMetaAdapter — connect/disconnect/refresh todos throw', () => {
  test('connect throw com hint sobre PR 5', async () => {
    const supabase = createMockSupabase({ social_tokens: [] });
    const adapters = createSocialAdapters(supabase);
    await assert.rejects(
      () => adapters.instagram!.connect({ campaignId: CAMP, payload: {} }),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        /PR 5/.test(err.message),
    );
  });

  test('disconnect throw — credencial compartilhada com Facebook', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'ig-d' })],
    });
    const adapters = createSocialAdapters(supabase);
    await assert.rejects(
      () => adapters.instagram!.disconnect('ig-d'),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        /compartilhad/.test(err.message),
    );
  });

  test('refreshCredentials throw — Meta long-lived exchange é PR 5', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'ig-r' })],
    });
    const adapters = createSocialAdapters(supabase);
    await assert.rejects(
      () => adapters.instagram!.refreshCredentials('ig-r'),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        /fb_exchange_token/.test(err.message),
    );
  });

  test('getMetrics throw — normalização vem com Ingestion Engine (PR 6)', async () => {
    const supabase = createMockSupabase({
      social_tokens: [seedMetaConnection({ id: 'ig-m' })],
    });
    const adapters = createSocialAdapters(supabase);
    await assert.rejects(
      () => adapters.instagram!.getMetrics('ig-m'),
      (err: unknown) =>
        err instanceof SocialCapabilityNotAvailableError &&
        /Ingestion Engine/.test(err.message),
    );
  });
});
