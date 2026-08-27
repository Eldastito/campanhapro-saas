/**
 * Testes do PR 20 do PRD Social Intelligence — SocialSignalsScheduler.
 *
 * Cobre:
 *   signalsTick (pure):
 *     - autoDiscover=true (default) → chama discoverActiveCampaigns
 *     - autoDiscover=false + campaignIds → usa lista explícita
 *     - autoDiscover=false SEM campaignIds → ConfigError (não throw)
 *     - Retorna outcome.ok=true com summary + discoveredCount + tickAt
 *     - Erro na cadeia → outcome.ok=false com kind/message; não throw
 *   startSocialSignalsScheduler:
 *     - throws pra intervalMs inválido (<1000)
 *     - runOnStart=true dispara tick imediato
 *     - stop() é idempotente e para o loop
 *     - isRunning() reflete estado
 *     - onTick handler recebe outcomes; throw no handler não derruba loop
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';

import {
  signalsTick,
  startSocialSignalsScheduler,
  SOCIAL_SIGNALS_SCHEDULER_VERSION,
  type SignalsTickOutcome,
} from '../src/server/modules/social/socialSignalsScheduler';
import type { StoredSocialPost } from '../src/server/modules/social/socialIngestionService';

const CAMP_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMP_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const HOUR = 3_600_000;

// silence noise from batch runner / scheduler
beforeEach(() => { console.warn = () => {}; });

let idSeq = 1;
function post(overrides: Partial<StoredSocialPost>): StoredSocialPost {
  return {
    id: `pid${idSeq++}`, campaignId: CAMP_A, provider: 'instagram',
    externalId: `ext${idSeq}`, accountExternalId: 'acct1',
    publishedAt: new Date().toISOString(), contentType: 'post',
    text: null, permalink: null, metrics: null, provenance: {},
    ingestedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
function healthyPosts(campaignId: string): StoredSocialPost[] {
  const now = new Date();
  const out: StoredSocialPost[] = [];
  for (let i = 0; i < 5; i++) {
    out.push(post({
      campaignId, text: 'saúde melhor no bairro',
      publishedAt: new Date(now.getTime() - (i + 1) * 3 * HOUR).toISOString(),
      externalId: `${campaignId}-cur-${i}`,
    }));
  }
  for (let i = 0; i < 4; i++) {
    out.push(post({
      campaignId, text: 'consulta hospital antiga UPA',
      publishedAt: new Date(now.getTime() - (25 + i * 4) * HOUR).toISOString(),
      externalId: `${campaignId}-old-${i}`,
    }));
  }
  return out;
}

// ── signalsTick — autoDiscover ──────────────────────────────────────

describe('signalsTick — autoDiscover', () => {
  test('autoDiscover=true (default) usa discoverActiveCampaigns', async () => {
    const supabase = createMockSupabase({
      campaign_configs: [{ id: 'x1', campaignId: CAMP_A }, { id: 'x2', campaignId: CAMP_B }],
      social_posts: [...healthyPosts(CAMP_A), ...healthyPosts(CAMP_B)],
      social_comments: [], social_signals: [],
    });
    const out = await signalsTick(supabase);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.discoveredCount, 2);
      assert.equal(out.summary.attempted, 2);
      assert.equal(out.summary.ok, 2);
      assert.ok(out.tickAt);
    }
  });

  test('SOCIAL_SIGNALS_SCHEDULER_VERSION é string estável', () => {
    assert.ok(typeof SOCIAL_SIGNALS_SCHEDULER_VERSION === 'string');
  });
});

// ── signalsTick — lista explícita ──────────────────────────────────

describe('signalsTick — explicit campaignIds', () => {
  test('autoDiscover=false + campaignIds → usa lista', async () => {
    const supabase = createMockSupabase({
      social_posts: healthyPosts(CAMP_A),
      social_comments: [], social_signals: [],
    });
    const out = await signalsTick(supabase, {
      autoDiscover: false,
      campaignIds: [CAMP_A],
    });
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.discoveredCount, 1);
      assert.equal(out.summary.perCampaign[0].campaignId, CAMP_A);
    }
  });

  test('autoDiscover=false SEM campaignIds → ok:false com ConfigError; NÃO throw', async () => {
    const supabase = createMockSupabase({});
    const out = await signalsTick(supabase, { autoDiscover: false, campaignIds: [] });
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.equal(out.errorKind, 'ConfigError');
      assert.ok(out.errorMessage.includes('campaignIds'));
    }
  });
});

// ── signalsTick — error isolation ──────────────────────────────────

describe('signalsTick — não propaga throw', () => {
  test('erro global (ex.: mock supabase morto) vira outcome.ok=false', async () => {
    // Fabricamos um supabase.from que joga sempre — cai antes de qualquer coisa
    const supabase = {
      from: () => {
        throw new Error('boom (supabase broken)');
      },
    } as unknown as ReturnType<typeof createMockSupabase>;
    const out = await signalsTick(supabase);
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.ok(out.errorMessage.includes('boom'));
      assert.equal(out.errorKind, 'Error');
    }
  });
});

// ── startSocialSignalsScheduler ─────────────────────────────────────

describe('startSocialSignalsScheduler — arg validation', () => {
  test('intervalMs < 1000 → throws', () => {
    const supabase = createMockSupabase({});
    assert.throws(
      () => startSocialSignalsScheduler({ supabase, intervalMs: 500 }),
      /intervalMs/,
    );
  });

  test('intervalMs NaN → throws', () => {
    const supabase = createMockSupabase({});
    assert.throws(
      () => startSocialSignalsScheduler({ supabase, intervalMs: NaN }),
      /intervalMs/,
    );
  });
});

describe('startSocialSignalsScheduler — runOnStart', () => {
  test('runOnStart=true → onTick recebe UMA execução; stop() para', async () => {
    const supabase = createMockSupabase({
      campaign_configs: [{ id: 'x1', campaignId: CAMP_A }],
      social_posts: healthyPosts(CAMP_A),
      social_comments: [], social_signals: [],
    });
    const outcomes: SignalsTickOutcome[] = [];
    const handle = startSocialSignalsScheduler({
      supabase,
      intervalMs: 60_000,  // longo — só o runOnStart deve firar antes do stop
      runOnStart: true,
      onTick: (o) => { outcomes.push(o); },
    });
    // dá 30ms pro tick imediato completar
    await new Promise(res => setTimeout(res, 30));
    handle.stop();
    assert.equal(handle.isRunning(), false);
    assert.equal(outcomes.length, 1, 'runOnStart deve gerar exatamente 1 tick');
    assert.equal(outcomes[0].ok, true);
  });

  test('stop() é idempotente (chamar 2x não quebra)', () => {
    const supabase = createMockSupabase({});
    const handle = startSocialSignalsScheduler({
      supabase,
      intervalMs: 60_000,
    });
    assert.equal(handle.isRunning(), true);
    handle.stop();
    assert.equal(handle.isRunning(), false);
    handle.stop();  // não deve lançar
    assert.equal(handle.isRunning(), false);
  });
});

describe('startSocialSignalsScheduler — onTick throw', () => {
  test('handler que lança NÃO derruba o loop', async () => {
    const supabase = createMockSupabase({
      campaign_configs: [{ id: 'x1', campaignId: CAMP_A }],
      social_posts: healthyPosts(CAMP_A),
      social_comments: [], social_signals: [],
    });
    let called = 0;
    const handle = startSocialSignalsScheduler({
      supabase,
      intervalMs: 60_000,
      runOnStart: true,
      onTick: () => {
        called += 1;
        throw new Error('handler explodiu');
      },
    });
    await new Promise(res => setTimeout(res, 30));
    handle.stop();
    assert.equal(called, 1);
    assert.equal(handle.isRunning(), false);
  });
});
