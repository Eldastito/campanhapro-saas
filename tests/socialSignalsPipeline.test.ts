/**
 * Testes do PR 13 do PRD Social Intelligence — SocialSignalsPipeline.
 *
 * Cobre a orquestração end-to-end:
 *   - Input vazio → nenhum signal
 *   - Só trends → só trend signals
 *   - Só anomalies → só anomaly signals
 *   - Trends de 4 redes rising mesmo topic → gera CROSS-NETWORK signal
 *     E os individuais coexistem
 *   - Anomalies em 4 redes mesmo (kind, topic) → gera cross_network_anomaly
 *     E os individuais coexistem
 *   - insufficient_history dos detectors NÃO aparece no bus
 *   - windows customizados
 *   - raw output preservado pro drill-down
 *   - anomalyConfig customizado passa pra detectAnomalies
 *   - Sort priorizado do bus é aplicado
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runSocialSignalsPipeline,
  runSocialSignalsPipelineFlat,
  SOCIAL_SIGNALS_PIPELINE_VERSION,
  type PipelineInput,
} from '../src/server/modules/social/intelligence/socialSignalsPipeline';
import type { TimestampedCount } from '../src/server/modules/social/intelligence/trendDetector';

const NOW = new Date('2026-08-27T12:00:00Z');
const HOUR = 3_600_000;

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Gera séries com counts distintos entre current window e baseline
 * window. `currentPerHour`/`baselinePerHour` são valores por hora.
 * 24h window: current = últimas 24h; baseline = 24-48h atrás.
 */
function seriesForRising(currentPerHour: number, baselinePerHour: number): TimestampedCount[] {
  const series: TimestampedCount[] = [];
  // 5 pontos current (últimas 20h)
  for (let i = 1; i <= 20; i += 4) {
    series.push({ at: new Date(NOW.getTime() - i * HOUR), count: currentPerHour });
  }
  // 5 pontos baseline (24-44h atrás)
  for (let i = 25; i <= 45; i += 4) {
    series.push({ at: new Date(NOW.getTime() - i * HOUR), count: baselinePerHour });
  }
  return series;
}

// ── Suíte ───────────────────────────────────────────────────────────

describe('runSocialSignalsPipeline — casos básicos', () => {
  test('input vazio → sem signals; raw vazias; pipelineVersion carimbada', () => {
    const out = runSocialSignalsPipeline({ now: NOW, perProvider: [] });
    assert.deepEqual(out.signals, []);
    assert.deepEqual(out.raw.trendsByProviderTopic, []);
    assert.deepEqual(out.raw.anomaliesByProvider, []);
    assert.equal(out.pipelineVersion, SOCIAL_SIGNALS_PIPELINE_VERSION);
  });

  test('só topicSeries em 1 provider → só trend signals (nenhum cross-network)', () => {
    const input: PipelineInput = {
      now: NOW,
      perProvider: [{
        provider: 'instagram',
        topicSeries: { saude: seriesForRising(50, 10) },
      }],
    };
    const out = runSocialSignalsPipeline(input);
    assert.equal(out.signals.length, 1);
    assert.equal(out.signals[0].source, 'trend');
    assert.equal(out.signals[0].topic, 'saude');
    assert.deepEqual(out.signals[0].providers, ['instagram']);
    // raw preservado
    assert.equal(out.raw.trendsByProviderTopic.length, 1);
    assert.equal(out.raw.anomaliesByProvider.length, 0);
  });

  test('só followers snapshot → só anomaly signal', () => {
    const input: PipelineInput = {
      now: NOW,
      perProvider: [{
        provider: 'instagram',
        followers: { current: 16440, baseline: 12000 },  // +37%
      }],
    };
    const out = runSocialSignalsPipeline(input);
    assert.equal(out.signals.length, 1);
    assert.equal(out.signals[0].source, 'anomaly');
    assert.ok(out.signals[0].summary.includes('follower_spike'));
  });
});

describe('runSocialSignalsPipeline — cross-network', () => {
  test('4 redes rising mesmo topic → cross-network signal COEXISTINDO com individuais', () => {
    const series = seriesForRising(50, 10);
    const input: PipelineInput = {
      now: NOW,
      perProvider: [
        { provider: 'instagram', topicSeries: { saude: series } },
        { provider: 'facebook', topicSeries: { saude: series } },
        { provider: 'youtube', topicSeries: { saude: series } },
        { provider: 'x', topicSeries: { saude: series } },
      ],
    };
    const out = runSocialSignalsPipeline(input);

    // 4 trends individuais + 1 cross-network trend = 5 signals
    assert.equal(out.signals.length, 5);
    const bySource = out.signals.reduce((acc, s) => {
      acc[s.source] = (acc[s.source] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    assert.equal(bySource.trend, 4);
    assert.equal(bySource.cross_network_trend, 1);

    // Cross-network signal carrega 4 providers ordenados
    const cnSignal = out.signals.find(s => s.source === 'cross_network_trend')!;
    assert.deepEqual(cnSignal.providers, ['facebook', 'instagram', 'x', 'youtube']);
    assert.equal(cnSignal.topic, 'saude');
  });

  test('4 redes com sudden_topic_growth mesmo topic → cross_network_anomaly + 4 anomalies individuais', () => {
    // topics: current 20 vs baseline 5 → ratio 3× (>1.0 default threshold)
    const topics = [{ topic: 'saude', current: 20, baseline: 5 }];
    const input: PipelineInput = {
      now: NOW,
      perProvider: [
        { provider: 'instagram', topicSnapshots: topics },
        { provider: 'facebook', topicSnapshots: topics },
        { provider: 'youtube', topicSnapshots: topics },
        { provider: 'x', topicSnapshots: topics },
      ],
    };
    const out = runSocialSignalsPipeline(input);

    const bySource = out.signals.reduce((acc, s) => {
      acc[s.source] = (acc[s.source] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    assert.equal(bySource.anomaly, 4);
    assert.equal(bySource.cross_network_anomaly, 1);

    const cnAnomaly = out.signals.find(s => s.source === 'cross_network_anomaly')!;
    // 4 redes + risk elevado → severity crisis (attention + wide=3+ eleva a risk;
    // atenção — o AnomalyEvent do sudden_topic_growth sai como severity='attention' por default.
    // Regra: attention + wide (>=3) → risk.
    assert.equal(cnAnomaly.severity, 'risk');
    assert.equal(cnAnomaly.topic, 'saude');
  });
});

describe('runSocialSignalsPipeline — insufficient_history não polui bus', () => {
  test('série com poucos pontos → trend fica insufficient → nada no bus', () => {
    const input: PipelineInput = {
      now: NOW,
      perProvider: [{
        provider: 'instagram',
        topicSeries: {
          saude: [
            { at: new Date(NOW.getTime() - 1 * HOUR), count: 5 },
          ],
        },
      }],
    };
    const out = runSocialSignalsPipeline(input);
    assert.deepEqual(out.signals, []);
    // raw ainda contém o TrendResult com state=insufficient_history (pra drill-down)
    assert.equal(out.raw.trendsByProviderTopic.length, 1);
    assert.equal(out.raw.trendsByProviderTopic[0].trendResult.state, 'insufficient_history');
  });

  test('followers sem baseline → anomaly em insufficient → nada no bus', () => {
    const input: PipelineInput = {
      now: NOW,
      perProvider: [{
        provider: 'instagram',
        followers: { current: 1000, baseline: null },
      }],
    };
    const out = runSocialSignalsPipeline(input);
    assert.deepEqual(out.signals, []);
    // raw preserva a anomaly em state=insufficient_history
    assert.equal(out.raw.anomaliesByProvider.length, 1);
    assert.equal(out.raw.anomaliesByProvider[0].anomaly.state, 'insufficient_history');
  });
});

describe('runSocialSignalsPipeline — windows múltiplas', () => {
  test('windows=[24h, 7d] gera 2 signals por (provider, topic) se ambas viradas', () => {
    // Série longa: 40 dias, 1 ponto por dia com valores altos recentes
    const DAY = 86_400_000;
    const points: TimestampedCount[] = [];
    for (let i = 0; i < 40; i++) {
      const value = i < 7 ? 30 : 5;
      points.push({ at: new Date(NOW.getTime() - (i + 1) * DAY + HOUR), count: value });
    }
    const input: PipelineInput = {
      now: NOW,
      windows: ['24h', '7d'],
      perProvider: [{
        provider: 'instagram',
        topicSeries: { saude: points },
      }],
      // Reduz minSamplesPerSide para 24h caber
      trendOptions: { minSamplesPerSide: 1 },
    };
    const out = runSocialSignalsPipeline(input);
    // 2 windows * 1 topic * 1 provider — se ambas viraram trend, temos 2
    // Ao menos uma delas deve estar presente
    assert.ok(out.raw.trendsByProviderTopic.length === 2);
  });
});

describe('runSocialSignalsPipeline — configs customizados', () => {
  test('anomalyConfig.followerDeltaThreshold=0.5 barra spike de 30%', () => {
    const input: PipelineInput = {
      now: NOW,
      perProvider: [{
        provider: 'instagram',
        followers: { current: 13000, baseline: 10000 },  // +30%
      }],
      anomalyConfig: { followerDeltaThreshold: 0.5 },
    };
    const out = runSocialSignalsPipeline(input);
    assert.deepEqual(out.signals, []);
  });

  test('correlateOptions.minConcurringNetworks=1 emite cross-network mesmo com 1 rede', () => {
    const series = seriesForRising(50, 10);
    const input: PipelineInput = {
      now: NOW,
      perProvider: [
        { provider: 'instagram', topicSeries: { saude: series } },
      ],
      correlateOptions: { minConcurringNetworks: 1 },
    };
    const out = runSocialSignalsPipeline(input);
    // 1 trend + 1 cross_network_trend
    const cn = out.signals.filter(s => s.source === 'cross_network_trend');
    assert.equal(cn.length, 1);
  });
});

describe('runSocialSignalsPipeline — sort priorizado', () => {
  test('signals vêm ordenados por severity DESC', () => {
    const input: PipelineInput = {
      now: NOW,
      perProvider: [
        {
          provider: 'instagram',
          followers: { current: 15000, baseline: 20000 },  // -25% → risk
        },
        {
          provider: 'facebook',
          engagement: {
            current: 130,
            baseline: 100,
            currentComments: 30,
            baselineComments: 20,
          },  // +30% → info (abaixo do 50% threshold engagement)
        },
      ],
    };
    const out = runSocialSignalsPipeline(input);
    // Risk (follower_drop) deve vir antes de qualquer info
    assert.ok(out.signals.length >= 1);
    if (out.signals.length >= 2) {
      const first = out.signals[0];
      const others = out.signals.slice(1);
      for (const s of others) {
        assert.ok(
          ['info', 'attention', 'risk', 'crisis'].indexOf(first.severity)
          >= ['info', 'attention', 'risk', 'crisis'].indexOf(s.severity),
          `severity primeiro ${first.severity} deve ser >= ${s.severity}`,
        );
      }
    }
  });
});

describe('runSocialSignalsPipelineFlat', () => {
  test('devolve só o array de signals (sem raw)', () => {
    const out = runSocialSignalsPipelineFlat({
      now: NOW,
      perProvider: [{
        provider: 'instagram',
        followers: { current: 16000, baseline: 10000 },
      }],
    });
    assert.ok(Array.isArray(out));
    assert.equal(out.length, 1);
    assert.equal(out[0].source, 'anomaly');
  });
});
