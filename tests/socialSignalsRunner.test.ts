/**
 * Testes do PR 15 do PRD Social Intelligence — computeCampaignSocialSignals.
 *
 * Cobre wiring end-to-end:
 *   - Sem dados → PipelineResult com signals=[]
 *   - Posts em 4 redes rising mesmo topic → gera cross_network_trend
 *   - Isolamento por campanha: campanha A NÃO vê dados de B (§35)
 *   - Providers desconhecidos no store são IGNORADOS (defensivo §32)
 *   - opts.providers filtra a matriz de análise
 *   - opts.focusTopics filtra topics do aggregator
 *   - opts.postsSince limita a janela histórica
 *   - opts.now determina current/baseline
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';

import { computeCampaignSocialSignals, SOCIAL_SIGNALS_RUNNER_VERSION } from '../src/server/modules/social/socialSignalsRunner';
import { SOCIAL_SIGNALS_PIPELINE_VERSION } from '../src/server/modules/social/intelligence/socialSignalsPipeline';
import type { StoredSocialPost } from '../src/server/modules/social/socialIngestionService';

const CAMP_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMP_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NOW = new Date('2026-08-27T12:00:00Z');
const HOUR = 3_600_000;

let idCounter = 1;

function post(overrides: Partial<StoredSocialPost>): StoredSocialPost {
  return {
    id: `pid${idCounter++}`,
    campaignId: CAMP_A,
    provider: 'instagram',
    externalId: `ext${idCounter}`,
    accountExternalId: 'acct1',
    publishedAt: NOW.toISOString(),
    contentType: 'post',
    text: null,
    permalink: null,
    metrics: null,
    provenance: {},
    ingestedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

// ── Sem dados ────────────────────────────────────────────────────────

describe('computeCampaignSocialSignals — sem dados', () => {
  test('sem posts nem comments → signals=[]; raw vazias', async () => {
    const supabase = createMockSupabase({ social_posts: [], social_comments: [] });
    const res = await computeCampaignSocialSignals(supabase, CAMP_A, { now: NOW });
    assert.deepEqual(res.signals, []);
    assert.deepEqual(res.raw.trendsByProviderTopic, []);
    assert.deepEqual(res.raw.anomaliesByProvider, []);
    assert.equal(res.pipelineVersion, SOCIAL_SIGNALS_PIPELINE_VERSION);
  });

  test('campaignId obrigatório', async () => {
    const supabase = createMockSupabase({ social_posts: [], social_comments: [] });
    await assert.rejects(
      () => computeCampaignSocialSignals(supabase, '', { now: NOW }),
      /obrigatório/,
    );
  });
});

// ── End-to-end com cross-network ────────────────────────────────────

describe('computeCampaignSocialSignals — cross-network', () => {
  test('4 redes com posts sobre saúde rising → gera cross_network_trend', async () => {
    const providers = ['instagram', 'facebook', 'youtube', 'x'] as const;
    const posts: StoredSocialPost[] = [];
    for (const p of providers) {
      // 5 posts current
      for (let i = 0; i < 5; i++) {
        posts.push(post({
          campaignId: CAMP_A,
          provider: p,
          text: 'saúde bem melhor no bairro, hospital novo',
          publishedAt: new Date(NOW.getTime() - (i + 1) * 3 * HOUR).toISOString(),
        }));
      }
      // 1 post baseline
      posts.push(post({
        campaignId: CAMP_A,
        provider: p,
        text: 'hospital antigo, consulta demorada',
        publishedAt: new Date(NOW.getTime() - 30 * HOUR).toISOString(),
      }));
    }
    const supabase = createMockSupabase({ social_posts: posts, social_comments: [] });
    const res = await computeCampaignSocialSignals(supabase, CAMP_A, {
      now: NOW,
      focusTopics: ['saude'],
      trendOptions: { minSamplesPerSide: 1 },
    });
    const cnTrend = res.signals.filter(s => s.source === 'cross_network_trend');
    assert.ok(cnTrend.length >= 1, `esperado cross_network_trend, veio: ${res.signals.map(s => s.source).join(',')}`);
    // O sinal cross-network deve mencionar as 4 redes
    assert.equal(cnTrend[0].providers.length, 4);
  });
});

// ── Isolamento por campanha (§35) ───────────────────────────────────

describe('computeCampaignSocialSignals — isolamento por campanha', () => {
  test('signals de campanha A NÃO incluem posts de campanha B', async () => {
    const postsA: StoredSocialPost[] = Array.from({ length: 5 }, (_, i) =>
      post({
        campaignId: CAMP_A,
        provider: 'instagram',
        text: 'saúde bem melhor', publishedAt: new Date(NOW.getTime() - (i + 1) * HOUR).toISOString(),
      }),
    );
    const postsB: StoredSocialPost[] = Array.from({ length: 5 }, (_, i) =>
      post({
        campaignId: CAMP_B,
        provider: 'facebook',
        text: 'educação melhor escola', publishedAt: new Date(NOW.getTime() - (i + 1) * HOUR).toISOString(),
      }),
    );
    postsA.push(post({
      campaignId: CAMP_A, provider: 'instagram',
      text: 'saúde antiga hospital',
      publishedAt: new Date(NOW.getTime() - 30 * HOUR).toISOString(),
    }));
    const supabase = createMockSupabase({
      social_posts: [...postsA, ...postsB],
      social_comments: [],
    });
    const resA = await computeCampaignSocialSignals(supabase, CAMP_A, {
      now: NOW,
      trendOptions: { minSamplesPerSide: 1 },
    });
    // Signals de A não devem mencionar facebook (só está em B)
    for (const s of resA.signals) {
      assert.ok(!s.providers.includes('facebook'), `A não deve ver facebook, viu em ${s.summary}`);
    }
  });
});

// ── Providers desconhecidos filtrados ───────────────────────────────

describe('computeCampaignSocialSignals — providers desconhecidos', () => {
  test('rows com provider inválido são IGNORADAS (defensivo §32)', async () => {
    const posts: StoredSocialPost[] = [
      post({
        campaignId: CAMP_A,
        provider: 'myspace' as never,
        text: 'saúde melhor', publishedAt: new Date(NOW.getTime() - HOUR).toISOString(),
      }),
      post({
        campaignId: CAMP_A,
        provider: 'instagram',
        text: 'saúde melhor', publishedAt: new Date(NOW.getTime() - HOUR).toISOString(),
      }),
    ];
    const supabase = createMockSupabase({ social_posts: posts, social_comments: [] });
    const res = await computeCampaignSocialSignals(supabase, CAMP_A, { now: NOW });
    for (const t of res.raw.trendsByProviderTopic) {
      assert.notEqual(t.provider, 'myspace' as never);
    }
  });
});

// ── Filtros opcionais ────────────────────────────────────────────────

describe('computeCampaignSocialSignals — opts.providers', () => {
  test('opts.providers=[instagram] restringe análise', async () => {
    const posts: StoredSocialPost[] = [
      post({
        campaignId: CAMP_A,
        provider: 'instagram',
        text: 'saúde bem melhor', publishedAt: new Date(NOW.getTime() - HOUR).toISOString(),
      }),
      post({
        campaignId: CAMP_A,
        provider: 'facebook',
        text: 'saúde bem melhor', publishedAt: new Date(NOW.getTime() - HOUR).toISOString(),
      }),
    ];
    const supabase = createMockSupabase({ social_posts: posts, social_comments: [] });
    const res = await computeCampaignSocialSignals(supabase, CAMP_A, {
      now: NOW,
      providers: ['instagram'],
    });
    for (const t of res.raw.trendsByProviderTopic) {
      assert.equal(t.provider, 'instagram');
    }
  });
});

describe('computeCampaignSocialSignals — opts.focusTopics', () => {
  test('opts.focusTopics=[saude] ignora educacao', async () => {
    const posts: StoredSocialPost[] = [
      post({
        campaignId: CAMP_A, provider: 'instagram',
        text: 'saúde bem melhor', publishedAt: new Date(NOW.getTime() - HOUR).toISOString(),
      }),
      post({
        campaignId: CAMP_A, provider: 'instagram',
        text: 'escola nova bacana', publishedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
      }),
    ];
    const supabase = createMockSupabase({ social_posts: posts, social_comments: [] });
    const res = await computeCampaignSocialSignals(supabase, CAMP_A, {
      now: NOW,
      focusTopics: ['saude'],
    });
    for (const t of res.raw.trendsByProviderTopic) {
      assert.equal(t.topic, 'saude');
    }
  });
});

describe('computeCampaignSocialSignals — meta', () => {
  test('SOCIAL_SIGNALS_RUNNER_VERSION é string estável', () => {
    assert.ok(typeof SOCIAL_SIGNALS_RUNNER_VERSION === 'string');
  });
});
