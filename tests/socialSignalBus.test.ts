/**
 * Testes do PR 12 do PRD Social Intelligence — SocialSignalBus.
 *
 * Cobre (§48-§49):
 *   Adapters (builders):
 *     - buildSignalsFromTrends: skip em insufficient/stable_no_signal;
 *       severity por magnitude do delta
 *     - buildSignalsFromAnomalies: skip em insufficient_history;
 *       elevação a 'crisis' pra follower_drop/comment_spike com
 *       confidence>=0.85 e severity=risk; topic vem de metadata quando
 *       ausente no input
 *     - buildSignalsFromCrossNetworkSignals: severity por confidence +
 *       direction; divergent → attention; falling+high+3+ redes → risk
 *     - buildSignalsFromCrossNetworkAnomalies: risk+wide (>=3 redes) →
 *       crisis; attention+wide → risk
 *   Bus:
 *     - push mantém o de maior severity ao colidir dedupKey
 *     - keepHigherSeverity=false substitui sempre
 *     - list ordena por severity DESC → confidence DESC → emittedAt DESC
 *     - filtros bySeverity, atLeastSeverity, byTopic, byProvider,
 *       bySource, after
 *     - clear / size
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SocialSignalBus,
  buildSignalsFromTrends,
  buildSignalsFromAnomalies,
  buildSignalsFromCrossNetworkSignals,
  buildSignalsFromCrossNetworkAnomalies,
  SIGNAL_SEVERITY_HELPERS,
  SIGNAL_SEVERITY_ORDER,
  SOCIAL_SIGNAL_BUS_VERSION,
  type SocialSignal,
} from '../src/server/modules/social/intelligence/socialSignalBus';
import type { TrendResult } from '../src/server/modules/social/intelligence/trendDetector';
import type { AnomalyEvent } from '../src/server/modules/social/intelligence/anomalyDetector';
import type {
  CrossNetworkSignal,
  CrossNetworkAnomaly,
} from '../src/server/modules/social/intelligence/crossNetworkCorrelator';
import type { SocialProvider } from '../src/server/modules/social/contracts/socialProvider';

const NOW = new Date('2026-08-27T12:00:00Z');
const LATER = new Date('2026-08-27T13:00:00Z');
const EARLIER = new Date('2026-08-27T10:00:00Z');

// ── Helpers ─────────────────────────────────────────────────────────

function trend(
  state: TrendResult['state'],
  direction: TrendResult['direction'],
  deltaPct: number | null,
  confidence = 0.7,
): TrendResult {
  return {
    window: '24h',
    state,
    direction,
    currentTotal: 100,
    baselineTotal: 80,
    deltaPct,
    samples: { current: 5, baseline: 5 },
    confidence,
    detectorVersion: 'test',
  };
}

function anom(
  kind: AnomalyEvent['kind'],
  severity: AnomalyEvent['severity'],
  opts: Partial<Pick<AnomalyEvent, 'state' | 'confidence' | 'hypotheses' | 'summary' | 'metadata'>> = {},
): AnomalyEvent {
  return {
    kind,
    state: opts.state ?? 'detected',
    severity,
    summary: opts.summary ?? `stub summary for ${kind}`,
    hypotheses: opts.hypotheses ?? ['h1', 'h2'],
    observed: 100,
    baseline: 80,
    confidence: opts.confidence ?? 0.7,
    metadata: opts.metadata,
    detectorVersion: 'test',
  };
}

function cnTrend(
  direction: CrossNetworkSignal['direction'],
  confidence: CrossNetworkSignal['confidence'],
  networks: SocialProvider[],
  divergent: SocialProvider[] = [],
): CrossNetworkSignal {
  return {
    topic: 'saude',
    direction,
    networks,
    networksInsufficient: [],
    networksDivergent: divergent,
    confidence,
    averageDelta: 0.3,
    perProvider: networks.map(p => ({ provider: p, direction: 'rising', state: 'trend', deltaPct: 0.3 })),
    correlatorVersion: 'test',
  };
}

function cnAnom(
  kind: CrossNetworkAnomaly['kind'],
  severity: CrossNetworkAnomaly['severity'],
  networks: SocialProvider[],
  opts: { topic?: string; confidence?: number; hypotheses?: string[] } = {},
): CrossNetworkAnomaly {
  return {
    kind,
    topic: opts.topic,
    networks,
    severity,
    summaries: networks.map(p => ({ provider: p, summary: `stub ${p}` })),
    hypotheses: opts.hypotheses ?? ['h1'],
    confidence: opts.confidence ?? 0.7,
    occurrences: networks.length,
    correlatorVersion: 'test',
  };
}

// ── buildSignalsFromTrends ──────────────────────────────────────────

describe('buildSignalsFromTrends', () => {
  test('skip em state=insufficient_history', () => {
    const out = buildSignalsFromTrends([{
      provider: 'instagram',
      topic: 'saude',
      trendResult: trend('insufficient_history', 'stable', null),
      emittedAt: NOW,
    }]);
    assert.deepEqual(out, []);
  });

  test('skip em state=stable_no_signal', () => {
    const out = buildSignalsFromTrends([{
      provider: 'instagram',
      topic: 'saude',
      trendResult: trend('stable_no_signal', 'stable', 0.01),
      emittedAt: NOW,
    }]);
    assert.deepEqual(out, []);
  });

  test('trend com |delta|>=0.5 → severity=attention', () => {
    const out = buildSignalsFromTrends([{
      provider: 'instagram',
      topic: 'saude',
      trendResult: trend('trend', 'rising', 0.6),
      emittedAt: NOW,
    }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].severity, 'attention');
    assert.equal(out[0].source, 'trend');
    assert.equal(out[0].topic, 'saude');
    assert.deepEqual(out[0].providers, ['instagram']);
    assert.equal(out[0].busVersion, SOCIAL_SIGNAL_BUS_VERSION);
  });

  test('trend com |delta|<0.5 → severity=info', () => {
    const out = buildSignalsFromTrends([{
      provider: 'instagram',
      topic: 'saude',
      trendResult: trend('trend', 'falling', -0.2),
      emittedAt: NOW,
    }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].severity, 'info');
    assert.ok(out[0].summary.includes('falling'));
  });

  test('trend com deltaPct=null (baseline zero) tratado como 100% → attention', () => {
    const out = buildSignalsFromTrends([{
      provider: 'youtube',
      topic: 'novidade',
      trendResult: trend('trend', 'rising', null),
      emittedAt: NOW,
    }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].severity, 'attention');
    assert.ok(out[0].summary.includes('sem baseline'));
  });

  test('dedupKey inclui provider, topic, window, direction', () => {
    const out = buildSignalsFromTrends([{
      provider: 'facebook',
      topic: 'educacao',
      trendResult: trend('trend', 'rising', 0.3),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].dedupKey, 'trend::facebook::educacao::24h::rising');
  });
});

// ── buildSignalsFromAnomalies ───────────────────────────────────────

describe('buildSignalsFromAnomalies', () => {
  test('skip em state=insufficient_history', () => {
    const out = buildSignalsFromAnomalies([{
      provider: 'instagram',
      anomaly: anom('follower_spike', 'info', { state: 'insufficient_history' }),
      emittedAt: NOW,
    }]);
    assert.deepEqual(out, []);
  });

  test('severity=info/attention/risk é preservada por default', () => {
    const inputs = [
      { provider: 'instagram' as const, anomaly: anom('engagement_spike', 'info'), emittedAt: NOW },
      { provider: 'instagram' as const, anomaly: anom('engagement_spike', 'attention'), emittedAt: NOW },
      { provider: 'instagram' as const, anomaly: anom('engagement_spike', 'risk'), emittedAt: NOW },
    ];
    const out = buildSignalsFromAnomalies(inputs);
    assert.equal(out.length, 3);
    assert.deepEqual(out.map(o => o.severity), ['info', 'attention', 'risk']);
  });

  test('follower_drop + risk + confidence>=0.85 → crisis', () => {
    const out = buildSignalsFromAnomalies([{
      provider: 'instagram',
      anomaly: anom('follower_drop', 'risk', { confidence: 0.9 }),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].severity, 'crisis');
  });

  test('comment_spike + risk + confidence=0.85 (na borda) → crisis', () => {
    const out = buildSignalsFromAnomalies([{
      provider: 'facebook',
      anomaly: anom('comment_spike', 'risk', { confidence: 0.85 }),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].severity, 'crisis');
  });

  test('comment_spike + risk + confidence<0.85 → mantém risk', () => {
    const out = buildSignalsFromAnomalies([{
      provider: 'facebook',
      anomaly: anom('comment_spike', 'risk', { confidence: 0.8 }),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].severity, 'risk');
  });

  test('engagement_spike + risk + confidence=0.9 NÃO eleva (não é da lista)', () => {
    const out = buildSignalsFromAnomalies([{
      provider: 'instagram',
      anomaly: anom('engagement_spike', 'risk', { confidence: 0.9 }),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].severity, 'risk');
  });

  test('topic vem de metadata.topic quando ausente no input', () => {
    const out = buildSignalsFromAnomalies([{
      provider: 'instagram',
      anomaly: anom('sudden_topic_growth', 'attention', { metadata: { topic: 'seguranca' } }),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].topic, 'seguranca');
    assert.equal(out[0].dedupKey, 'anomaly::sudden_topic_growth::instagram::seguranca');
  });

  test('hypotheses passam pro signal', () => {
    const out = buildSignalsFromAnomalies([{
      provider: 'x',
      anomaly: anom('viral_post', 'attention', { hypotheses: ['xyz', 'abc'] }),
      emittedAt: NOW,
    }]);
    assert.deepEqual(out[0].hypotheses, ['xyz', 'abc']);
  });
});

// ── buildSignalsFromCrossNetworkSignals ─────────────────────────────

describe('buildSignalsFromCrossNetworkSignals', () => {
  test('confidence=high + direction=falling + 3+ redes → risk', () => {
    const out = buildSignalsFromCrossNetworkSignals([{
      crossSignal: cnTrend('falling', 'high', ['instagram', 'facebook', 'youtube', 'x']),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].severity, 'risk');
  });

  test('confidence=high + rising → attention', () => {
    const out = buildSignalsFromCrossNetworkSignals([{
      crossSignal: cnTrend('rising', 'high', ['instagram', 'facebook', 'youtube', 'x']),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].severity, 'attention');
  });

  test('direction=divergent → attention (independente de confidence)', () => {
    const out = buildSignalsFromCrossNetworkSignals([{
      crossSignal: cnTrend('divergent', 'low', ['instagram', 'facebook'], ['x']),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].severity, 'attention');
    assert.ok(out[0].summary.includes('direção oposta'));
  });

  test('confidence=medium sem divergência → info', () => {
    const out = buildSignalsFromCrossNetworkSignals([{
      crossSignal: cnTrend('rising', 'medium', ['instagram', 'facebook', 'youtube']),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].severity, 'info');
  });

  test('providers no signal vêm ordenados (dedupKey estável)', () => {
    const out = buildSignalsFromCrossNetworkSignals([{
      crossSignal: cnTrend('rising', 'high', ['youtube', 'facebook', 'instagram', 'x']),
      emittedAt: NOW,
    }]);
    assert.deepEqual(out[0].providers, ['facebook', 'instagram', 'x', 'youtube']);
    assert.equal(out[0].dedupKey, 'x_trend::saude::rising::facebook,instagram,x,youtube');
  });

  test('confidence do signal é derivada da CrossNetworkConfidence (low/medium/high)', () => {
    const low = buildSignalsFromCrossNetworkSignals([{ crossSignal: cnTrend('rising', 'low', ['instagram', 'facebook']), emittedAt: NOW }]);
    const med = buildSignalsFromCrossNetworkSignals([{ crossSignal: cnTrend('rising', 'medium', ['instagram', 'facebook', 'youtube']), emittedAt: NOW }]);
    const hi = buildSignalsFromCrossNetworkSignals([{ crossSignal: cnTrend('rising', 'high', ['instagram', 'facebook', 'youtube', 'x']), emittedAt: NOW }]);
    assert.equal(low[0].confidence, 0.4);
    assert.equal(med[0].confidence, 0.6);
    assert.equal(hi[0].confidence, 0.8);
  });
});

// ── buildSignalsFromCrossNetworkAnomalies ───────────────────────────

describe('buildSignalsFromCrossNetworkAnomalies', () => {
  test('risk em 3+ redes → crisis', () => {
    const out = buildSignalsFromCrossNetworkAnomalies([{
      crossAnomaly: cnAnom('sudden_topic_growth', 'risk', ['instagram', 'facebook', 'youtube'], { topic: 't' }),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].severity, 'crisis');
  });

  test('risk em 2 redes → risk (não eleva)', () => {
    const out = buildSignalsFromCrossNetworkAnomalies([{
      crossAnomaly: cnAnom('sudden_topic_growth', 'risk', ['instagram', 'facebook'], { topic: 't' }),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].severity, 'risk');
  });

  test('attention em 3+ redes → risk (eleva)', () => {
    const out = buildSignalsFromCrossNetworkAnomalies([{
      crossAnomaly: cnAnom('sudden_topic_growth', 'attention', ['instagram', 'facebook', 'youtube']),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].severity, 'risk');
  });

  test('attention em 2 redes → attention', () => {
    const out = buildSignalsFromCrossNetworkAnomalies([{
      crossAnomaly: cnAnom('sudden_topic_growth', 'attention', ['instagram', 'facebook']),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].severity, 'attention');
  });

  test('info sempre info', () => {
    const out = buildSignalsFromCrossNetworkAnomalies([{
      crossAnomaly: cnAnom('sudden_topic_growth', 'info', ['instagram', 'facebook', 'youtube', 'x']),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].severity, 'info');
  });

  test('providers ordenados no dedupKey', () => {
    const out = buildSignalsFromCrossNetworkAnomalies([{
      crossAnomaly: cnAnom('sudden_topic_growth', 'risk', ['youtube', 'instagram', 'facebook'], { topic: 'saude' }),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].dedupKey, 'x_anomaly::sudden_topic_growth::saude::facebook,instagram,youtube');
  });

  test('anomaly sem topic → dedupKey sem topic part', () => {
    const out = buildSignalsFromCrossNetworkAnomalies([{
      crossAnomaly: cnAnom('engagement_spike', 'attention', ['instagram', 'facebook']),
      emittedAt: NOW,
    }]);
    assert.equal(out[0].dedupKey, 'x_anomaly::engagement_spike::facebook,instagram');
  });
});

// ── SocialSignalBus ─────────────────────────────────────────────────

describe('SocialSignalBus — push + dedup', () => {
  test('push com dedupKey novo insere', () => {
    const bus = new SocialSignalBus();
    const [s] = buildSignalsFromAnomalies([{
      provider: 'instagram',
      anomaly: anom('engagement_spike', 'attention'),
      emittedAt: NOW,
    }]);
    bus.push(s);
    assert.equal(bus.size(), 1);
  });

  test('push com mesmo dedupKey + severity maior SUBSTITUI', () => {
    const bus = new SocialSignalBus();
    const [low] = buildSignalsFromAnomalies([{
      provider: 'instagram',
      anomaly: anom('engagement_spike', 'info'),
      emittedAt: NOW,
    }]);
    const [high] = buildSignalsFromAnomalies([{
      provider: 'instagram',
      anomaly: anom('engagement_spike', 'risk'),
      emittedAt: NOW,
    }]);
    bus.push(low);
    bus.push(high);
    assert.equal(bus.size(), 1);
    assert.equal(bus.list()[0].severity, 'risk');
  });

  test('push com mesmo dedupKey + severity MENOR NÃO substitui (default)', () => {
    const bus = new SocialSignalBus();
    const [high] = buildSignalsFromAnomalies([{
      provider: 'instagram',
      anomaly: anom('engagement_spike', 'risk'),
      emittedAt: NOW,
    }]);
    const [low] = buildSignalsFromAnomalies([{
      provider: 'instagram',
      anomaly: anom('engagement_spike', 'info'),
      emittedAt: NOW,
    }]);
    bus.push(high);
    bus.push(low);
    assert.equal(bus.list()[0].severity, 'risk');
  });

  test('mesma severity + emittedAt MAIS RECENTE substitui (refresh)', () => {
    const bus = new SocialSignalBus();
    const [older] = buildSignalsFromAnomalies([{
      provider: 'instagram',
      anomaly: anom('engagement_spike', 'attention', { summary: 'v1' }),
      emittedAt: EARLIER,
    }]);
    const [newer] = buildSignalsFromAnomalies([{
      provider: 'instagram',
      anomaly: anom('engagement_spike', 'attention', { summary: 'v2' }),
      emittedAt: LATER,
    }]);
    bus.push(older);
    bus.push(newer);
    assert.equal(bus.size(), 1);
    assert.ok(bus.list()[0].summary.includes('v2'));
  });

  test('keepHigherSeverity=false substitui sempre', () => {
    const bus = new SocialSignalBus({ keepHigherSeverity: false });
    const [high] = buildSignalsFromAnomalies([{
      provider: 'instagram',
      anomaly: anom('engagement_spike', 'risk'),
      emittedAt: NOW,
    }]);
    const [low] = buildSignalsFromAnomalies([{
      provider: 'instagram',
      anomaly: anom('engagement_spike', 'info'),
      emittedAt: NOW,
    }]);
    bus.push(high);
    bus.push(low);
    assert.equal(bus.list()[0].severity, 'info');
  });

  test('pushMany aceita array', () => {
    const bus = new SocialSignalBus();
    const signals = buildSignalsFromAnomalies([
      { provider: 'instagram', anomaly: anom('engagement_spike', 'info'), emittedAt: NOW },
      { provider: 'facebook', anomaly: anom('comment_spike', 'attention'), emittedAt: NOW },
    ]);
    bus.pushMany(signals);
    assert.equal(bus.size(), 2);
  });
});

describe('SocialSignalBus — priority sort', () => {
  test('list ordena por severity DESC → confidence DESC → emittedAt DESC', () => {
    const bus = new SocialSignalBus();
    // 4 signals com dedupKeys diferentes
    bus.pushMany([
      makeSignal({ dedupKey: 'a', severity: 'info', confidence: 0.9, emittedAt: NOW }),
      makeSignal({ dedupKey: 'b', severity: 'risk', confidence: 0.5, emittedAt: EARLIER }),
      makeSignal({ dedupKey: 'c', severity: 'attention', confidence: 0.9, emittedAt: NOW }),
      makeSignal({ dedupKey: 'd', severity: 'crisis', confidence: 0.3, emittedAt: EARLIER }),
    ]);
    const listed = bus.list().map(s => s.dedupKey);
    assert.deepEqual(listed, ['d', 'b', 'c', 'a']);
  });

  test('empate severity: confidence DESC decide', () => {
    const bus = new SocialSignalBus();
    bus.pushMany([
      makeSignal({ dedupKey: 'a', severity: 'attention', confidence: 0.5, emittedAt: LATER }),
      makeSignal({ dedupKey: 'b', severity: 'attention', confidence: 0.9, emittedAt: EARLIER }),
    ]);
    const listed = bus.list().map(s => s.dedupKey);
    assert.deepEqual(listed, ['b', 'a']);
  });

  test('empate severity+confidence: emittedAt DESC decide', () => {
    const bus = new SocialSignalBus();
    bus.pushMany([
      makeSignal({ dedupKey: 'a', severity: 'attention', confidence: 0.7, emittedAt: EARLIER }),
      makeSignal({ dedupKey: 'b', severity: 'attention', confidence: 0.7, emittedAt: LATER }),
    ]);
    const listed = bus.list().map(s => s.dedupKey);
    assert.deepEqual(listed, ['b', 'a']);
  });
});

describe('SocialSignalBus — filtros', () => {
  function seed(bus: SocialSignalBus): void {
    bus.pushMany([
      makeSignal({ dedupKey: 'a', severity: 'info', topic: 'saude', providers: ['instagram'], source: 'trend' }),
      makeSignal({ dedupKey: 'b', severity: 'risk', topic: 'saude', providers: ['facebook', 'youtube'], source: 'anomaly' }),
      makeSignal({ dedupKey: 'c', severity: 'attention', topic: 'educacao', providers: ['x'], source: 'trend' }),
      makeSignal({ dedupKey: 'd', severity: 'crisis', topic: 'seguranca', providers: ['instagram', 'facebook', 'youtube'], source: 'cross_network_anomaly' }),
    ]);
  }

  test('bySeverity retorna só o exato', () => {
    const bus = new SocialSignalBus();
    seed(bus);
    assert.deepEqual(bus.bySeverity('risk').map(s => s.dedupKey), ['b']);
  });

  test('atLeastSeverity retorna candidato >= floor', () => {
    const bus = new SocialSignalBus();
    seed(bus);
    const out = bus.atLeastSeverity('risk').map(s => s.dedupKey);
    assert.deepEqual(out.sort(), ['b', 'd']);
  });

  test('byTopic filtra por topic exato', () => {
    const bus = new SocialSignalBus();
    seed(bus);
    const out = bus.byTopic('saude').map(s => s.dedupKey);
    assert.deepEqual(out.sort(), ['a', 'b']);
  });

  test('byProvider filtra por rede específica (includes)', () => {
    const bus = new SocialSignalBus();
    seed(bus);
    const outIg = bus.byProvider('instagram').map(s => s.dedupKey);
    assert.deepEqual(outIg.sort(), ['a', 'd']);
    const outY = bus.byProvider('youtube').map(s => s.dedupKey);
    assert.deepEqual(outY.sort(), ['b', 'd']);
  });

  test('bySource filtra por origem', () => {
    const bus = new SocialSignalBus();
    seed(bus);
    assert.deepEqual(bus.bySource('trend').map(s => s.dedupKey).sort(), ['a', 'c']);
    assert.deepEqual(bus.bySource('anomaly').map(s => s.dedupKey), ['b']);
    assert.deepEqual(bus.bySource('cross_network_anomaly').map(s => s.dedupKey), ['d']);
  });

  test('after devolve só sinais >= data', () => {
    const bus = new SocialSignalBus();
    bus.pushMany([
      makeSignal({ dedupKey: 'a', severity: 'info', emittedAt: EARLIER }),
      makeSignal({ dedupKey: 'b', severity: 'info', emittedAt: NOW }),
      makeSignal({ dedupKey: 'c', severity: 'info', emittedAt: LATER }),
    ]);
    const out = bus.after(NOW).map(s => s.dedupKey);
    assert.deepEqual(out.sort(), ['b', 'c']);
  });
});

describe('SocialSignalBus — helpers', () => {
  test('SIGNAL_SEVERITY_ORDER estável info<attention<risk<crisis', () => {
    assert.ok(SIGNAL_SEVERITY_ORDER.info < SIGNAL_SEVERITY_ORDER.attention);
    assert.ok(SIGNAL_SEVERITY_ORDER.attention < SIGNAL_SEVERITY_ORDER.risk);
    assert.ok(SIGNAL_SEVERITY_ORDER.risk < SIGNAL_SEVERITY_ORDER.crisis);
  });

  test('SIGNAL_SEVERITY_HELPERS.compare', () => {
    assert.ok(SIGNAL_SEVERITY_HELPERS.compare('risk', 'info') > 0);
    assert.ok(SIGNAL_SEVERITY_HELPERS.compare('info', 'risk') < 0);
    assert.equal(SIGNAL_SEVERITY_HELPERS.compare('attention', 'attention'), 0);
  });

  test('SIGNAL_SEVERITY_HELPERS.isAtLeast', () => {
    assert.ok(SIGNAL_SEVERITY_HELPERS.isAtLeast('crisis', 'risk'));
    assert.ok(SIGNAL_SEVERITY_HELPERS.isAtLeast('risk', 'risk'));
    assert.ok(!SIGNAL_SEVERITY_HELPERS.isAtLeast('attention', 'risk'));
  });

  test('clear zera o bus', () => {
    const bus = new SocialSignalBus();
    bus.pushMany([
      makeSignal({ dedupKey: 'a', severity: 'info' }),
      makeSignal({ dedupKey: 'b', severity: 'risk' }),
    ]);
    assert.equal(bus.size(), 2);
    bus.clear();
    assert.equal(bus.size(), 0);
    assert.deepEqual(bus.list(), []);
  });
});

// ── Fixture helper para SocialSignal direto (sem passar por adapter) ─

function makeSignal(overrides: Partial<SocialSignal>): SocialSignal {
  return {
    dedupKey: overrides.dedupKey ?? 'stub',
    source: overrides.source ?? 'trend',
    severity: overrides.severity ?? 'info',
    summary: overrides.summary ?? 'stub summary',
    hypotheses: overrides.hypotheses ?? [],
    providers: overrides.providers ?? ['instagram'],
    topic: overrides.topic,
    confidence: overrides.confidence ?? 0.5,
    emittedAt: overrides.emittedAt ?? NOW,
    payload: overrides.payload ?? { kind: 'trend', result: trend('trend', 'rising', 0.3) },
    busVersion: SOCIAL_SIGNAL_BUS_VERSION,
  };
}
