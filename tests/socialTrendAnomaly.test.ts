/**
 * Testes do PR 10 do PRD Social Intelligence — TrendDetector + AnomalyDetector.
 *
 * Cobre:
 *   Trend:
 *     - 3 janelas (24h/7d/30d)
 *     - `insufficient_history` explícito (§45)
 *     - Baseline zero + current > 0 → trend rising sem deltaPct
 *     - stable_no_signal quando delta é pequeno
 *     - detectAllWindows helper
 *   Anomaly:
 *     - Cada uma das 7 categorias com fixture
 *     - `insufficient_history` propagado quando falta dado
 *     - Config override funciona
 *     - Hypotheses sempre populadas em state=detected
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectTrend,
  detectAllWindows,
  TREND_DETECTOR_VERSION,
  type TimestampedCount,
} from '../src/server/modules/social/intelligence/trendDetector';
import {
  detectAnomalies,
  DEFAULT_ANOMALY_CONFIG,
  ANOMALY_DETECTOR_VERSION,
} from '../src/server/modules/social/intelligence/anomalyDetector';

// Data fixa nos testes — pura determinística
const NOW = new Date('2026-08-26T12:00:00Z');
const DAY = 86_400_000;
const HOUR = 3_600_000;

function series(entries: Array<[Date, number]>): TimestampedCount[] {
  return entries.map(([at, count]) => ({ at, count }));
}

// ── TrendDetector ──────────────────────────────────────────────────

describe('TrendDetector — janelas', () => {
  test('24h window: current vs previous 24h', () => {
    // 5 pontos nas últimas 24h com counts totais 50
    const currentPoints: [Date, number][] = [
      [new Date(NOW.getTime() - 1 * HOUR), 10],
      [new Date(NOW.getTime() - 3 * HOUR), 10],
      [new Date(NOW.getTime() - 6 * HOUR), 10],
      [new Date(NOW.getTime() - 12 * HOUR), 10],
      [new Date(NOW.getTime() - 20 * HOUR), 10],
    ];
    // 4 pontos nas 24h anteriores com counts totais 20
    const baselinePoints: [Date, number][] = [
      [new Date(NOW.getTime() - 25 * HOUR), 5],
      [new Date(NOW.getTime() - 30 * HOUR), 5],
      [new Date(NOW.getTime() - 40 * HOUR), 5],
      [new Date(NOW.getTime() - 47 * HOUR), 5],
    ];
    const r = detectTrend({
      now: NOW,
      window: '24h',
      series: series([...currentPoints, ...baselinePoints]),
    });
    assert.equal(r.state, 'trend');
    assert.equal(r.direction, 'rising');
    assert.equal(r.currentTotal, 50);
    assert.equal(r.baselineTotal, 20);
    assert.equal(r.deltaPct, 1.5); // 30/20
    assert.ok(r.confidence > 0.3 && r.confidence <= 0.9);
    assert.equal(r.detectorVersion, TREND_DETECTOR_VERSION);
  });

  test('7d e 30d retornam trend com samples corretos', () => {
    // Serie longa: 40 dias, 1 ponto por dia offset por 1h pra evitar exact-boundary
    const points: [Date, number][] = [];
    for (let i = 0; i < 40; i++) {
      // i=0 é ONTEM às 12h (1 dia atrás), pra ficar dentro do window atual
      points.push([new Date(NOW.getTime() - (i + 1) * DAY + HOUR), 1]);
    }
    const s = series(points);

    const r7d = detectTrend({ now: NOW, window: '7d', series: s });
    assert.equal(r7d.state, 'stable_no_signal', 'todos os pontos são iguais → não há tendência');
    assert.equal(r7d.samples.current, 7);
    assert.equal(r7d.samples.baseline, 7);

    const r30d = detectTrend({ now: NOW, window: '30d', series: s });
    assert.equal(r30d.samples.current, 30);
    assert.equal(r30d.samples.baseline, 10, 'baseline é 10 (só 40 dias no total)');
  });
});

describe('TrendDetector — insufficient_history §45', () => {
  test('sem amostras suficientes em CADA lado → insufficient_history', () => {
    const r = detectTrend({
      now: NOW,
      window: '24h',
      series: series([[new Date(NOW.getTime() - 1 * HOUR), 5]]),
    });
    assert.equal(r.state, 'insufficient_history');
    assert.equal(r.deltaPct, null);
    assert.equal(r.confidence, 0);
    assert.equal(r.direction, 'stable');
  });

  test('só amostras no current, zero baseline → insufficient_history', () => {
    const r = detectTrend({
      now: NOW,
      window: '24h',
      series: series([
        [new Date(NOW.getTime() - 1 * HOUR), 10],
        [new Date(NOW.getTime() - 5 * HOUR), 10],
        [new Date(NOW.getTime() - 12 * HOUR), 10],
      ]),
    });
    assert.equal(r.state, 'insufficient_history');
    assert.equal(r.samples.baseline, 0);
  });

  test('minSamplesPerSide customizado', () => {
    const s = series([
      [new Date(NOW.getTime() - 1 * HOUR), 10],
      [new Date(NOW.getTime() - 12 * HOUR), 10],
      [new Date(NOW.getTime() - 25 * HOUR), 5],
      [new Date(NOW.getTime() - 40 * HOUR), 5],
    ]);
    const strict = detectTrend({ now: NOW, window: '24h', series: s, minSamplesPerSide: 3 });
    assert.equal(strict.state, 'insufficient_history');

    const lenient = detectTrend({ now: NOW, window: '24h', series: s, minSamplesPerSide: 2 });
    assert.equal(lenient.state, 'trend');
  });
});

describe('TrendDetector — casos especiais', () => {
  test('baseline zero + current > 0 → trend rising com deltaPct=null', () => {
    const r = detectTrend({
      now: NOW,
      window: '24h',
      series: series([
        [new Date(NOW.getTime() - 1 * HOUR), 10],
        [new Date(NOW.getTime() - 5 * HOUR), 10],
        [new Date(NOW.getTime() - 12 * HOUR), 10],
        [new Date(NOW.getTime() - 25 * HOUR), 0],
        [new Date(NOW.getTime() - 30 * HOUR), 0],
        [new Date(NOW.getTime() - 40 * HOUR), 0],
      ]),
    });
    assert.equal(r.state, 'trend');
    assert.equal(r.direction, 'rising');
    assert.equal(r.deltaPct, null, 'deltaPct null quando baseline=0');
    assert.ok(r.confidence > 0);
  });

  test('ambos zeros → stable_no_signal', () => {
    const r = detectTrend({
      now: NOW,
      window: '24h',
      series: series([
        [new Date(NOW.getTime() - 1 * HOUR), 0],
        [new Date(NOW.getTime() - 5 * HOUR), 0],
        [new Date(NOW.getTime() - 12 * HOUR), 0],
        [new Date(NOW.getTime() - 25 * HOUR), 0],
        [new Date(NOW.getTime() - 30 * HOUR), 0],
        [new Date(NOW.getTime() - 40 * HOUR), 0],
      ]),
    });
    assert.equal(r.state, 'stable_no_signal');
    assert.equal(r.deltaPct, 0);
  });

  test('stable_no_signal quando delta < threshold', () => {
    // 3% delta com stableThreshold=0.05 → stable
    const s = series([
      [new Date(NOW.getTime() - 1 * HOUR), 10],
      [new Date(NOW.getTime() - 5 * HOUR), 10],
      [new Date(NOW.getTime() - 12 * HOUR), 10],
      [new Date(NOW.getTime() - 25 * HOUR), 10],
      [new Date(NOW.getTime() - 30 * HOUR), 10],
      [new Date(NOW.getTime() - 40 * HOUR), 10],
    ]);
    // current 30 baseline 30 → 0% delta
    const r = detectTrend({ now: NOW, window: '24h', series: s });
    assert.equal(r.state, 'stable_no_signal');
  });

  test('falling detection', () => {
    const s = series([
      [new Date(NOW.getTime() - 1 * HOUR), 1],
      [new Date(NOW.getTime() - 5 * HOUR), 1],
      [new Date(NOW.getTime() - 12 * HOUR), 1],
      [new Date(NOW.getTime() - 25 * HOUR), 10],
      [new Date(NOW.getTime() - 30 * HOUR), 10],
      [new Date(NOW.getTime() - 40 * HOUR), 10],
    ]);
    const r = detectTrend({ now: NOW, window: '24h', series: s });
    assert.equal(r.state, 'trend');
    assert.equal(r.direction, 'falling');
    assert.equal(r.currentTotal, 3);
    assert.equal(r.baselineTotal, 30);
    assert.equal(Number(r.deltaPct!.toFixed(2)), -0.9);
  });
});

describe('TrendDetector — detectAllWindows helper', () => {
  test('retorna as 3 janelas', () => {
    const s = series([
      [new Date(NOW.getTime() - 1 * HOUR), 10],
      [new Date(NOW.getTime() - 5 * HOUR), 10],
      [new Date(NOW.getTime() - 12 * HOUR), 10],
      [new Date(NOW.getTime() - 25 * HOUR), 5],
      [new Date(NOW.getTime() - 30 * HOUR), 5],
      [new Date(NOW.getTime() - 40 * HOUR), 5],
    ]);
    const all = detectAllWindows({ now: NOW, series: s });
    assert.equal(all['24h'].window, '24h');
    assert.equal(all['7d'].window, '7d');
    assert.equal(all['30d'].window, '30d');
  });
});

// ── AnomalyDetector ─────────────────────────────────────────────────

describe('AnomalyDetector — follower spike/drop', () => {
  test('follower_spike detectado com hypotheses populadas', () => {
    const events = detectAnomalies({
      followers: { current: 16000, baseline: 12000 },
    });
    const spike = events.find(e => e.kind === 'follower_spike');
    assert.ok(spike);
    assert.equal(spike!.state, 'detected');
    assert.equal(spike!.severity, 'attention');
    assert.match(spike!.summary, /Followers \+33\.3%/);
    assert.ok(spike!.hypotheses.length >= 2);
    assert.equal(spike!.detectorVersion, ANOMALY_DETECTOR_VERSION);
  });

  test('follower_drop detectado com severity=risk', () => {
    const events = detectAnomalies({
      followers: { current: 8000, baseline: 12000 },
    });
    const drop = events.find(e => e.kind === 'follower_drop');
    assert.ok(drop);
    assert.equal(drop!.severity, 'risk');
    assert.match(drop!.summary, /-33\.3%/);
  });

  test('delta abaixo do threshold → nada', () => {
    const events = detectAnomalies({
      followers: { current: 12500, baseline: 12000 }, // ~4%
    });
    assert.equal(events.length, 0);
  });

  test('baseline null → insufficient_history', () => {
    const events = detectAnomalies({
      followers: { current: 12000, baseline: null },
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].state, 'insufficient_history');
    assert.equal(events[0].confidence, 0);
  });
});

describe('AnomalyDetector — engagement + comment spike', () => {
  test('engagement_spike detectado', () => {
    const events = detectAnomalies({
      engagement: {
        current: 3000, baseline: 1000,
        currentComments: 100, baselineComments: 90,
      },
    });
    const spike = events.find(e => e.kind === 'engagement_spike');
    assert.ok(spike);
    assert.equal(spike!.state, 'detected');
    assert.match(spike!.summary, /\+200\.0%/);
  });

  test('comment_spike SEPARADO do engagement_spike', () => {
    // Só comments dobrou — engagement geral estável
    const events = detectAnomalies({
      engagement: {
        current: 1000, baseline: 900,        // engagement estável (~10%)
        currentComments: 500, baselineComments: 100,  // comments 5x
      },
    });
    const engagementSpike = events.find(e => e.kind === 'engagement_spike');
    const commentSpike = events.find(e => e.kind === 'comment_spike');
    assert.ok(!engagementSpike);
    assert.ok(commentSpike);
    assert.equal(commentSpike!.state, 'detected');
    assert.match(commentSpike!.summary, /Comments/);
  });
});

describe('AnomalyDetector — negative_sentiment_spike', () => {
  test('sentiment dobrou vs baseline → risk', () => {
    const events = detectAnomalies({
      sentiment: {
        currentNegRatio: 0.60, baselineNegRatio: 0.30,
        currentClassifiedCount: 100, baselineClassifiedCount: 80,
      },
    });
    const spike = events.find(e => e.kind === 'negative_sentiment_spike');
    assert.ok(spike);
    assert.equal(spike!.severity, 'risk');
    assert.match(spike!.summary, /Negatividade/);
  });

  test('baseline zero mas current > 20% → surge from zero', () => {
    const events = detectAnomalies({
      sentiment: {
        currentNegRatio: 0.30, baselineNegRatio: 0,
        currentClassifiedCount: 50, baselineClassifiedCount: 50,
      },
    });
    const spike = events.find(e => e.kind === 'negative_sentiment_spike');
    assert.ok(spike);
    assert.match(spike!.summary, /surgiu do zero/);
  });

  test('nulls (não classificado) → insufficient_history', () => {
    const events = detectAnomalies({
      sentiment: {
        currentNegRatio: null, baselineNegRatio: 0.3,
        currentClassifiedCount: 100, baselineClassifiedCount: 100,
      },
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].state, 'insufficient_history');
  });

  test('amostra pequena → insufficient_history mesmo com ratio grande', () => {
    const events = detectAnomalies({
      sentiment: {
        currentNegRatio: 0.9, baselineNegRatio: 0.1,
        currentClassifiedCount: 2, baselineClassifiedCount: 2,
      },
    });
    assert.equal(events[0].state, 'insufficient_history');
  });
});

describe('AnomalyDetector — viral_post', () => {
  test('post 10x acima da média + >50 interações → viral', () => {
    // 9 posts com engagement ~10 e 1 post com 500. Média=~59, ratio ~8.5×
    const feed = [
      { externalId: 'p1', provider: 'x', engagement: 8, publishedAt: new Date() },
      { externalId: 'p2', provider: 'x', engagement: 10, publishedAt: new Date() },
      { externalId: 'p3', provider: 'x', engagement: 12, publishedAt: new Date() },
      { externalId: 'p4', provider: 'x', engagement: 9, publishedAt: new Date() },
      { externalId: 'p5', provider: 'x', engagement: 11, publishedAt: new Date() },
      { externalId: 'p6', provider: 'x', engagement: 7, publishedAt: new Date() },
      { externalId: 'p7', provider: 'x', engagement: 13, publishedAt: new Date() },
      { externalId: 'p8', provider: 'x', engagement: 10, publishedAt: new Date() },
      { externalId: 'p9', provider: 'x', engagement: 500, publishedAt: new Date() }, // viral
    ];
    const events = detectAnomalies({ currentPosts: feed });
    const viral = events.filter(e => e.kind === 'viral_post');
    assert.equal(viral.length, 1);
    assert.equal((viral[0].metadata as any).postExternalId, 'p9');
    assert.ok(viral[0].hypotheses.some(h => /nervo/.test(h)));
  });

  test('post 10x acima mas < 50 interações → NÃO viral (evita ruído)', () => {
    const feed = [
      { externalId: 'p1', provider: 'x', engagement: 1, publishedAt: new Date() },
      { externalId: 'p2', provider: 'x', engagement: 1, publishedAt: new Date() },
      { externalId: 'p3', provider: 'x', engagement: 30, publishedAt: new Date() }, // 15x mas < 50
    ];
    const events = detectAnomalies({ currentPosts: feed });
    assert.equal(events.filter(e => e.kind === 'viral_post').length, 0);
  });

  test('feed pequeno → nada (evita baseline instável)', () => {
    const feed = [
      { externalId: 'p1', provider: 'x', engagement: 100, publishedAt: new Date() },
    ];
    const events = detectAnomalies({ currentPosts: feed });
    assert.equal(events.length, 0);
  });
});

describe('AnomalyDetector — sudden_topic_growth', () => {
  test('tópico dobrou → detected', () => {
    const events = detectAnomalies({
      topics: [
        { topic: 'saude', current: 40, baseline: 15 },
      ],
    });
    const growth = events.find(e => e.kind === 'sudden_topic_growth');
    assert.ok(growth);
    assert.equal((growth!.metadata as any).topic, 'saude');
    assert.match(growth!.summary, /saude/);
  });

  test('tópico novo do zero com 5+ menções → detected', () => {
    const events = detectAnomalies({
      topics: [
        { topic: 'enchentes', current: 12, baseline: 0 },
      ],
    });
    const growth = events.find(e => e.kind === 'sudden_topic_growth');
    assert.ok(growth);
    assert.match(growth!.summary, /surgiu do zero/);
  });

  test('tópico novo com < 5 menções → nada (evita ruído)', () => {
    const events = detectAnomalies({
      topics: [
        { topic: 'esporte', current: 2, baseline: 0 },
      ],
    });
    assert.equal(events.length, 0);
  });

  test('baseline null → sem output (não é insufficient_history explícito aqui)', () => {
    const events = detectAnomalies({
      topics: [
        { topic: 'x', current: 100, baseline: null },
      ],
    });
    assert.equal(events.length, 0);
  });
});

describe('AnomalyDetector — config override', () => {
  test('config custom afeta detecção', () => {
    const events = detectAnomalies({
      followers: { current: 12500, baseline: 12000 }, // ~4%
      config: { followerDeltaThreshold: 0.03 }, // threshold reduzido pra 3%
    });
    const spike = events.find(e => e.kind === 'follower_spike');
    assert.ok(spike, 'threshold 3% detecta 4%');
  });
});

describe('AnomalyDetector — API integrada', () => {
  test('roda todos os detectores em paralelo sem interferência', () => {
    const events = detectAnomalies({
      followers: { current: 20000, baseline: 12000 },
      engagement: {
        current: 5000, baseline: 1000,
        currentComments: 400, baselineComments: 100,
      },
      sentiment: {
        currentNegRatio: 0.5, baselineNegRatio: 0.2,
        currentClassifiedCount: 100, baselineClassifiedCount: 80,
      },
      currentPosts: [
        { externalId: 'p1', provider: 'x', engagement: 10, publishedAt: new Date() },
        { externalId: 'p2', provider: 'x', engagement: 8, publishedAt: new Date() },
        { externalId: 'p3', provider: 'x', engagement: 12, publishedAt: new Date() },
        { externalId: 'p4', provider: 'x', engagement: 9, publishedAt: new Date() },
        { externalId: 'p5', provider: 'x', engagement: 11, publishedAt: new Date() },
        { externalId: 'p6', provider: 'x', engagement: 500, publishedAt: new Date() },
      ],
      topics: [
        { topic: 'saude', current: 100, baseline: 30 },
      ],
    });
    // Espera pelo menos 5 tipos diferentes
    const kinds = new Set(events.map(e => e.kind));
    assert.ok(kinds.has('follower_spike'));
    assert.ok(kinds.has('engagement_spike'));
    assert.ok(kinds.has('comment_spike'));
    assert.ok(kinds.has('negative_sentiment_spike'));
    assert.ok(kinds.has('viral_post'));
    assert.ok(kinds.has('sudden_topic_growth'));
  });

  test('input vazio → array vazio (nada crasha)', () => {
    assert.deepEqual(detectAnomalies({}), []);
  });

  test('DEFAULT_ANOMALY_CONFIG é congelado', () => {
    assert.ok(Object.isFrozen(DEFAULT_ANOMALY_CONFIG));
  });
});
