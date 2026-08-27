/**
 * Testes do PR 11 do PRD Social Intelligence — CrossNetworkCorrelator.
 *
 * Cobre (§46-§47):
 *   correlateNetworks:
 *     - 4 redes rising mesmo topic → direction=rising, confidence=high
 *     - 3 rising + 1 falling → direction=divergent
 *     - insufficient_history excluído da decisão, mas registrado
 *     - minConcurringNetworks respeitado (default 2)
 *     - averageDelta ignora nulls
 *     - stable_no_signal não conta como concurring
 *     - Múltiplos topics processados independentemente
 *     - Entradas vazias → []
 *   dedupAnomalies:
 *     - Mesma kind+topic em 4 redes → 1 CrossNetworkAnomaly com networks=[4]
 *     - Severity máxima é preservada
 *     - Hypotheses unionizadas (dedup)
 *     - Confidence média
 *     - insufficient_history filtrado
 *     - Anomalias sem topic (ex.: engagement_spike) agrupadas só por kind
 *     - Entradas vazias → []
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  correlateNetworks,
  dedupAnomalies,
  CROSS_NETWORK_CORRELATOR_VERSION,
  type ProviderTopicTrend,
  type ProviderAnomaly,
} from '../src/server/modules/social/intelligence/crossNetworkCorrelator';
import type { TrendResult } from '../src/server/modules/social/intelligence/trendDetector';
import type { AnomalyEvent } from '../src/server/modules/social/intelligence/anomalyDetector';
import type { SocialProvider } from '../src/server/modules/social/contracts/socialProvider';

// ── Helpers ─────────────────────────────────────────────────────────

function trend(
  direction: TrendResult['direction'],
  deltaPct: number | null,
  state: TrendResult['state'] = 'trend',
): TrendResult {
  return {
    window: '24h',
    state,
    direction,
    currentTotal: 100,
    baselineTotal: 80,
    deltaPct,
    samples: { current: 5, baseline: 5 },
    confidence: 0.7,
    detectorVersion: 'test',
  };
}

function pt(provider: SocialProvider, topic: string, t: TrendResult): ProviderTopicTrend {
  return { provider, topic, trendResult: t };
}

function anomaly(
  kind: AnomalyEvent['kind'],
  severity: AnomalyEvent['severity'],
  hypotheses: string[],
  opts: Partial<Pick<AnomalyEvent, 'confidence' | 'observed' | 'baseline' | 'metadata' | 'state' | 'summary'>> = {},
): AnomalyEvent {
  return {
    kind,
    state: opts.state ?? 'detected',
    severity,
    summary: opts.summary ?? `stub summary for ${kind}`,
    hypotheses,
    observed: opts.observed ?? 100,
    baseline: opts.baseline ?? 80,
    confidence: opts.confidence ?? 0.7,
    metadata: opts.metadata,
    detectorVersion: 'test',
  };
}

// ── correlateNetworks — concordância ────────────────────────────────

describe('correlateNetworks — concordância cross-network', () => {
  test('4 redes rising mesmo topic → direction=rising, confidence=high', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'saude', trend('rising', 0.5)),
      pt('facebook', 'saude', trend('rising', 0.4)),
      pt('youtube', 'saude', trend('rising', 0.3)),
      pt('tiktok', 'saude', trend('rising', 0.6)),
    ];
    const signals = correlateNetworks(entries);
    assert.equal(signals.length, 1);
    const [s] = signals;
    assert.equal(s.topic, 'saude');
    assert.equal(s.direction, 'rising');
    assert.equal(s.confidence, 'high');
    assert.equal(s.networks.length, 4);
    assert.deepEqual(s.networksDivergent, []);
    assert.deepEqual(s.networksInsufficient, []);
    assert.equal(s.correlatorVersion, CROSS_NETWORK_CORRELATOR_VERSION);
  });

  test('3 redes rising → confidence=medium', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'seguranca', trend('rising', 0.3)),
      pt('x', 'seguranca', trend('rising', 0.4)),
      pt('linkedin', 'seguranca', trend('rising', 0.5)),
    ];
    const signals = correlateNetworks(entries);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].confidence, 'medium');
    assert.equal(signals[0].direction, 'rising');
  });

  test('2 redes rising → confidence=low', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'educacao', trend('rising', 0.2)),
      pt('facebook', 'educacao', trend('rising', 0.3)),
    ];
    const signals = correlateNetworks(entries);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].confidence, 'low');
    assert.equal(signals[0].direction, 'rising');
  });

  test('4 redes falling mesmo topic → direction=falling', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'aprovacao', trend('falling', -0.2)),
      pt('facebook', 'aprovacao', trend('falling', -0.15)),
      pt('youtube', 'aprovacao', trend('falling', -0.3)),
      pt('x', 'aprovacao', trend('falling', -0.25)),
    ];
    const signals = correlateNetworks(entries);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].direction, 'falling');
    assert.equal(signals[0].confidence, 'high');
  });
});

// ── correlateNetworks — divergência §46-§47 ─────────────────────────

describe('correlateNetworks — divergência', () => {
  test('3 rising + 1 falling → direction=divergent (winner=rising)', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'economia', trend('rising', 0.4)),
      pt('facebook', 'economia', trend('rising', 0.3)),
      pt('youtube', 'economia', trend('rising', 0.2)),
      pt('x', 'economia', trend('falling', -0.1)),
    ];
    const signals = correlateNetworks(entries);
    assert.equal(signals.length, 1);
    const [s] = signals;
    assert.equal(s.direction, 'divergent');
    assert.equal(s.networks.length, 3, 'concordantes viram lista principal');
    assert.deepEqual(s.networksDivergent, ['x']);
    assert.equal(s.confidence, 'medium', '3 concordantes → medium');
  });

  test('2 rising + 2 falling → direction=divergent com winner=rising (empate, primeiro no if)', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'sus', trend('rising', 0.3)),
      pt('x', 'sus', trend('rising', 0.2)),
      pt('facebook', 'sus', trend('falling', -0.15)),
      pt('youtube', 'sus', trend('falling', -0.2)),
    ];
    const signals = correlateNetworks(entries);
    assert.equal(signals.length, 1);
    const [s] = signals;
    // Empate: implementação escolhe rising primeiro no if-else chain.
    assert.equal(s.direction, 'divergent');
    assert.equal(s.networks.length, 2);
    assert.equal(s.networksDivergent.length, 2);
  });

  test('2 falling + 1 rising → direction=divergent, winner=falling', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'transito', trend('falling', -0.2)),
      pt('facebook', 'transito', trend('falling', -0.3)),
      pt('x', 'transito', trend('rising', 0.1)),
    ];
    const signals = correlateNetworks(entries);
    assert.equal(signals.length, 1);
    const [s] = signals;
    assert.equal(s.direction, 'divergent');
    assert.deepEqual(s.networks.sort(), ['facebook', 'instagram']);
    assert.deepEqual(s.networksDivergent, ['x']);
  });
});

// ── correlateNetworks — insufficient_history ────────────────────────

describe('correlateNetworks — insufficient_history', () => {
  test('redes com insufficient_history não contam pra decisão, mas ficam registradas', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'moradia', trend('rising', 0.3)),
      pt('facebook', 'moradia', trend('rising', 0.4)),
      pt('kwai', 'moradia', trend('stable', null, 'insufficient_history')),
      pt('tiktok', 'moradia', trend('stable', null, 'insufficient_history')),
    ];
    const signals = correlateNetworks(entries);
    assert.equal(signals.length, 1);
    const [s] = signals;
    assert.equal(s.direction, 'rising');
    assert.equal(s.networks.length, 2);
    assert.deepEqual(s.networksInsufficient.sort(), ['kwai', 'tiktok']);
    assert.equal(s.confidence, 'low', '2 concordantes com 2 insuficientes → low');
  });

  test('todas com insufficient_history → nada emitido', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'ambiente', trend('stable', null, 'insufficient_history')),
      pt('facebook', 'ambiente', trend('stable', null, 'insufficient_history')),
    ];
    const signals = correlateNetworks(entries);
    assert.equal(signals.length, 0);
  });
});

// ── correlateNetworks — stable / min threshold ──────────────────────

describe('correlateNetworks — stable e min threshold', () => {
  test('redes stable_no_signal não contam como concurring', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'meio_ambiente', trend('stable', 0.02, 'stable_no_signal')),
      pt('facebook', 'meio_ambiente', trend('stable', 0.01, 'stable_no_signal')),
      pt('youtube', 'meio_ambiente', trend('rising', 0.3)),
    ];
    const signals = correlateNetworks(entries);
    // Só 1 rede em rising, min default é 2 → skip
    assert.equal(signals.length, 0);
  });

  test('1 rede rising sozinha → skip por minConcurringNetworks=2', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'agenda', trend('rising', 0.5)),
    ];
    const signals = correlateNetworks(entries);
    assert.equal(signals.length, 0);
  });

  test('override minConcurringNetworks=1 → emite mesmo com 1 rede', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'saneamento', trend('rising', 0.5)),
    ];
    const signals = correlateNetworks(entries, { minConcurringNetworks: 1 });
    assert.equal(signals.length, 1);
    assert.equal(signals[0].confidence, 'low');
  });
});

// ── correlateNetworks — averageDelta e perProvider ──────────────────

describe('correlateNetworks — averageDelta e perProvider', () => {
  test('averageDelta é média das deltaPct das concordantes', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'infra', trend('rising', 0.5)),
      pt('facebook', 'infra', trend('rising', 0.3)),
      pt('youtube', 'infra', trend('rising', 0.1)),
    ];
    const signals = correlateNetworks(entries);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].averageDelta, 0.3);
  });

  test('deltaPct=null é ignorada no cálculo do average', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'novidade', trend('rising', null)),
      pt('facebook', 'novidade', trend('rising', 0.4)),
    ];
    const signals = correlateNetworks(entries);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].averageDelta, 0.4, 'só a rede com delta não-null entra na média');
  });

  test('todas com deltaPct=null → averageDelta=null', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'zero_base', trend('rising', null)),
      pt('facebook', 'zero_base', trend('rising', null)),
    ];
    const signals = correlateNetworks(entries);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].averageDelta, null);
  });

  test('perProvider inclui TODAS as redes do topic (inclusive divergentes e stable)', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'drill', trend('rising', 0.3)),
      pt('facebook', 'drill', trend('rising', 0.4)),
      pt('x', 'drill', trend('falling', -0.2)),
      pt('kwai', 'drill', trend('stable', 0.01, 'stable_no_signal')),
    ];
    const signals = correlateNetworks(entries);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].perProvider.length, 4);
    const providers = signals[0].perProvider.map(p => p.provider).sort();
    assert.deepEqual(providers, ['facebook', 'instagram', 'kwai', 'x']);
  });
});

// ── correlateNetworks — múltiplos topics ────────────────────────────

describe('correlateNetworks — múltiplos topics', () => {
  test('topics diferentes são processados independentemente', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 'saude', trend('rising', 0.3)),
      pt('facebook', 'saude', trend('rising', 0.4)),
      pt('instagram', 'educacao', trend('falling', -0.2)),
      pt('facebook', 'educacao', trend('falling', -0.3)),
    ];
    const signals = correlateNetworks(entries);
    assert.equal(signals.length, 2);
    const saude = signals.find(s => s.topic === 'saude');
    const educacao = signals.find(s => s.topic === 'educacao');
    assert.ok(saude);
    assert.ok(educacao);
    assert.equal(saude!.direction, 'rising');
    assert.equal(educacao!.direction, 'falling');
  });

  test('input vazio → []', () => {
    assert.deepEqual(correlateNetworks([]), []);
  });
});

// ── correlateNetworks — thresholds customizados ─────────────────────

describe('correlateNetworks — thresholds customizados', () => {
  test('highConfidenceThreshold=3 → 3 redes já é high', () => {
    const entries: ProviderTopicTrend[] = [
      pt('instagram', 't', trend('rising', 0.3)),
      pt('facebook', 't', trend('rising', 0.3)),
      pt('youtube', 't', trend('rising', 0.3)),
    ];
    const signals = correlateNetworks(entries, {
      highConfidenceThreshold: 3,
      mediumConfidenceThreshold: 2,
    });
    assert.equal(signals[0].confidence, 'high');
  });
});

// ── dedupAnomalies §47 ──────────────────────────────────────────────

describe('dedupAnomalies — fusão por (kind, topic)', () => {
  test('mesma kind+topic em 4 redes → 1 signal com 4 networks', () => {
    const input: ProviderAnomaly[] = [
      { provider: 'instagram', topic: 'saude', anomaly: anomaly('sudden_topic_growth', 'attention', ['Interesse crescente']) },
      { provider: 'facebook', topic: 'saude', anomaly: anomaly('sudden_topic_growth', 'attention', ['Interesse crescente']) },
      { provider: 'youtube', topic: 'saude', anomaly: anomaly('sudden_topic_growth', 'risk', ['Controvérsia']) },
      { provider: 'x', topic: 'saude', anomaly: anomaly('sudden_topic_growth', 'attention', ['Interesse crescente']) },
    ];
    const out = dedupAnomalies(input);
    assert.equal(out.length, 1);
    const [a] = out;
    assert.equal(a.kind, 'sudden_topic_growth');
    assert.equal(a.topic, 'saude');
    assert.equal(a.networks.length, 4);
    assert.equal(a.occurrences, 4);
    assert.deepEqual(a.networks.sort(), ['facebook', 'instagram', 'x', 'youtube']);
    assert.equal(a.correlatorVersion, CROSS_NETWORK_CORRELATOR_VERSION);
  });

  test('severity=max entre as ocorrências', () => {
    const input: ProviderAnomaly[] = [
      { provider: 'instagram', topic: 'sus', anomaly: anomaly('sudden_topic_growth', 'info', ['x']) },
      { provider: 'facebook', topic: 'sus', anomaly: anomaly('sudden_topic_growth', 'risk', ['y']) },
      { provider: 'youtube', topic: 'sus', anomaly: anomaly('sudden_topic_growth', 'attention', ['z']) },
    ];
    const out = dedupAnomalies(input);
    assert.equal(out.length, 1);
    assert.equal(out[0].severity, 'risk');
  });

  test('hypotheses são unionizadas (dedup)', () => {
    const input: ProviderAnomaly[] = [
      { provider: 'instagram', topic: 'aloe', anomaly: anomaly('sudden_topic_growth', 'attention', ['A', 'B']) },
      { provider: 'facebook', topic: 'aloe', anomaly: anomaly('sudden_topic_growth', 'attention', ['B', 'C']) },
      { provider: 'x', topic: 'aloe', anomaly: anomaly('sudden_topic_growth', 'attention', ['C', 'D']) },
    ];
    const out = dedupAnomalies(input);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].hypotheses.sort(), ['A', 'B', 'C', 'D']);
  });

  test('confidence é média das ocorrências', () => {
    const input: ProviderAnomaly[] = [
      { provider: 'instagram', topic: 't', anomaly: anomaly('sudden_topic_growth', 'attention', ['h'], { confidence: 0.6 }) },
      { provider: 'facebook', topic: 't', anomaly: anomaly('sudden_topic_growth', 'attention', ['h'], { confidence: 0.8 }) },
    ];
    const out = dedupAnomalies(input);
    assert.equal(out.length, 1);
    assert.equal(out[0].confidence, 0.7);
  });

  test('summaries preservam per-provider drill-down', () => {
    const input: ProviderAnomaly[] = [
      { provider: 'instagram', topic: 't', anomaly: anomaly('sudden_topic_growth', 'attention', ['h'], { summary: 'IG: +200%' }) },
      { provider: 'facebook', topic: 't', anomaly: anomaly('sudden_topic_growth', 'attention', ['h'], { summary: 'FB: +150%' }) },
    ];
    const out = dedupAnomalies(input);
    assert.equal(out.length, 1);
    assert.equal(out[0].summaries.length, 2);
    const map = new Map(out[0].summaries.map(s => [s.provider, s.summary]));
    assert.equal(map.get('instagram'), 'IG: +200%');
    assert.equal(map.get('facebook'), 'FB: +150%');
  });
});

describe('dedupAnomalies — insufficient_history filtrada', () => {
  test('anomalias em insufficient_history são ignoradas', () => {
    const input: ProviderAnomaly[] = [
      { provider: 'instagram', topic: 'x', anomaly: anomaly('sudden_topic_growth', 'attention', ['h'], { state: 'insufficient_history' }) },
      { provider: 'facebook', topic: 'x', anomaly: anomaly('sudden_topic_growth', 'attention', ['h']) },
    ];
    const out = dedupAnomalies(input);
    assert.equal(out.length, 1);
    assert.equal(out[0].networks.length, 1, 'só a rede em state=detected sobrevive');
    assert.deepEqual(out[0].networks, ['facebook']);
  });

  test('TODAS insufficient_history → []', () => {
    const input: ProviderAnomaly[] = [
      { provider: 'instagram', topic: 'x', anomaly: anomaly('sudden_topic_growth', 'info', [], { state: 'insufficient_history' }) },
      { provider: 'facebook', topic: 'x', anomaly: anomaly('sudden_topic_growth', 'info', [], { state: 'insufficient_history' }) },
    ];
    const out = dedupAnomalies(input);
    assert.deepEqual(out, []);
  });
});

describe('dedupAnomalies — anomalias sem topic', () => {
  test('anomalias sem topic (ex.: engagement_spike) agrupadas só por kind', () => {
    const input: ProviderAnomaly[] = [
      { provider: 'instagram', anomaly: anomaly('engagement_spike', 'attention', ['viral']) },
      { provider: 'facebook', anomaly: anomaly('engagement_spike', 'risk', ['controversia']) },
      { provider: 'youtube', anomaly: anomaly('engagement_spike', 'info', ['algorithm boost']) },
    ];
    const out = dedupAnomalies(input);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'engagement_spike');
    assert.equal(out[0].topic, undefined);
    assert.equal(out[0].networks.length, 3);
    assert.equal(out[0].severity, 'risk');
  });

  test('kinds diferentes NÃO se fundem', () => {
    const input: ProviderAnomaly[] = [
      { provider: 'instagram', anomaly: anomaly('engagement_spike', 'attention', ['x']) },
      { provider: 'facebook', anomaly: anomaly('follower_spike', 'attention', ['y']) },
      { provider: 'youtube', anomaly: anomaly('comment_spike', 'risk', ['z']) },
    ];
    const out = dedupAnomalies(input);
    assert.equal(out.length, 3);
    const kinds = out.map(o => o.kind).sort();
    assert.deepEqual(kinds, ['comment_spike', 'engagement_spike', 'follower_spike']);
  });

  test('mesma kind + topics diferentes → 2 signals distintos', () => {
    const input: ProviderAnomaly[] = [
      { provider: 'instagram', topic: 'saude', anomaly: anomaly('sudden_topic_growth', 'attention', ['h']) },
      { provider: 'facebook', topic: 'saude', anomaly: anomaly('sudden_topic_growth', 'attention', ['h']) },
      { provider: 'instagram', topic: 'educacao', anomaly: anomaly('sudden_topic_growth', 'risk', ['e']) },
      { provider: 'facebook', topic: 'educacao', anomaly: anomaly('sudden_topic_growth', 'risk', ['e']) },
    ];
    const out = dedupAnomalies(input);
    assert.equal(out.length, 2);
    const bySaude = out.find(o => o.topic === 'saude');
    const byEduc = out.find(o => o.topic === 'educacao');
    assert.ok(bySaude);
    assert.ok(byEduc);
    assert.equal(bySaude!.severity, 'attention');
    assert.equal(byEduc!.severity, 'risk');
  });
});

describe('dedupAnomalies — topic via metadata', () => {
  test('sudden_topic_growth com topic em metadata é reconhecido', () => {
    // Padrão do anomalyDetector — sudden_topic_growth armazena topic em metadata.topic
    const input: ProviderAnomaly[] = [
      { provider: 'instagram', anomaly: anomaly('sudden_topic_growth', 'attention', ['h'], { metadata: { topic: 'seguranca' } }) },
      { provider: 'facebook', anomaly: anomaly('sudden_topic_growth', 'attention', ['h'], { metadata: { topic: 'seguranca' } }) },
    ];
    const out = dedupAnomalies(input);
    assert.equal(out.length, 1);
    assert.equal(out[0].topic, 'seguranca');
    assert.equal(out[0].networks.length, 2);
  });
});

describe('dedupAnomalies — edge cases', () => {
  test('input vazio → []', () => {
    assert.deepEqual(dedupAnomalies([]), []);
  });

  test('1 única ocorrência ainda produz 1 signal', () => {
    const input: ProviderAnomaly[] = [
      { provider: 'instagram', topic: 't', anomaly: anomaly('sudden_topic_growth', 'attention', ['h']) },
    ];
    const out = dedupAnomalies(input);
    assert.equal(out.length, 1);
    assert.equal(out[0].occurrences, 1);
    assert.equal(out[0].networks.length, 1);
  });
});
