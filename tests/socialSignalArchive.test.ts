/**
 * Testes do PR 33 — archiveOldSignals + integração no runner.
 *
 * Cobre:
 *   archiveOldSignals:
 *     - retentionMs <= 0 → noop
 *     - campaignId obrigatório
 *     - Nenhum signal antigo → attempted=0, archived=0, reason='ok'
 *     - N signals antigos → removidos + counts corretos
 *     - Isolamento §35: apaga só da campanha alvo
 *     - Cutoff = now - retentionMs (exclusão estrita: < cutoff, >= sobrevive)
 *   Runner integration:
 *     - archiveOlderThanMs=0 (default) → result.archive ausente
 *     - archiveOlderThanMs > 0 → propaga ArchiveOldSignalsResult
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';
import {
  archiveOldSignals,
  persistSignals,
  querySignals,
} from '../src/server/modules/social/socialSignalStore';
import { computeCampaignSocialSignals } from '../src/server/modules/social/socialSignalsRunner';
import type { SocialSignal } from '../src/server/modules/social/intelligence/socialSignalBus';
import { SOCIAL_SIGNAL_BUS_VERSION } from '../src/server/modules/social/intelligence/socialSignalBus';

const CAMP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NOW = new Date('2026-08-27T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

let seq = 1;
function signal(overrides: Partial<SocialSignal> = {}): SocialSignal {
  return {
    dedupKey: overrides.dedupKey ?? `stub::${seq++}`,
    source: overrides.source ?? 'trend',
    severity: overrides.severity ?? 'info',
    summary: overrides.summary ?? 'stub',
    hypotheses: overrides.hypotheses ?? [],
    providers: overrides.providers ?? ['instagram'],
    topic: overrides.topic,
    confidence: overrides.confidence ?? 0.5,
    emittedAt: overrides.emittedAt ?? NOW,
    payload: overrides.payload ?? { kind: 'trend', result: {} as never },
    busVersion: SOCIAL_SIGNAL_BUS_VERSION,
  };
}

// ── archiveOldSignals ──────────────────────────────────────────────

describe('archiveOldSignals — short-circuits', () => {
  test('retentionMs <= 0 → noop', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const r = await archiveOldSignals(supabase, CAMP, 0, NOW);
    assert.equal(r.reason, 'noop');
    assert.equal(r.archived, 0);
    assert.equal(r.attempted, 0);
  });

  test('retentionMs negativo → noop', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const r = await archiveOldSignals(supabase, CAMP, -1000, NOW);
    assert.equal(r.reason, 'noop');
  });

  test('campaignId falsy → throw', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    await assert.rejects(() => archiveOldSignals(supabase, '', 24 * 60 * 60 * 1000, NOW));
  });
});

describe('archiveOldSignals — sem dados antigos', () => {
  test('lista vazia → archived=0, reason=ok', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const r = await archiveOldSignals(supabase, CAMP, 30 * DAY, NOW);
    assert.equal(r.reason, 'ok');
    assert.equal(r.archived, 0);
    assert.equal(r.attempted, 0);
    assert.ok(r.cutoffDate);
  });

  test('só signals recentes → archived=0', async () => {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signal({ emittedAt: new Date(NOW.getTime() - 5 * DAY) }),
      signal({ emittedAt: new Date(NOW.getTime() - 10 * DAY) }),
    ]);
    // Retention 30 dias, tudo dentro
    const r = await archiveOldSignals(supabase, CAMP, 30 * DAY, NOW);
    assert.equal(r.archived, 0);
    // Tudo continua lá
    const remaining = await querySignals(supabase, CAMP, { limit: 100 });
    assert.equal(remaining.length, 2);
  });
});

describe('archiveOldSignals — remove signals antigos', () => {
  test('remove N signals antigos, deixa N recentes', async () => {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signal({ dedupKey: 'old1', emittedAt: new Date(NOW.getTime() - 60 * DAY) }),
      signal({ dedupKey: 'old2', emittedAt: new Date(NOW.getTime() - 45 * DAY) }),
      signal({ dedupKey: 'recent1', emittedAt: new Date(NOW.getTime() - 5 * DAY) }),
      signal({ dedupKey: 'recent2', emittedAt: new Date(NOW.getTime() - 1 * DAY) }),
    ]);
    const r = await archiveOldSignals(supabase, CAMP, 30 * DAY, NOW);
    assert.equal(r.reason, 'ok');
    assert.equal(r.archived, 2);
    assert.equal(r.attempted, 2);
    const remaining = await querySignals(supabase, CAMP, { limit: 100 });
    const keys = remaining.map(s => s.dedupKey).sort();
    assert.deepEqual(keys, ['recent1', 'recent2']);
  });

  test('cutoff estrito: signals em emittedAt >= cutoff sobrevivem', async () => {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    // signal EXATAMENTE no cutoff — não deve ser removido (`< cutoff`)
    const cutoffEmit = new Date(NOW.getTime() - 30 * DAY);
    await persistSignals(supabase, CAMP, [
      signal({ dedupKey: 'atCutoff', emittedAt: cutoffEmit }),
      signal({ dedupKey: 'justBefore', emittedAt: new Date(cutoffEmit.getTime() - 1000) }),
    ]);
    const r = await archiveOldSignals(supabase, CAMP, 30 * DAY, NOW);
    assert.equal(r.archived, 1);
    const remaining = await querySignals(supabase, CAMP, { limit: 100 });
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].dedupKey, 'atCutoff');
  });
});

describe('archiveOldSignals — isolamento §35', () => {
  test('apaga só a campanha alvo', async () => {
    seq = 1;
    const supabase = createMockSupabase({ social_signals: [] });
    await persistSignals(supabase, CAMP, [
      signal({ dedupKey: 'a-old', emittedAt: new Date(NOW.getTime() - 60 * DAY) }),
    ]);
    await persistSignals(supabase, OTHER, [
      signal({ dedupKey: 'other-old', emittedAt: new Date(NOW.getTime() - 60 * DAY) }),
    ]);
    const r = await archiveOldSignals(supabase, CAMP, 30 * DAY, NOW);
    assert.equal(r.archived, 1);
    // OTHER intacto
    const otherRemaining = await querySignals(supabase, OTHER, { limit: 100 });
    assert.equal(otherRemaining.length, 1);
    assert.equal(otherRemaining[0].dedupKey, 'other-old');
    // CAMP vazio
    const campRemaining = await querySignals(supabase, CAMP, { limit: 100 });
    assert.equal(campRemaining.length, 0);
  });
});

// ── Runner integration ────────────────────────────────────────────

describe('computeCampaignSocialSignals — archiveOlderThanMs opt-in', () => {
  test('default (undefined ou 0) → result.archive ausente', async () => {
    const supabase = createMockSupabase({ social_posts: [], social_comments: [], social_signals: [] });
    const r1 = await computeCampaignSocialSignals(supabase, CAMP);
    assert.equal(r1.archive, undefined);
    const r2 = await computeCampaignSocialSignals(supabase, CAMP, { archiveOlderThanMs: 0 });
    assert.equal(r2.archive, undefined);
  });

  test('archiveOlderThanMs > 0 → propaga ArchiveOldSignalsResult', async () => {
    seq = 1;
    const supabase = createMockSupabase({ social_posts: [], social_comments: [], social_signals: [] });
    // seed 2 signals antigos + 1 recente
    await persistSignals(supabase, CAMP, [
      signal({ dedupKey: 'old', emittedAt: new Date(NOW.getTime() - 60 * DAY) }),
      signal({ dedupKey: 'recent', emittedAt: new Date(NOW.getTime() - 5 * DAY) }),
    ]);
    const r = await computeCampaignSocialSignals(supabase, CAMP, {
      now: NOW,
      archiveOlderThanMs: 30 * DAY,
    });
    assert.ok(r.archive);
    assert.equal(r.archive!.archived, 1);
    // Só o recente sobrevive
    const remaining = await querySignals(supabase, CAMP, { limit: 100 });
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].dedupKey, 'recent');
  });
});
