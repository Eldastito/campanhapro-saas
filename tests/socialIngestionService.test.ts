/**
 * Testes do PR 8 do PRD Social Intelligence — SocialIngestionService.
 *
 * Cobre:
 *   - ingestPosts / ingestComments happy path (posts entram no store)
 *   - Idempotência (§34): mesmo post entra 2x → 1 row (dedup via
 *     UNIQUE constraint + upsert onConflict do mock)
 *   - Tolerância a SocialCapabilityNotAvailableError (skip silencioso
 *     com reason='unavailable')
 *   - Erro genérico do adapter propaga com reason='error'
 *   - Empty result devolve reason='ok' com 0 counts
 *   - queryStoredPosts / queryStoredComments respeitam filtros
 *   - Provenance obrigatória serializada corretamente
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';

import {
  ingestPosts,
  ingestComments,
  queryStoredPosts,
  queryStoredComments,
} from '../src/server/modules/social/socialIngestionService';
import {
  SocialCapabilityNotAvailableError,
} from '../src/server/modules/social/adapters/errors';
import type {
  SocialProviderAdapter,
  NormalizedSocialPost,
  NormalizedSocialComment,
} from '../src/server/modules/social/contracts/socialProviderAdapter';

const CAMP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// ── Fixtures ─────────────────────────────────────────────────────────

function fakePost(id: string, overrides: Partial<NormalizedSocialPost> = {}): NormalizedSocialPost {
  return {
    provider: 'x',
    externalId: id,
    accountExternalId: 'acc-1',
    publishedAt: new Date('2026-08-25T14:00:00Z'),
    contentType: 'text',
    text: `post ${id}`,
    permalink: `https://x.com/1/status/${id}`,
    metrics: {
      views: 100, reach: null, impressions: null,
      likes: 10, comments: 2, shares: null, saves: null, watchTime: null,
    },
    ...overrides,
  };
}

function fakeComment(id: string, overrides: Partial<NormalizedSocialComment> = {}): NormalizedSocialComment {
  return {
    provider: 'x',
    externalId: id,
    postExternalId: 'post-abc',
    authorPublicId: 'user_a',
    text: `comment ${id}`,
    publishedAt: new Date('2026-08-25T15:00:00Z'),
    likes: 3,
    replies: null,
    provenance: {
      provider: 'x',
      sourceType: 'owned',
      collectedAt: new Date('2026-08-26T00:00:00Z'),
      dataAvailability: 'observed',
    },
    ...overrides,
  };
}

function stubAdapter(overrides: Partial<SocialProviderAdapter> = {}): SocialProviderAdapter {
  return {
    provider: 'x',
    getCapabilities: () => ({ adapterMaturity: 'production', capabilities: {} as any }),
    connect: async () => { throw new Error('not used'); },
    disconnect: async () => { throw new Error('not used'); },
    refreshCredentials: async () => { throw new Error('not used'); },
    getProfile: async () => { throw new Error('not used'); },
    getPosts: async () => [] as NormalizedSocialPost[],
    getComments: async () => [] as NormalizedSocialComment[],
    getMetrics: async () => { throw new Error('not used'); },
    ...overrides,
  };
}

// ── Suites ────────────────────────────────────────────────────────────

describe('ingestPosts — happy path', () => {
  test('ingere 3 posts e devolve reason=ok com contadores', async () => {
    const supabase = createMockSupabase({ social_posts: [] });
    const adapter = stubAdapter({
      getPosts: async () => [fakePost('p1'), fakePost('p2'), fakePost('p3')],
    });
    const result = await ingestPosts(supabase, adapter, CAMP, 'conn-1');
    assert.equal(result.reason, 'ok');
    assert.equal(result.attempted, 3);
    assert.equal(result.ingested, 3);
    assert.equal(result.provider, 'x');

    const stored = (supabase as any)._store.get('social_posts');
    assert.equal(stored.length, 3);
    assert.equal(stored[0].externalId, 'p1');
    assert.equal(stored[0].campaignId, CAMP);
    assert.equal(stored[0].provider, 'x');
    assert.ok(stored[0].provenance, 'provenance obrigatória gravada');
    assert.equal(stored[0].provenance.sourceType, 'owned');
    assert.equal(stored[0].provenance.dataAvailability, 'observed');
    // publishedAt convertido pra ISO
    assert.equal(typeof stored[0].publishedAt, 'string');
    assert.match(stored[0].publishedAt, /^2026-08-25T14:00:00/);
  });

  test('preserva metrics como objeto (jsonb)', async () => {
    const supabase = createMockSupabase({ social_posts: [] });
    const adapter = stubAdapter({
      getPosts: async () => [fakePost('p1', {
        metrics: { views: 500, reach: null, impressions: null, likes: 42, comments: 5, shares: 3, saves: null, watchTime: null },
      })],
    });
    await ingestPosts(supabase, adapter, CAMP, 'conn-1');
    const stored = (supabase as any)._store.get('social_posts')[0];
    assert.equal(stored.metrics.views, 500);
    assert.equal(stored.metrics.likes, 42);
    assert.equal(stored.metrics.reach, null, '§20/§103: null preservado no jsonb');
  });

  test('provenanceOverride merga sobre o default', async () => {
    const supabase = createMockSupabase({ social_posts: [] });
    const adapter = stubAdapter({
      getPosts: async () => [fakePost('p1')],
    });
    await ingestPosts(supabase, adapter, CAMP, 'conn-1', undefined, {
      dataAvailability: 'provider_aggregated' as any,
    });
    const stored = (supabase as any)._store.get('social_posts')[0];
    assert.equal(stored.provenance.dataAvailability, 'provider_aggregated');
    assert.equal(stored.provenance.sourceType, 'owned', 'default preservado');
  });
});

describe('ingestPosts — idempotência (§34)', () => {
  test('ingerir mesmo post 2x devolve upsert (1 row no store final)', async () => {
    const supabase = createMockSupabase({ social_posts: [] });
    const adapter = stubAdapter({
      getPosts: async () => [fakePost('dup')],
    });

    await ingestPosts(supabase, adapter, CAMP, 'conn-1');
    let stored = (supabase as any)._store.get('social_posts');
    assert.equal(stored.length, 1);
    const firstIngestedAt = stored[0].ingestedAt;

    // Re-ingerir mesmo post — mock upsert usa onConflict pra deduplicar
    await ingestPosts(supabase, adapter, CAMP, 'conn-1');
    stored = (supabase as any)._store.get('social_posts');
    assert.equal(stored.length, 1, 'ainda 1 row após 2 ingests');
    assert.equal(stored[0].externalId, 'dup');
    // ingestedAt não é sobrescrito pelo upsert (só updatedAt)
    // (behavior verificável no mock: onConflict merge)
    assert.equal(stored[0].ingestedAt, firstIngestedAt);
  });

  test('atualização de metrics no upsert sobrescreve valores antigos', async () => {
    const supabase = createMockSupabase({ social_posts: [] });
    const adapter1 = stubAdapter({
      getPosts: async () => [fakePost('p1', {
        metrics: { views: 100, reach: null, impressions: null, likes: 10, comments: 2, shares: null, saves: null, watchTime: null },
      })],
    });
    await ingestPosts(supabase, adapter1, CAMP, 'conn-1');

    // Segundo call: métricas cresceram
    const adapter2 = stubAdapter({
      getPosts: async () => [fakePost('p1', {
        metrics: { views: 500, reach: null, impressions: null, likes: 50, comments: 8, shares: null, saves: null, watchTime: null },
      })],
    });
    await ingestPosts(supabase, adapter2, CAMP, 'conn-1');

    const stored = (supabase as any)._store.get('social_posts');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].metrics.views, 500, 'metrics atualizadas');
    assert.equal(stored[0].metrics.likes, 50);
  });
});

describe('ingestPosts — tolerância a erros', () => {
  test('SocialCapabilityNotAvailableError → reason=unavailable, não propaga', async () => {
    const supabase = createMockSupabase({ social_posts: [] });
    const adapter = stubAdapter({
      getPosts: async () => {
        throw new SocialCapabilityNotAvailableError('tiktok', 'postsRead', 'permission_required');
      },
    });
    const result = await ingestPosts(supabase, adapter, CAMP, 'conn-1');
    assert.equal(result.reason, 'unavailable');
    assert.equal(result.attempted, 0);
    assert.equal(result.ingested, 0);
    assert.match(result.errorMessage!, /permission_required/);
    // Nada foi para o store
    assert.equal((supabase as any)._store.get('social_posts').length, 0);
  });

  test('erro genérico → reason=error, não propaga', async () => {
    const supabase = createMockSupabase({ social_posts: [] });
    const adapter = stubAdapter({
      getPosts: async () => { throw new Error('rate_limited'); },
    });
    const result = await ingestPosts(supabase, adapter, CAMP, 'conn-1');
    assert.equal(result.reason, 'error');
    assert.match(result.errorMessage!, /rate_limited/);
  });

  test('empty result → reason=ok com 0 counts', async () => {
    const supabase = createMockSupabase({ social_posts: [] });
    const adapter = stubAdapter({ getPosts: async () => [] });
    const result = await ingestPosts(supabase, adapter, CAMP, 'conn-1');
    assert.equal(result.reason, 'ok');
    assert.equal(result.attempted, 0);
    assert.equal(result.ingested, 0);
  });

  test('input inválido lança (guard rail)', async () => {
    const supabase = createMockSupabase({ social_posts: [] });
    const adapter = stubAdapter();
    await assert.rejects(() => ingestPosts(supabase, adapter, '', 'conn'), /campaignId/);
    await assert.rejects(() => ingestPosts(supabase, adapter, CAMP, ''), /connectionId/);
  });
});

describe('ingestComments', () => {
  test('happy path — provenance com collectedAt Date virou ISO string', async () => {
    const supabase = createMockSupabase({ social_comments: [] });
    const adapter = stubAdapter({
      getComments: async () => [fakeComment('c1'), fakeComment('c2')],
    });
    const result = await ingestComments(supabase, adapter, CAMP, 'conn-1');
    assert.equal(result.reason, 'ok');
    assert.equal(result.ingested, 2);

    const stored = (supabase as any)._store.get('social_comments');
    assert.equal(stored.length, 2);
    assert.equal(typeof stored[0].provenance.collectedAt, 'string');
    assert.match(stored[0].provenance.collectedAt, /^2026-08-26T00:00:00/);
    assert.equal(stored[0].postExternalId, 'post-abc');
    assert.equal(stored[0].authorPublicId, 'user_a');
  });

  test('SocialCapabilityNotAvailableError → reason=unavailable', async () => {
    const supabase = createMockSupabase({ social_comments: [] });
    const adapter = stubAdapter({
      getComments: async () => {
        throw new SocialCapabilityNotAvailableError('tiktok', 'ownCommentsRead', 'permission_required');
      },
    });
    const result = await ingestComments(supabase, adapter, CAMP, 'conn-1');
    assert.equal(result.reason, 'unavailable');
    assert.equal((supabase as any)._store.get('social_comments').length, 0);
  });
});

describe('queryStoredPosts / queryStoredComments', () => {
  test('filtra por provider e por since', async () => {
    const supabase = createMockSupabase({
      social_posts: [
        { id: '1', campaignId: CAMP, provider: 'x', externalId: 'x-old', publishedAt: '2026-01-01T00:00:00Z' },
        { id: '2', campaignId: CAMP, provider: 'x', externalId: 'x-new', publishedAt: '2026-08-26T00:00:00Z' },
        { id: '3', campaignId: CAMP, provider: 'linkedin', externalId: 'li-1', publishedAt: '2026-08-26T00:00:00Z' },
      ],
    });
    const onlyX = await queryStoredPosts(supabase, CAMP, { provider: 'x' });
    assert.equal(onlyX.length, 2);
    assert.ok(onlyX.every(p => p.provider === 'x'));

    const recent = await queryStoredPosts(supabase, CAMP, { since: new Date('2026-06-01T00:00:00Z') });
    assert.equal(recent.length, 2, 'x-new + li-1');
    assert.ok(!recent.find(p => p.externalId === 'x-old'));

    const bothFilters = await queryStoredPosts(supabase, CAMP, {
      provider: 'linkedin',
      since: new Date('2026-08-01T00:00:00Z'),
    });
    assert.equal(bothFilters.length, 1);
    assert.equal(bothFilters[0].externalId, 'li-1');
  });

  test('tenant isolation: outra campanha não vaza', async () => {
    const supabase = createMockSupabase({
      social_posts: [
        { id: '1', campaignId: CAMP, provider: 'x', externalId: 'mine', publishedAt: '2026-08-26T00:00:00Z' },
        { id: '2', campaignId: 'other-camp', provider: 'x', externalId: 'theirs', publishedAt: '2026-08-26T00:00:00Z' },
      ],
    });
    const mine = await queryStoredPosts(supabase, CAMP);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].externalId, 'mine');
  });

  test('queryStoredComments filtra por postExternalId', async () => {
    const supabase = createMockSupabase({
      social_comments: [
        { id: '1', campaignId: CAMP, provider: 'x', externalId: 'c1', postExternalId: 'post-A', publishedAt: '2026-08-26T00:00:00Z' },
        { id: '2', campaignId: CAMP, provider: 'x', externalId: 'c2', postExternalId: 'post-B', publishedAt: '2026-08-26T00:00:00Z' },
      ],
    });
    const onlyA = await queryStoredComments(supabase, CAMP, { postExternalId: 'post-A' });
    assert.equal(onlyA.length, 1);
    assert.equal(onlyA[0].externalId, 'c1');
  });

  test('empty store → array vazio (não crasha)', async () => {
    const supabase = createMockSupabase({ social_posts: [] });
    const empty = await queryStoredPosts(supabase, CAMP);
    assert.deepEqual(empty, []);
  });
});
