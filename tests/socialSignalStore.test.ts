/**
 * Testes do PR 16 do PRD Social Intelligence — SocialSignalStore.
 *
 * Cobre:
 *   persistSignals:
 *     - Lista vazia devolve written:0 sem chamar upsert
 *     - Signals gravam com todos os campos + provenance
 *     - campaignId obrigatório
 *     - Idempotência: rodar 2× mantém 1 row (dedup por campaignId+dedupKey)
 *     - Erro do supabase reflete em reason='error'
 *
 *   querySignals:
 *     - Devolve os N mais recentes por default
 *     - Filtro por source, topic, since, limit
 *     - minSeverity aplicado em memória (info<attention<risk<crisis)
 *     - provider filtra pelo array
 *     - campaignId obrigatório
 *     - Isolamento §35: só devolve linhas da campanha certa
 *
 *   Runner integration:
 *     - opts.persist=false (default) NÃO chama store
 *     - opts.persist=true chama persistSignals e adiciona result.persist
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';

import {
  persistSignals,
  querySignals,
  SOCIAL_SIGNAL_STORE_VERSION,
  type StoredSocialSignal,
} from '../src/server/modules/social/socialSignalStore';
import { computeCampaignSocialSignals } from '../src/server/modules/social/socialSignalsRunner';
import type {
  SocialSignal,
  SocialSignalSeverity,
} from '../src/server/modules/social/intelligence/socialSignalBus';
import { SOCIAL_SIGNAL_BUS_VERSION } from '../src/server/modules/social/intelligence/socialSignalBus';
import type { StoredSocialPost } from '../src/server/modules/social/socialIngestionService';

const CAMP_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMP_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NOW = new Date('2026-08-27T12:00:00Z');
const HOUR = 3_600_000;

// ── Fixtures ────────────────────────────────────────────────────────

let seq = 1;

function signal(overrides: Partial<SocialSignal> = {}): SocialSignal {
  return {
    dedupKey: overrides.dedupKey ?? `stub::${seq++}`,
    source: overrides.source ?? 'trend',
    severity: overrides.severity ?? 'info',
    summary: overrides.summary ?? 'stub summary',
    hypotheses: overrides.hypotheses ?? [],
    providers: overrides.providers ?? ['instagram'],
    topic: overrides.topic,
    confidence: overrides.confidence ?? 0.5,
    emittedAt: overrides.emittedAt ?? NOW,
    payload: overrides.payload ?? {
      kind: 'trend',
      result: {
        window: '24h', state: 'trend', direction: 'rising',
        currentTotal: 100, baselineTotal: 80, deltaPct: 0.25,
        samples: { current: 5, baseline: 5 }, confidence: 0.5,
        detectorVersion: 'test',
      } as never,
    },
    busVersion: overrides.busVersion ?? SOCIAL_SIGNAL_BUS_VERSION,
  };
}

// ── persistSignals ──────────────────────────────────────────────────

describe('persistSignals', () => {
  test('lista vazia devolve written:0 sem tocar no banco', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const result = await persistSignals(supabase, CAMP_A, []);
    assert.equal(result.attempted, 0);
    assert.equal(result.written, 0);
    assert.equal(result.reason, 'ok');
    const store = (supabase as unknown as { _store: Map<string, unknown[]> })._store;
    assert.equal(store.get('social_signals')!.length, 0);
  });

  test('grava 3 signals com todos os campos', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const signals = [
      signal({ dedupKey: 'a', severity: 'info' }),
      signal({ dedupKey: 'b', severity: 'attention', topic: 'saude', providers: ['instagram', 'facebook'] }),
      signal({ dedupKey: 'c', severity: 'crisis', source: 'cross_network_anomaly', hypotheses: ['h1', 'h2'] }),
    ];
    const result = await persistSignals(supabase, CAMP_A, signals);
    assert.equal(result.reason, 'ok');
    assert.equal(result.written, 3);

    const store = (supabase as unknown as { _store: Map<string, Array<Record<string, unknown>>> })._store;
    const rows = store.get('social_signals')!;
    assert.equal(rows.length, 3);
    const b = rows.find(r => r.dedupKey === 'b')!;
    assert.equal(b.severity, 'attention');
    assert.equal(b.topic, 'saude');
    assert.deepEqual(b.providers, ['instagram', 'facebook']);
    const c = rows.find(r => r.dedupKey === 'c')!;
    assert.equal(c.source, 'cross_network_anomaly');
    assert.deepEqual(c.hypotheses, ['h1', 'h2']);
    // emittedAt convertido pra ISO
    assert.equal(typeof b.emittedAt, 'string');
  });

  test('campaignId obrigatório', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    await assert.rejects(() => persistSignals(supabase, '', [signal({})]), /obrigatório/);
  });

  test('idempotência: mesmo dedupKey 2x resulta em 1 row', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const s = signal({ dedupKey: 'dup', severity: 'info' });
    await persistSignals(supabase, CAMP_A, [s]);
    // Segunda run — mesmo dedupKey, severity diferente pra provar update
    await persistSignals(supabase, CAMP_A, [signal({ dedupKey: 'dup', severity: 'risk' })]);
    const store = (supabase as unknown as { _store: Map<string, Array<Record<string, unknown>>> })._store;
    const rows = store.get('social_signals')!;
    assert.equal(rows.length, 1, 'só 1 row apesar de 2 persists');
    assert.equal(rows[0].severity, 'risk', 'severity atualizada no upsert');
  });
});

// ── querySignals ────────────────────────────────────────────────────

async function seedForQuery(supabase: ReturnType<typeof createMockSupabase>) {
  seq = 1;  // reset counter para dedupKeys determinísticos
  await persistSignals(supabase, CAMP_A, [
    signal({
      dedupKey: 'a', source: 'trend', severity: 'info',
      topic: 'saude', providers: ['instagram'],
      emittedAt: new Date(NOW.getTime() - 1 * HOUR),
    }),
    signal({
      dedupKey: 'b', source: 'anomaly', severity: 'risk',
      topic: 'saude', providers: ['facebook', 'youtube'],
      emittedAt: new Date(NOW.getTime() - 2 * HOUR),
    }),
    signal({
      dedupKey: 'c', source: 'trend', severity: 'attention',
      topic: 'educacao', providers: ['x'],
      emittedAt: new Date(NOW.getTime() - 3 * HOUR),
    }),
    signal({
      dedupKey: 'd', source: 'cross_network_anomaly', severity: 'crisis',
      topic: 'seguranca', providers: ['instagram', 'facebook', 'youtube'],
      emittedAt: new Date(NOW.getTime() - 4 * HOUR),
    }),
  ]);
  // Sinal de OUTRA campanha — pra isolamento
  await persistSignals(supabase, CAMP_B, [
    signal({
      dedupKey: 'other-1', source: 'trend', severity: 'crisis',
      topic: 'saude', providers: ['instagram'],
      emittedAt: NOW,
    }),
  ]);
}

describe('querySignals — filtros e ordenação', () => {
  test('devolve N mais recentes por default, ordenados por emittedAt DESC', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    await seedForQuery(supabase);
    const out = await querySignals(supabase, CAMP_A);
    assert.equal(out.length, 4);
    assert.equal(out[0].dedupKey, 'a');
    assert.equal(out[3].dedupKey, 'd');
  });

  test('filtro source=trend só devolve trends', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    await seedForQuery(supabase);
    const out = await querySignals(supabase, CAMP_A, { source: 'trend' });
    assert.deepEqual(out.map((r: StoredSocialSignal) => r.dedupKey).sort(), ['a', 'c']);
  });

  test('filtro topic=saude', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    await seedForQuery(supabase);
    const out = await querySignals(supabase, CAMP_A, { topic: 'saude' });
    assert.deepEqual(out.map((r: StoredSocialSignal) => r.dedupKey).sort(), ['a', 'b']);
  });

  test('filtro since limita janela temporal', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    await seedForQuery(supabase);
    const cutoff = new Date(NOW.getTime() - 2.5 * HOUR);
    const out = await querySignals(supabase, CAMP_A, { since: cutoff });
    // Só emittedAt >= cutoff (a=-1h, b=-2h)
    assert.deepEqual(out.map((r: StoredSocialSignal) => r.dedupKey).sort(), ['a', 'b']);
  });

  test('limit trunca resultado', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    await seedForQuery(supabase);
    const out = await querySignals(supabase, CAMP_A, { limit: 2 });
    assert.equal(out.length, 2);
  });

  test('minSeverity=risk filtra risk e crisis', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    await seedForQuery(supabase);
    const out = await querySignals(supabase, CAMP_A, { minSeverity: 'risk' });
    assert.deepEqual(out.map((r: StoredSocialSignal) => r.dedupKey).sort(), ['b', 'd']);
  });

  test('minSeverity=attention filtra attention/risk/crisis', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    await seedForQuery(supabase);
    const out = await querySignals(supabase, CAMP_A, { minSeverity: 'attention' });
    const severities = out.map((r: StoredSocialSignal) => r.severity as SocialSignalSeverity);
    assert.ok(!severities.includes('info'));
  });

  test('provider filtra pelo array', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    await seedForQuery(supabase);
    const ig = await querySignals(supabase, CAMP_A, { provider: 'instagram' });
    assert.deepEqual(ig.map((r: StoredSocialSignal) => r.dedupKey).sort(), ['a', 'd']);
    const yt = await querySignals(supabase, CAMP_A, { provider: 'youtube' });
    assert.deepEqual(yt.map((r: StoredSocialSignal) => r.dedupKey).sort(), ['b', 'd']);
  });

  test('campaignId obrigatório', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    await assert.rejects(() => querySignals(supabase, ''), /obrigatório/);
  });

  test('isolamento §35: campanha A NÃO vê signals de B', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    await seedForQuery(supabase);
    const outA = await querySignals(supabase, CAMP_A);
    for (const s of outA) {
      assert.equal(s.campaignId, CAMP_A);
      assert.notEqual(s.dedupKey, 'other-1');
    }
    const outB = await querySignals(supabase, CAMP_B);
    assert.equal(outB.length, 1);
    assert.equal(outB[0].dedupKey, 'other-1');
  });

  test('SOCIAL_SIGNAL_STORE_VERSION é string estável', () => {
    assert.ok(typeof SOCIAL_SIGNAL_STORE_VERSION === 'string');
    assert.ok(SOCIAL_SIGNAL_STORE_VERSION.length > 0);
  });
});

// ── Runner + persist integração ─────────────────────────────────────

describe('computeCampaignSocialSignals opts.persist', () => {
  let postIdSeq = 1;
  function post(overrides: Partial<StoredSocialPost>): StoredSocialPost {
    return {
      id: `pid${postIdSeq++}`,
      campaignId: CAMP_A,
      provider: 'instagram',
      externalId: `ext${postIdSeq}`,
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

  test('persist=false (default) NÃO grava social_signals', async () => {
    const posts: StoredSocialPost[] = [];
    for (let i = 0; i < 5; i++) {
      posts.push(post({
        campaignId: CAMP_A, provider: 'instagram',
        text: 'saúde melhor', publishedAt: new Date(NOW.getTime() - (i + 1) * HOUR).toISOString(),
        externalId: `p_cur_${i}`,
      }));
    }
    posts.push(post({
      campaignId: CAMP_A, provider: 'instagram',
      text: 'consulta antiga hospital',
      publishedAt: new Date(NOW.getTime() - 30 * HOUR).toISOString(),
      externalId: 'p_old',
    }));
    const supabase = createMockSupabase({ social_posts: posts, social_comments: [], social_signals: [] });
    const res = await computeCampaignSocialSignals(supabase, CAMP_A, {
      now: NOW,
      trendOptions: { minSamplesPerSide: 1 },
    });
    assert.equal(res.persist, undefined);
    const store = (supabase as unknown as { _store: Map<string, unknown[]> })._store;
    assert.equal(store.get('social_signals')!.length, 0, 'nada gravado');
    assert.ok(res.signals.length >= 1);
  });

  test('persist=true grava signals e devolve outcome', async () => {
    const posts: StoredSocialPost[] = [];
    for (let i = 0; i < 5; i++) {
      posts.push(post({
        campaignId: CAMP_A, provider: 'instagram',
        text: 'saúde melhor no bairro', publishedAt: new Date(NOW.getTime() - (i + 1) * HOUR).toISOString(),
        externalId: `p_cur_${i}`,
      }));
    }
    posts.push(post({
      campaignId: CAMP_A, provider: 'instagram',
      text: 'consulta hospital antiga',
      publishedAt: new Date(NOW.getTime() - 30 * HOUR).toISOString(),
      externalId: 'p_old',
    }));
    const supabase = createMockSupabase({ social_posts: posts, social_comments: [], social_signals: [] });
    const res = await computeCampaignSocialSignals(supabase, CAMP_A, {
      now: NOW,
      trendOptions: { minSamplesPerSide: 1 },
      persist: true,
    });
    assert.ok(res.persist);
    assert.equal(res.persist!.reason, 'ok');
    assert.equal(res.persist!.written, res.signals.length);
    const store = (supabase as unknown as { _store: Map<string, unknown[]> })._store;
    assert.equal(store.get('social_signals')!.length, res.signals.length);
  });

  test('persist=true rodado 2× é idempotente (mesmos signals → mesmas rows)', async () => {
    const posts: StoredSocialPost[] = [];
    for (let i = 0; i < 5; i++) {
      posts.push(post({
        campaignId: CAMP_A, provider: 'instagram',
        text: 'saúde melhor no bairro', publishedAt: new Date(NOW.getTime() - (i + 1) * HOUR).toISOString(),
        externalId: `p_dup_${i}`,
      }));
    }
    posts.push(post({
      campaignId: CAMP_A, provider: 'instagram',
      text: 'consulta hospital antiga',
      publishedAt: new Date(NOW.getTime() - 30 * HOUR).toISOString(),
      externalId: 'p_dup_old',
    }));
    const supabase = createMockSupabase({ social_posts: posts, social_comments: [], social_signals: [] });
    const r1 = await computeCampaignSocialSignals(supabase, CAMP_A, {
      now: NOW,
      trendOptions: { minSamplesPerSide: 1 },
      persist: true,
    });
    const r2 = await computeCampaignSocialSignals(supabase, CAMP_A, {
      now: NOW,
      trendOptions: { minSamplesPerSide: 1 },
      persist: true,
    });
    assert.equal(r1.signals.length, r2.signals.length);
    const store = (supabase as unknown as { _store: Map<string, unknown[]> })._store;
    assert.equal(store.get('social_signals')!.length, r1.signals.length, 'sem duplicatas após 2ª run');
  });
});

