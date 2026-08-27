/**
 * Testes de `computePulsoSummary` — função pura que deriva stats do feed
 * do Pulso Digital (PR 27). Componente React só renderiza a partir
 * dessa saída; a lógica toda mora aqui.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computePulsoSummary, computeDayBuckets } from '../src/components/social/pulsoSummary';
import type { StoredSocialSignal } from '../src/components/social/pulsoTypes';

const NOW = '2026-08-27T12:00:00Z';

let seq = 1;
function s(overrides: Partial<StoredSocialSignal> = {}): StoredSocialSignal {
  return {
    id: overrides.id ?? `id-${seq++}`,
    campaignId: overrides.campaignId ?? 'camp',
    dedupKey: overrides.dedupKey ?? `dk-${seq}`,
    source: overrides.source ?? 'trend',
    severity: overrides.severity ?? 'info',
    summary: overrides.summary ?? 'stub',
    hypotheses: overrides.hypotheses ?? [],
    providers: overrides.providers ?? ['instagram'],
    topic: overrides.topic ?? null,
    confidence: overrides.confidence ?? 0.5,
    emittedAt: overrides.emittedAt ?? NOW,
    payload: overrides.payload ?? {},
    busVersion: overrides.busVersion ?? 'v-test',
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
}

describe('computePulsoSummary — casos base', () => {
  test('lista vazia devolve total=0, tudo zerado, highest=null', () => {
    const r = computePulsoSummary([]);
    assert.equal(r.total, 0);
    assert.deepEqual(r.bySeverity, { info: 0, attention: 0, risk: 0, crisis: 0 });
    assert.deepEqual(r.percentBySeverity, { info: 0, attention: 0, risk: 0, crisis: 0 });
    assert.deepEqual(r.topTopics, []);
    assert.equal(r.highestSeverity, null);
  });

  test('um signal info', () => {
    const r = computePulsoSummary([s({ severity: 'info', topic: 'saude' })]);
    assert.equal(r.total, 1);
    assert.equal(r.bySeverity.info, 1);
    assert.equal(r.percentBySeverity.info, 100);
    assert.equal(r.highestSeverity, 'info');
    assert.deepEqual(r.topTopics, [{ topic: 'saude', label: 'Saúde', count: 1 }]);
  });
});

describe('computePulsoSummary — contagem por severity', () => {
  test('mistura conta cada severity corretamente', () => {
    seq = 1;
    const list = [
      s({ severity: 'info' }),
      s({ severity: 'info' }),
      s({ severity: 'attention' }),
      s({ severity: 'risk' }),
      s({ severity: 'crisis' }),
    ];
    const r = computePulsoSummary(list);
    assert.equal(r.total, 5);
    assert.equal(r.bySeverity.info, 2);
    assert.equal(r.bySeverity.attention, 1);
    assert.equal(r.bySeverity.risk, 1);
    assert.equal(r.bySeverity.crisis, 1);
    assert.equal(r.highestSeverity, 'crisis');
  });

  test('highestSeverity acompanha o topo do enum presente', () => {
    seq = 1;
    assert.equal(computePulsoSummary([s({ severity: 'info' })]).highestSeverity, 'info');
    assert.equal(computePulsoSummary([s({ severity: 'attention' })]).highestSeverity, 'attention');
    assert.equal(
      computePulsoSummary([s({ severity: 'risk' }), s({ severity: 'attention' })]).highestSeverity,
      'risk',
    );
    assert.equal(
      computePulsoSummary([s({ severity: 'info' }), s({ severity: 'crisis' })]).highestSeverity,
      'crisis',
    );
  });

  test('severity fora do enum é ignorada (defense-in-depth)', () => {
    seq = 1;
    // simulate legacy/broken payload
    const bad = s();
    (bad as unknown as { severity: string }).severity = 'urgent';
    const r = computePulsoSummary([bad, s({ severity: 'info' })]);
    // total conta o array bruto (2), bySeverity conta só o válido
    assert.equal(r.total, 2);
    assert.equal(r.bySeverity.info, 1);
    assert.equal(r.bySeverity.attention + r.bySeverity.risk + r.bySeverity.crisis, 0);
    assert.equal(r.highestSeverity, 'info');
  });
});

describe('computePulsoSummary — percentuais', () => {
  test('4x info + 1 risk → 80% info, 20% risk', () => {
    seq = 1;
    const list = [
      s({ severity: 'info' }),
      s({ severity: 'info' }),
      s({ severity: 'info' }),
      s({ severity: 'info' }),
      s({ severity: 'risk' }),
    ];
    const r = computePulsoSummary(list);
    assert.equal(r.percentBySeverity.info, 80);
    assert.equal(r.percentBySeverity.risk, 20);
    assert.equal(r.percentBySeverity.attention, 0);
    assert.equal(r.percentBySeverity.crisis, 0);
  });

  test('3 signals iguais dividindo → percentuais somam ~100 (arredondamento aceita)', () => {
    seq = 1;
    const list = [
      s({ severity: 'info' }),
      s({ severity: 'attention' }),
      s({ severity: 'risk' }),
    ];
    const r = computePulsoSummary(list);
    const sum = r.percentBySeverity.info + r.percentBySeverity.attention + r.percentBySeverity.risk + r.percentBySeverity.crisis;
    // Math.round(33.33) * 3 = 33 * 3 = 99. Tolerância ±2.
    assert.ok(sum >= 98 && sum <= 102, `soma dos %s = ${sum}`);
  });
});

describe('computePulsoSummary — top topics', () => {
  test('agrega counts, ordena DESC, corta em 3', () => {
    seq = 1;
    const list = [
      s({ topic: 'saude' }),
      s({ topic: 'saude' }),
      s({ topic: 'saude' }),
      s({ topic: 'seguranca' }),
      s({ topic: 'seguranca' }),
      s({ topic: 'educacao' }),
      s({ topic: 'transporte' }),
    ];
    const r = computePulsoSummary(list);
    assert.equal(r.topTopics.length, 3);
    assert.deepEqual(r.topTopics.map(t => t.topic), ['saude', 'seguranca', 'educacao']);
    assert.deepEqual(r.topTopics.map(t => t.count), [3, 2, 1]);
    // tie-break entre educacao e transporte: alfabético → educacao vence
  });

  test('topics null são ignorados', () => {
    seq = 1;
    const list = [
      s({ topic: null }),
      s({ topic: null }),
      s({ topic: 'saude' }),
    ];
    const r = computePulsoSummary(list);
    assert.equal(r.topTopics.length, 1);
    assert.equal(r.topTopics[0].topic, 'saude');
    assert.equal(r.topTopics[0].count, 1);
  });

  test('tie-break alfabético é determinístico', () => {
    seq = 1;
    // saude=2, transporte=2, educacao=2 → mesmo count; ordem alfabética: educacao < saude < transporte
    const list = [
      s({ topic: 'saude' }),
      s({ topic: 'saude' }),
      s({ topic: 'transporte' }),
      s({ topic: 'transporte' }),
      s({ topic: 'educacao' }),
      s({ topic: 'educacao' }),
    ];
    const r = computePulsoSummary(list);
    assert.deepEqual(r.topTopics.map(t => t.topic), ['educacao', 'saude', 'transporte']);
  });

  test('topic desconhecido cai no label = valor cru', () => {
    seq = 1;
    const list = [s({ topic: 'unknown_xyz' })];
    const r = computePulsoSummary(list);
    assert.equal(r.topTopics.length, 1);
    assert.equal(r.topTopics[0].label, 'unknown_xyz');
  });

  test('lista com só null topics devolve topTopics vazio', () => {
    seq = 1;
    const list = [s({ topic: null }), s({ topic: null })];
    const r = computePulsoSummary(list);
    assert.deepEqual(r.topTopics, []);
  });
});

// ── computeDayBuckets ─────────────────────────────────────────────

describe('computeDayBuckets — casos base', () => {
  test('lista vazia → array vazio', () => {
    const NOW_DATE = new Date('2026-08-27T12:00:00Z');
    const r = computeDayBuckets([], NOW_DATE);
    assert.deepEqual(r, []);
  });

  test('um signal no mesmo dia do now → 1 bucket', () => {
    seq = 1;
    const NOW_DATE = new Date('2026-08-27T12:00:00Z');
    const list = [s({ severity: 'crisis', emittedAt: '2026-08-27T05:00:00Z' })];
    const r = computeDayBuckets(list, NOW_DATE);
    assert.equal(r.length, 1);
    assert.equal(r[0].date, '2026-08-27');
    assert.equal(r[0].total, 1);
    assert.equal(r[0].crisis, 1);
  });
});

describe('computeDayBuckets — bucketing e range', () => {
  test('signals em 3 dias diferentes → 3 buckets ASC', () => {
    seq = 1;
    const NOW_DATE = new Date('2026-08-27T23:00:00Z');
    const list = [
      s({ severity: 'crisis', emittedAt: '2026-08-25T10:00:00Z' }),
      s({ severity: 'risk', emittedAt: '2026-08-26T02:00:00Z' }),
      s({ severity: 'attention', emittedAt: '2026-08-27T15:00:00Z' }),
    ];
    const r = computeDayBuckets(list, NOW_DATE);
    assert.equal(r.length, 3);
    assert.deepEqual(r.map(b => b.date), ['2026-08-25', '2026-08-26', '2026-08-27']);
    assert.equal(r[0].crisis, 1);
    assert.equal(r[1].risk, 1);
    assert.equal(r[2].attention, 1);
  });

  test('dias vazios entre extremos ficam zerados no bucket', () => {
    seq = 1;
    const NOW_DATE = new Date('2026-08-27T12:00:00Z');
    // signal em 25 e outro em 27 — 26 sem nada
    const list = [
      s({ severity: 'crisis', emittedAt: '2026-08-25T10:00:00Z' }),
      s({ severity: 'risk', emittedAt: '2026-08-27T10:00:00Z' }),
    ];
    const r = computeDayBuckets(list, NOW_DATE);
    assert.equal(r.length, 3);
    const day26 = r.find(b => b.date === '2026-08-26')!;
    assert.equal(day26.total, 0);
    assert.equal(day26.crisis, 0);
  });

  test('multiple signals no mesmo dia agregam corretamente', () => {
    seq = 1;
    const NOW_DATE = new Date('2026-08-27T12:00:00Z');
    const list = [
      s({ severity: 'crisis', emittedAt: '2026-08-27T05:00:00Z' }),
      s({ severity: 'crisis', emittedAt: '2026-08-27T15:00:00Z' }),
      s({ severity: 'info', emittedAt: '2026-08-27T20:00:00Z' }),
    ];
    const r = computeDayBuckets(list, NOW_DATE);
    assert.equal(r.length, 1);
    assert.equal(r[0].total, 3);
    assert.equal(r[0].crisis, 2);
    assert.equal(r[0].info, 1);
  });

  test('range vai até now UTC — signal antigo + now recente cria intervalo', () => {
    seq = 1;
    const NOW_DATE = new Date('2026-08-27T12:00:00Z');
    const list = [
      s({ emittedAt: '2026-08-24T00:00:00Z' }),
    ];
    const r = computeDayBuckets(list, NOW_DATE);
    // 24 25 26 27 — 4 dias
    assert.equal(r.length, 4);
    assert.deepEqual(r.map(b => b.date), ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27']);
  });

  test('emittedAt inválido é ignorado sem quebrar', () => {
    seq = 1;
    const NOW_DATE = new Date('2026-08-27T12:00:00Z');
    const bad = s();
    (bad as unknown as { emittedAt: string }).emittedAt = 'not-a-date';
    const good = s({ severity: 'crisis', emittedAt: '2026-08-27T10:00:00Z' });
    const r = computeDayBuckets([bad, good], NOW_DATE);
    // O bad tem emittedAt inválido → NaN.getTime() → não atualiza minMs (fica NOW_DATE);
    // range então é 27→27 (1 dia). good conta 1 crisis.
    assert.equal(r.length, 1);
    assert.equal(r[0].total, 1);
    assert.equal(r[0].crisis, 1);
  });
});
