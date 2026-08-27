/**
 * SocialSignalsPipeline — orquestração dos PRs 9-12 num único ponto de
 * entrada consumível pelo wiring (SocialIngestionService / cron jobs
 * do Pulso Digital).
 *
 * FLUXO (§39-§49):
 *
 *   inputs (por provider)
 *      ├── topicSeries[topic]  ─→  detectTrend × window  ─→  TrendResult[]
 *      └── snapshots           ─→  detectAnomalies       ─→  AnomalyEvent[]
 *                                        │
 *                                        ▼
 *              [ ProviderTopicTrend[] ]      [ ProviderAnomaly[] ]
 *                        │                            │
 *                        ▼                            ▼
 *              correlateNetworks              dedupAnomalies
 *                        │                            │
 *                        └───────────┬────────────────┘
 *                                    ▼
 *                        buildSignalsFrom* × 4
 *                                    ▼
 *                        SocialSignalBus (dedup + priority)
 *                                    ▼
 *                              list()  → SocialSignal[]
 *
 * REGRA §39: DETERMINÍSTICO. Módulo puro — nenhum I/O. Recebe dados já
 * agregados (posts/comments/followers já lidos do Supabase), roda a
 * cadeia inteira, devolve `SocialSignal[]` priorizado. Wiring com
 * SocialIngestionService fica pra PR seguinte.
 *
 * REGRA §45: `insufficient_history` de detectors internos vira nada no
 * bus (skip nos adapters). O consumer sabe: bus vazio ≠ ausência —
 * pode ser dados insuficientes.
 *
 * REGRA §42: hypotheses ficam em campo separado do summary. Cada signal
 * respeita isso — nunca merge factual+hipótese.
 *
 * O que este módulo NÃO faz:
 *   - Não classifica topics dos posts/comments (topicClassifier já foi).
 *   - Não lê Supabase (o wiring PR fará essa ponte).
 *   - Não persiste signals (in-memory only via bus).
 *   - Não dispara notificação (Slack/push). Isso é outra camada.
 *   - Não filtra por campanha — se você chamar duas vezes com dados
 *     de campanhas diferentes, misturam. Chame uma por campanha.
 */

import type { SocialProvider } from '../contracts/socialProvider.js';
import {
  detectTrend,
  type TrendResult,
  type TrendWindow,
  type TimestampedCount,
  type DetectTrendOptions,
} from './trendDetector.js';
import {
  detectAnomalies,
  type DetectAnomaliesInput,
  type FollowerSnapshot,
  type EngagementSnapshot,
  type SentimentSnapshot,
  type PostSnapshot,
  type TopicSnapshot,
  type AnomalyDetectorConfig,
} from './anomalyDetector.js';
import {
  correlateNetworks,
  dedupAnomalies,
  type ProviderTopicTrend,
  type ProviderAnomaly,
  type CorrelateNetworksOptions,
} from './crossNetworkCorrelator.js';
import {
  SocialSignalBus,
  buildSignalsFromTrends,
  buildSignalsFromAnomalies,
  buildSignalsFromCrossNetworkSignals,
  buildSignalsFromCrossNetworkAnomalies,
  type SocialSignal,
  type SignalBusOptions,
} from './socialSignalBus.js';

// ── Tipos ────────────────────────────────────────────────────────────

export interface ProviderInput {
  provider: SocialProvider;
  /**
   * Séries temporais por topic — usadas pelo TrendDetector. Chave é o
   * topic (§40); valor é a série ordenada ou não. Ausente / vazio →
   * nenhum trend calculado para esse provider.
   */
  topicSeries?: Record<string, TimestampedCount[]>;
  /** Snapshot pra detectAnomalies — todos os campos opcionais. */
  followers?: FollowerSnapshot;
  engagement?: EngagementSnapshot;
  sentiment?: SentimentSnapshot;
  currentPosts?: PostSnapshot[];
  /** Snapshots por topic pra detectTopicGrowth. */
  topicSnapshots?: TopicSnapshot[];
}

export interface PipelineInput {
  now: Date;
  /** Janelas para trend. Default: ['24h']. Passa múltiplas pra visão
   *  multi-window (o consumer filtra). */
  windows?: TrendWindow[];
  perProvider: ProviderInput[];
  anomalyConfig?: Partial<AnomalyDetectorConfig>;
  /** Opções extras pro detectTrend (minSamplesPerSide, groupByWeekday). */
  trendOptions?: Omit<DetectTrendOptions, 'now' | 'window' | 'series'>;
  correlateOptions?: CorrelateNetworksOptions;
  busOptions?: SignalBusOptions;
}

export interface PipelineResult {
  signals: SocialSignal[];
  /** Detalhes brutos — útil pra drill-down / debugging. Nunca substituem os signals. */
  raw: {
    trendsByProviderTopic: ProviderTopicTrend[];
    anomaliesByProvider: ProviderAnomaly[];
  };
  pipelineVersion: string;
}

export const SOCIAL_SIGNALS_PIPELINE_VERSION = '2026-08-27.v1';

const DEFAULT_WINDOWS: TrendWindow[] = ['24h'];

// ── Runner ──────────────────────────────────────────────────────────

export function runSocialSignalsPipeline(input: PipelineInput): PipelineResult {
  const windows = input.windows && input.windows.length > 0 ? input.windows : DEFAULT_WINDOWS;

  // 1. Trends per (provider, topic, window)
  const trendsByProviderTopic: ProviderTopicTrend[] = [];
  for (const p of input.perProvider) {
    if (!p.topicSeries) continue;
    for (const [topic, series] of Object.entries(p.topicSeries)) {
      for (const window of windows) {
        const trendResult: TrendResult = detectTrend({
          now: input.now,
          window,
          series,
          ...input.trendOptions,
        });
        trendsByProviderTopic.push({
          provider: p.provider,
          topic,
          trendResult,
        });
      }
    }
  }

  // 2. Anomalies per provider
  const anomaliesByProvider: ProviderAnomaly[] = [];
  for (const p of input.perProvider) {
    const detInput: DetectAnomaliesInput = {
      followers: p.followers,
      engagement: p.engagement,
      sentiment: p.sentiment,
      currentPosts: p.currentPosts,
      topics: p.topicSnapshots,
      config: input.anomalyConfig,
    };
    const events = detectAnomalies(detInput);
    for (const e of events) {
      anomaliesByProvider.push({
        provider: p.provider,
        anomaly: e,
        topic: (e.metadata as { topic?: string } | undefined)?.topic,
      });
    }
  }

  // 3. Cross-network correlation
  // correlateNetworks já respeita minConcurringNetworks (default 2).
  // dedupAnomalies não filtra — funde mesmo com 1 provider — então
  // filtramos aqui para manter simetria (nada "cross-network" com <2 redes).
  const crossNetworkSignals = correlateNetworks(trendsByProviderTopic, input.correlateOptions);
  const minCrossNetworks = input.correlateOptions?.minConcurringNetworks ?? 2;
  const crossNetworkAnomalies = dedupAnomalies(anomaliesByProvider)
    .filter(a => a.networks.length >= minCrossNetworks);

  // 4. Build signals from each source
  const emittedAt = input.now;

  const trendSignals = buildSignalsFromTrends(
    trendsByProviderTopic.map(t => ({
      provider: t.provider,
      topic: t.topic,
      trendResult: t.trendResult,
      emittedAt,
    })),
  );

  const anomalySignals = buildSignalsFromAnomalies(
    anomaliesByProvider.map(a => ({
      provider: a.provider,
      topic: a.topic,
      anomaly: a.anomaly,
      emittedAt,
    })),
  );

  const crossTrendSignals = buildSignalsFromCrossNetworkSignals(
    crossNetworkSignals.map(cs => ({ crossSignal: cs, emittedAt })),
  );

  const crossAnomalySignals = buildSignalsFromCrossNetworkAnomalies(
    crossNetworkAnomalies.map(ca => ({ crossAnomaly: ca, emittedAt })),
  );

  // 5. Feed into bus (dedup + priority sort)
  const bus = new SocialSignalBus(input.busOptions);
  bus.pushMany(trendSignals);
  bus.pushMany(anomalySignals);
  bus.pushMany(crossTrendSignals);
  bus.pushMany(crossAnomalySignals);

  return {
    signals: bus.list(),
    raw: { trendsByProviderTopic, anomaliesByProvider },
    pipelineVersion: SOCIAL_SIGNALS_PIPELINE_VERSION,
  };
}

/**
 * Conveniência: roda o pipeline e devolve APENAS `signals`. Consumers
 * que não precisam de drill-down pegam essa versão enxuta.
 */
export function runSocialSignalsPipelineFlat(input: PipelineInput): SocialSignal[] {
  return runSocialSignalsPipeline(input).signals;
}
