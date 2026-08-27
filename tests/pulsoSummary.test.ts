/**
 * Testes de `computePulsoSummary` — função pura que deriva stats do feed
 * do Pulso Digital (PR 27). Componente React só renderiza a partir
 * dessa saída; a lógica toda mora aqui.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computePulsoSummary } from '../src/components/social/pulsoSummary';
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
