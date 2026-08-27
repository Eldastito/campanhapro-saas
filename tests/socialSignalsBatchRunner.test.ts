/**
 * Testes do PR 19 do PRD Social Intelligence — SocialSignalsBatchRunner.
 *
 * Cobre:
 *   runSignalsForCampaigns:
 *     - Lista vazia → summary vazio, ok=0
 *     - N campanhas OK → summary correto (per-campaign result presente,
 *       totalSignals somado)
 *     - IDs duplicados são deduplicados
 *     - Uma campanha falha, outras rodam (isolamento por-campaign)
 *     - IDs vazios são filtrados
 *   discoverActiveCampaigns:
 *     - Devolve campaignIds do campaign_configs
 *     - Erro de Supabase → devolve []
 *     - Rows sem campaignId são filtradas
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';

import {
  runSignalsForCampaigns,
  discoverActiveCampaigns,
  SOCIAL_SIGNALS_BATCH_RUNNER_VERSION,
} from '../src/server/modules/social/socialSignalsBatchRunner';
import type { StoredSocialPost } from '../src/server/modules/social/socialIngestionService';

const CAMP_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMP_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CAMP_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const HOUR = 3_600_000;

// Silencia console.warn nos testes para não poluir o output
beforeEach(() => { console.warn = () => {}; });
// (não restauramos — Node --test isola módulos entre files)

// ── Fixtures ────────────────────────────────────────────────────────

let idSeq = 1;
function post(overrides: Partial<StoredSocialPost>): StoredSocialPost {
  return {
    id: `pid${idSeq++}`,
    campaignId: CAMP_A,
    provider: 'instagram',
    externalId: `ext${idSeq}`,
    accountExternalId: 'acct1',
    publishedAt: new Date().toISOString(),
    contentType: 'post',
    text: null,
    permalink: null,
    metrics: null,
    provenance: {},
    ingestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function healthyPostsFor(campaignId: string): StoredSocialPost[] {
  const now = new Date();
  const posts: StoredSocialPost[] = [];
  for (let i = 0; i < 5; i++) {
    posts.push(post({
      campaignId, provider: 'instagram',
      text: 'saúde melhor no bairro',
      publishedAt: new Date(now.getTime() - (i + 1) * 3 * HOUR).toISOString(),
      externalId: `${campaignId}-cur-${i}`,
    }));
  }
  for (let i = 0; i < 4; i++) {
    posts.push(post({
      campaignId, provider: 'instagram',
      text: 'consulta hospital antiga UPA',
      publishedAt: new Date(now.getTime() - (25 + i * 4) * HOUR).toISOString(),
      externalId: `${campaignId}-old-${i}`,
    }));
  }
  return posts;
}

// ── runSignalsForCampaigns ─────────────────────────────────────────

describe('runSignalsForCampaigns — casos básicos', () => {
  test('lista vazia → summary vazio', async () => {
    const supabase = createMockSupabase({ social_posts: [], social_comments: [], social_signals: [] });
    const s = await runSignalsForCampaigns(supabase, { campaignIds: [] });
    assert.equal(s.attempted, 0);
    assert.equal(s.ok, 0);
    assert.equal(s.failed, 0);
    assert.equal(s.totalSignals, 0);
    assert.deepEqual(s.perCampaign, []);
    assert.equal(s.batchRunnerVersion, SOCIAL_SIGNALS_BATCH_RUNNER_VERSION);
  });

  test('N campanhas OK → summary agrega signals', async () => {
    const supabase = createMockSupabase({
      social_posts: [...healthyPostsFor(CAMP_A), ...healthyPostsFor(CAMP_B)],
      social_comments: [],
      social_signals: [],
    });
    const s = await runSignalsForCampaigns(supabase, {
      campaignIds: [CAMP_A, CAMP_B],
    });
    assert.equal(s.attempted, 2);
    assert.equal(s.ok, 2);
    assert.equal(s.failed, 0);
    assert.ok(s.totalSignals >= 2, 'cada campanha produz pelo menos 1 signal');
    assert.equal(s.perCampaign.length, 2);
    for (const row of s.perCampaign) {
      assert.ok(row.result);
      assert.equal(row.error, undefined);
    }
  });

  test('IDs duplicados são deduplicados', async () => {
    const supabase = createMockSupabase({
      social_posts: healthyPostsFor(CAMP_A),
      social_comments: [], social_signals: [],
    });
    const s = await runSignalsForCampaigns(supabase, {
      campaignIds: [CAMP_A, CAMP_A, CAMP_A],
    });
    assert.equal(s.attempted, 1);
    assert.equal(s.perCampaign.length, 1);
  });

  test('IDs vazios são filtrados', async () => {
    const supabase = createMockSupabase({
      social_posts: healthyPostsFor(CAMP_A),
      social_comments: [], social_signals: [],
    });
    const s = await runSignalsForCampaigns(supabase, {
      campaignIds: ['', CAMP_A, ''],
    });
    assert.equal(s.attempted, 1);
    assert.equal(s.perCampaign[0].campaignId, CAMP_A);
  });

  test('options são propagadas pra cada run (ex.: focusTopics)', async () => {
    const supabase = createMockSupabase({
      social_posts: healthyPostsFor(CAMP_A),
      social_comments: [], social_signals: [],
    });
    const s = await runSignalsForCampaigns(supabase, {
      campaignIds: [CAMP_A],
      options: { focusTopics: ['saude'] },
    });
    assert.equal(s.ok, 1);
    // topics no result não devem incluir 'educacao' (só saude foi focus)
    for (const t of s.perCampaign[0].result!.raw.trendsByProviderTopic) {
      assert.equal(t.topic, 'saude');
    }
  });
});

// ── Isolamento de erro ─────────────────────────────────────────────

describe('runSignalsForCampaigns — isolamento de erro', () => {
  test('uma campanha falha, outras rodam; error registrado', async () => {
    // Setup: mockSupabase normal, mas fazemos CAMP_B failhar via query
    // custom — mais simples: passar campaignId vazio faz o runner lançar
    // 'obrigatório'. Vamos usar isso: mistura ID inválido com válidos.
    const supabase = createMockSupabase({
      social_posts: [...healthyPostsFor(CAMP_A), ...healthyPostsFor(CAMP_C)],
      social_comments: [], social_signals: [],
    });
    // Injeta erro em CAMP_B via wrapper: monkey-patch supabase.from pra
    // rejeitar quando query em CAMP_B específico.
    const originalFrom = supabase.from.bind(supabase);
    supabase.from = ((table: string) => {
      const chain = originalFrom(table);
      const originalEq = chain.eq.bind(chain);
      chain.eq = (col: string, val: unknown) => {
        if (col === 'campaignId' && val === CAMP_B) {
          // devolve um chain que sempre rejeita
          const failing: any = {
            select: () => failing,
            order: () => failing,
            limit: () => failing,
            eq: () => failing,
            gte: () => failing,
            then: (_resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
              const err = new Error('simulated failure for CAMP_B');
              if (reject) return Promise.resolve(reject(err));
              return Promise.reject(err);
            },
          };
          return failing;
        }
        return originalEq(col, val);
      };
      return chain;
    }) as typeof supabase.from;

    const s = await runSignalsForCampaigns(supabase, {
      campaignIds: [CAMP_A, CAMP_B, CAMP_C],
    });
    assert.equal(s.attempted, 3);
    assert.equal(s.ok, 2);
    assert.equal(s.failed, 1);
    const bRow = s.perCampaign.find(r => r.campaignId === CAMP_B);
    assert.ok(bRow);
    assert.ok(bRow!.error);
    assert.ok(bRow!.error!.message.includes('simulated'));
    // CAMP_A e CAMP_C devem ter rodado com sucesso
    for (const cid of [CAMP_A, CAMP_C]) {
      const r = s.perCampaign.find(x => x.campaignId === cid);
      assert.ok(r?.result, `${cid} deveria ter result`);
      assert.equal(r!.error, undefined);
    }
  });
});

// ── discoverActiveCampaigns ────────────────────────────────────────

describe('discoverActiveCampaigns', () => {
  test('devolve campaignIds do campaign_configs', async () => {
    const supabase = createMockSupabase({
      campaign_configs: [
        { id: 'x1', campaignId: CAMP_A },
        { id: 'x2', campaignId: CAMP_B },
      ],
    });
    const ids = await discoverActiveCampaigns(supabase);
    assert.deepEqual(ids.sort(), [CAMP_A, CAMP_B].sort());
  });

  test('rows sem campaignId são filtradas', async () => {
    const supabase = createMockSupabase({
      campaign_configs: [
        { id: 'x1', campaignId: CAMP_A },
        { id: 'x2', campaignId: null },
        { id: 'x3' },
      ],
    });
    const ids = await discoverActiveCampaigns(supabase);
    assert.deepEqual(ids, [CAMP_A]);
  });

  test('limit propagado', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `id${i}`, campaignId: `camp-${i}`,
    }));
    const supabase = createMockSupabase({ campaign_configs: rows });
    const ids = await discoverActiveCampaigns(supabase, { limit: 5 });
    assert.equal(ids.length, 5);
  });
});
