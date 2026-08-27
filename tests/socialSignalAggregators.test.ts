/**
 * Testes do PR 14 do PRD Social Intelligence — SocialSignalAggregators.
 *
 * Cobre:
 *   aggregateTopicSeries:
 *     - posts com texto claro classificam pra topic + emitem series
 *     - focusTopics filtra
 *     - posts sem text ou com timestamp inválido são ignorados
 *   buildEngagementSnapshot:
 *     - soma likes+comments+shares na janela current e baseline
 *     - baseline=null quando não há posts no baseline
 *     - undefined quando nada em nenhuma janela
 *   buildSentimentSnapshot:
 *     - comments classificados negative viram ratio
 *     - unknown ignorado
 *     - undefined quando nada classificado
 *   buildCurrentPosts:
 *     - só posts do current window entram
 *     - engagement calculado corretamente
 *   buildTopicSnapshots:
 *     - current vs baseline counts
 *     - baseline=null quando current=0 E baseline=0
 *   aggregateProviderInput:
 *     - combina tudo num ProviderInput consistente
 *     - campos vazios ficam undefined
 *   Integração ponta-a-ponta:
 *     - aggregate + runSocialSignalsPipeline → SocialSignal[]
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateTopicSeries,
  buildEngagementSnapshot,
  buildSentimentSnapshot,
  buildCurrentPosts,
  buildTopicSnapshots,
  aggregateProviderInput,
  SOCIAL_SIGNAL_AGGREGATORS_VERSION,
  type AggregatorConfig,
} from '../src/server/modules/social/intelligence/socialSignalAggregators';
import { runSocialSignalsPipeline } from '../src/server/modules/social/intelligence/socialSignalsPipeline';
import type {
  StoredSocialPost,
  StoredSocialComment,
} from '../src/server/modules/social/socialIngestionService';

const NOW = new Date('2026-08-27T12:00:00Z');
const HOUR = 3_600_000;

const CFG: AggregatorConfig = { now: NOW };

// ── Helpers ─────────────────────────────────────────────────────────

let idCounter = 1;

function post(overrides: Partial<StoredSocialPost>): StoredSocialPost {
  return {
    id: `p${idCounter++}`,
    campaignId: 'camp1',
    provider: 'instagram',
    externalId: `ext${idCounter}`,
    accountExternalId: 'acct1',
    publishedAt: overrides.publishedAt ?? NOW.toISOString(),
    contentType: 'post',
    text: overrides.text ?? null,
    permalink: null,
    metrics: overrides.metrics ?? null,
    provenance: {},
    ingestedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function comment(overrides: Partial<StoredSocialComment>): StoredSocialComment {
  return {
    id: `c${idCounter++}`,
    campaignId: 'camp1',
    provider: 'instagram',
    externalId: `cext${idCounter}`,
    postExternalId: 'p1',
    authorPublicId: null,
    text: overrides.text ?? null,
    publishedAt: overrides.publishedAt ?? NOW.toISOString(),
    likes: null,
    replies: null,
    provenance: {},
    ingestedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

// ── aggregateTopicSeries ────────────────────────────────────────────

describe('aggregateTopicSeries', () => {
  test('posts com texto sobre saúde geram série pra "saude"', () => {
    const posts = [
      post({ text: 'Nova UPA aberta no bairro, ótima ampliação da saúde local', publishedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString() }),
      post({ text: 'Consulta no hospital foi rápida hoje', publishedAt: new Date(NOW.getTime() - 5 * HOUR).toISOString() }),
    ];
    const series = aggregateTopicSeries(posts);
    assert.ok('saude' in series);
    assert.equal(series.saude.length, 2);
    assert.ok(series.saude[0].at instanceof Date);
  });

  test('post sem text é ignorado', () => {
    const posts = [post({ text: null })];
    const series = aggregateTopicSeries(posts);
    assert.deepEqual(series, {});
  });

  test('focusTopics filtra topics não desejados', () => {
    const posts = [
      post({ text: 'Ônibus atrasado no transporte público de novo' }),
      post({ text: 'Escolas do bairro melhoraram na educação' }),
    ];
    const series = aggregateTopicSeries(posts, ['educacao']);
    assert.ok(!('transporte' in series));
    assert.ok('educacao' in series);
  });

  test('publishedAt inválido pula o post', () => {
    const posts = [post({ text: 'saude', publishedAt: 'not a date' })];
    const series = aggregateTopicSeries(posts);
    // classifyTopics vira {saude}, mas Date.parse falha → série vazia
    if ('saude' in series) {
      assert.equal(series.saude.length, 0);
    }
  });
});

// ── buildEngagementSnapshot ─────────────────────────────────────────

describe('buildEngagementSnapshot', () => {
  test('soma likes+comments+shares em current e baseline', () => {
    const posts = [
      // Current (últimas 24h)
      post({
        publishedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
        metrics: { likes: 100, comments: 20, shares: 5 } as StoredSocialPost['metrics'],
      }),
      // Baseline (24-48h)
      post({
        publishedAt: new Date(NOW.getTime() - 30 * HOUR).toISOString(),
        metrics: { likes: 50, comments: 10, shares: 2 } as StoredSocialPost['metrics'],
      }),
    ];
    const snap = buildEngagementSnapshot(posts, CFG);
    assert.ok(snap);
    assert.equal(snap!.current, 125);
    assert.equal(snap!.baseline, 62);
    assert.equal(snap!.currentComments, 20);
    assert.equal(snap!.baselineComments, 10);
  });

  test('sem posts no baseline → baseline=null', () => {
    const posts = [
      post({
        publishedAt: new Date(NOW.getTime() - 1 * HOUR).toISOString(),
        metrics: { likes: 10, comments: 5, shares: 1 } as StoredSocialPost['metrics'],
      }),
    ];
    const snap = buildEngagementSnapshot(posts, CFG);
    assert.ok(snap);
    assert.equal(snap!.current, 16);
    assert.equal(snap!.baseline, null);
    assert.equal(snap!.baselineComments, null);
  });

  test('sem posts em nenhuma janela → undefined', () => {
    const posts = [
      post({
        publishedAt: new Date(NOW.getTime() - 100 * HOUR).toISOString(),
        metrics: { likes: 10 } as StoredSocialPost['metrics'],
      }),
    ];
    const snap = buildEngagementSnapshot(posts, CFG);
    assert.equal(snap, undefined);
  });

  test('metrics null cai pra 0', () => {
    const posts = [
      post({
        publishedAt: new Date(NOW.getTime() - 1 * HOUR).toISOString(),
        metrics: null,
      }),
    ];
    const snap = buildEngagementSnapshot(posts, CFG);
    assert.ok(snap);
    assert.equal(snap!.current, 0);
  });
});

// ── buildSentimentSnapshot ──────────────────────────────────────────

describe('buildSentimentSnapshot', () => {
  test('proporção negative é calculada em current e baseline', () => {
    const comments = [
      // Current: 2 negative, 1 positive (3 classificados)
      comment({ text: 'péssimo isso', publishedAt: new Date(NOW.getTime() - 1 * HOUR).toISOString() }),
      comment({ text: 'horrível o serviço', publishedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString() }),
      comment({ text: 'muito bom, gostei', publishedAt: new Date(NOW.getTime() - 3 * HOUR).toISOString() }),
      // Baseline: 1 negative, 3 positives (4 classificados)
      comment({ text: 'ruim', publishedAt: new Date(NOW.getTime() - 30 * HOUR).toISOString() }),
      comment({ text: 'ótimo dia', publishedAt: new Date(NOW.getTime() - 32 * HOUR).toISOString() }),
      comment({ text: 'excelente atendimento', publishedAt: new Date(NOW.getTime() - 36 * HOUR).toISOString() }),
      comment({ text: 'amei!', publishedAt: new Date(NOW.getTime() - 40 * HOUR).toISOString() }),
    ];
    const snap = buildSentimentSnapshot(comments, CFG);
    assert.ok(snap);
    assert.equal(snap!.currentClassifiedCount, 3);
    assert.equal(snap!.baselineClassifiedCount, 4);
    assert.ok(Math.abs(snap!.currentNegRatio! - 2 / 3) < 0.001);
    assert.ok(Math.abs(snap!.baselineNegRatio! - 1 / 4) < 0.001);
  });

  test('comments com sentiment unknown são ignorados', () => {
    const comments = [
      comment({ text: 'só palavras neutras aleatorias', publishedAt: new Date(NOW.getTime() - 1 * HOUR).toISOString() }),
    ];
    const snap = buildSentimentSnapshot(comments, CFG);
    assert.equal(snap, undefined);
  });

  test('comment sem text é pulado', () => {
    const comments = [comment({ text: null })];
    const snap = buildSentimentSnapshot(comments, CFG);
    assert.equal(snap, undefined);
  });
});

// ── buildCurrentPosts ───────────────────────────────────────────────

describe('buildCurrentPosts', () => {
  test('só posts do current window entram', () => {
    const posts = [
      post({
        publishedAt: new Date(NOW.getTime() - 1 * HOUR).toISOString(),
        metrics: { likes: 100, comments: 20, shares: 5 } as StoredSocialPost['metrics'],
        externalId: 'ext_recent',
      }),
      post({
        publishedAt: new Date(NOW.getTime() - 30 * HOUR).toISOString(),
        metrics: { likes: 50 } as StoredSocialPost['metrics'],
        externalId: 'ext_old',
      }),
    ];
    const snaps = buildCurrentPosts('instagram', posts, CFG);
    assert.equal(snaps.length, 1);
    assert.equal(snaps[0].externalId, 'ext_recent');
    assert.equal(snaps[0].engagement, 125);
    assert.equal(snaps[0].provider, 'instagram');
  });
});

// ── buildTopicSnapshots ─────────────────────────────────────────────

describe('buildTopicSnapshots', () => {
  test('current vs baseline counts por topic', () => {
    const posts = [
      // Current: 3 saude, 1 educacao
      post({ text: 'saúde melhorou', publishedAt: new Date(NOW.getTime() - 1 * HOUR).toISOString() }),
      post({ text: 'hospital lotado', publishedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString() }),
      post({ text: 'UPA reformada', publishedAt: new Date(NOW.getTime() - 3 * HOUR).toISOString() }),
      post({ text: 'escola nova', publishedAt: new Date(NOW.getTime() - 4 * HOUR).toISOString() }),
      // Baseline: 1 saude
      post({ text: 'consulta demorou', publishedAt: new Date(NOW.getTime() - 30 * HOUR).toISOString() }),
    ];
    const snaps = buildTopicSnapshots(posts, CFG);
    const saude = snaps.find(s => s.topic === 'saude');
    const educacao = snaps.find(s => s.topic === 'educacao');
    assert.ok(saude);
    assert.equal(saude!.current, 3);
    assert.equal(saude!.baseline, 1);
    assert.ok(educacao);
    assert.equal(educacao!.current, 1);
    assert.equal(educacao!.baseline, 0, 'baseline=0 (real ausência) quando current>0 mas baseline=0');
  });

  test('focusTopics filtra', () => {
    const posts = [
      post({ text: 'escola nova', publishedAt: new Date(NOW.getTime() - 1 * HOUR).toISOString() }),
      post({ text: 'hospital ampliado', publishedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString() }),
    ];
    const cfg: AggregatorConfig = { now: NOW, focusTopics: ['saude'] };
    const snaps = buildTopicSnapshots(posts, cfg);
    assert.equal(snaps.length, 1);
    assert.equal(snaps[0].topic, 'saude');
  });
});

// ── aggregateProviderInput ──────────────────────────────────────────

describe('aggregateProviderInput', () => {
  test('combina tudo num ProviderInput coerente', () => {
    const posts = [
      post({
        text: 'saúde, muito bom o hospital novo',
        publishedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
        metrics: { likes: 100, comments: 20, shares: 5 } as StoredSocialPost['metrics'],
      }),
      post({
        text: 'consulta ontem, atendimento no hospital',
        publishedAt: new Date(NOW.getTime() - 30 * HOUR).toISOString(),
        metrics: { likes: 50, comments: 10, shares: 2 } as StoredSocialPost['metrics'],
      }),
    ];
    const comments = [
      comment({ text: 'péssimo, horrível', publishedAt: new Date(NOW.getTime() - 1 * HOUR).toISOString() }),
    ];
    const inp = aggregateProviderInput({ provider: 'instagram', posts, comments, cfg: CFG });
    assert.equal(inp.provider, 'instagram');
    assert.ok(inp.topicSeries);
    assert.ok(inp.engagement);
    assert.ok(inp.sentiment);
    assert.ok(inp.currentPosts);
    assert.equal(inp.currentPosts!.length, 1);
    assert.ok(inp.topicSnapshots);
  });

  test('todos os inputs vazios → tudo undefined', () => {
    const inp = aggregateProviderInput({ provider: 'instagram', posts: [], comments: [], cfg: CFG });
    assert.equal(inp.provider, 'instagram');
    assert.equal(inp.topicSeries, undefined);
    assert.equal(inp.engagement, undefined);
    assert.equal(inp.sentiment, undefined);
    assert.equal(inp.currentPosts, undefined);
    assert.equal(inp.topicSnapshots, undefined);
  });
});

// ── Integração end-to-end ───────────────────────────────────────────

describe('aggregateProviderInput + runSocialSignalsPipeline', () => {
  test('4 redes com mesmo topic rising → gera cross_network_trend', () => {
    // Cada rede tem 5 posts sobre "saude" no current + 1 no baseline
    const buildProviderPosts = () => {
      const arr: StoredSocialPost[] = [];
      for (let i = 0; i < 5; i++) {
        arr.push(post({
          text: 'saúde melhorou bastante',
          publishedAt: new Date(NOW.getTime() - (i + 1) * 3 * HOUR).toISOString(),
          metrics: { likes: 10 } as StoredSocialPost['metrics'],
        }));
      }
      arr.push(post({
        text: 'consulta antiga no hospital',
        publishedAt: new Date(NOW.getTime() - 30 * HOUR).toISOString(),
        metrics: { likes: 5 } as StoredSocialPost['metrics'],
      }));
      return arr;
    };
    const providers = ['instagram', 'facebook', 'youtube', 'x'] as const;
    const perProvider = providers.map(p => aggregateProviderInput({
      provider: p,
      posts: buildProviderPosts(),
      comments: [],
      cfg: { now: NOW, focusTopics: ['saude'] },
    }));
    const res = runSocialSignalsPipeline({
      now: NOW,
      perProvider,
      trendOptions: { minSamplesPerSide: 1 },
    });
    const crossNet = res.signals.filter(s => s.source === 'cross_network_trend');
    assert.ok(crossNet.length >= 1, 'deve gerar cross-network signal com 4 redes concordando');
  });

  test('SOCIAL_SIGNAL_AGGREGATORS_VERSION é string estável', () => {
    assert.ok(typeof SOCIAL_SIGNAL_AGGREGATORS_VERSION === 'string');
    assert.ok(SOCIAL_SIGNAL_AGGREGATORS_VERSION.length > 0);
  });
});
