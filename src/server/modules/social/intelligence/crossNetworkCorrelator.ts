/**
 * CrossNetworkCorrelator — §46-§47 do PRD Social Intelligence.
 *
 * PROBLEMA (§47): "Um mesmo assunto em quatro redes NÃO deve produzir
 * quatro crises. Correlacionar antes."
 *
 * SOLUÇÃO (§46): agregar sinais individuais por (provider, topic) em
 * um único CrossNetworkSignal quando a mesma direção aparece em N+
 * redes. Confidence sobe com o número de redes concordantes.
 *
 * REGRA §39 aplicada: determinístico. Sem IA. Sem magia. Só:
 *   1. Agrupar entradas por topic
 *   2. Contar direções (rising/falling/stable)
 *   3. Se maioria clara → emitir signal
 *   4. Se divergência (X redes rising, Y redes falling com Y>=1) →
 *      marcar direction='divergent' (sinal interessante SEPARADO —
 *      "algumas redes reagem, outras não")
 *   5. Redes com insufficient_history são registradas mas não contam
 *      pra decisão
 *
 * Este módulo é PURO — recebe entradas normalizadas, devolve signals.
 * Não faz I/O. Consumers (SocialIngestionService, Pulso Digital) plugam
 * saída em signal bus ou UI.
 */

import type { TrendResult, TrendDirection } from './trendDetector.js';
import type { AnomalyEvent, AnomalyKind } from './anomalyDetector.js';
import type { SocialProvider } from '../contracts/socialProvider.js';

// ── Correlator de trends ────────────────────────────────────────────

export type CorrelatedDirection = 'rising' | 'falling' | 'divergent' | 'stable';

export type CorrelationConfidence = 'low' | 'medium' | 'high';

export interface ProviderTopicTrend {
  provider: SocialProvider;
  topic: string;
  trendResult: TrendResult;
}

export interface CrossNetworkSignal {
  topic: string;
  direction: CorrelatedDirection;
  /** Redes que concordaram com a direction principal. */
  networks: SocialProvider[];
  /** Redes com insufficient_history — não contam pra decisão. */
  networksInsufficient: SocialProvider[];
  /** Redes que discordaram (direção oposta). Não-vazia → divergent. */
  networksDivergent: SocialProvider[];
  confidence: CorrelationConfidence;
  /** Média dos deltaPct das redes que concordaram. null se todas tem deltaPct=null. */
  averageDelta: number | null;
  /** Detalhes por rede — útil pro drill-down §58. */
  perProvider: Array<{
    provider: SocialProvider;
    direction: TrendDirection;
    state: TrendResult['state'];
    deltaPct: number | null;
  }>;
  correlatorVersion: string;
}

export const CROSS_NETWORK_CORRELATOR_VERSION = '2026-08-27.v1';

export interface CorrelateNetworksOptions {
  /** Mínimo de redes concordantes para emitir signal. Default: 2. */
  minConcurringNetworks?: number;
  /** Alta confiança se >= este número de redes concordam. Default: 4. */
  highConfidenceThreshold?: number;
  /** Confiança média se >= este número. Default: 3. */
  mediumConfidenceThreshold?: number;
}

const DEFAULT_OPTS: Required<CorrelateNetworksOptions> = Object.freeze({
  minConcurringNetworks: 2,
  highConfidenceThreshold: 4,
  mediumConfidenceThreshold: 3,
});

function computeConfidence(
  agreeCount: number,
  opts: Required<CorrelateNetworksOptions>,
): CorrelationConfidence {
  if (agreeCount >= opts.highConfidenceThreshold) return 'high';
  if (agreeCount >= opts.mediumConfidenceThreshold) return 'medium';
  return 'low';
}

/**
 * Correlaciona uma matriz de (provider, topic, trend) em signals
 * cross-network. Cada topic vira 0 ou 1 CrossNetworkSignal.
 */
export function correlateNetworks(
  entries: ProviderTopicTrend[],
  options: CorrelateNetworksOptions = {},
): CrossNetworkSignal[] {
  const opts = { ...DEFAULT_OPTS, ...options };

  // Group by topic
  const byTopic = new Map<string, ProviderTopicTrend[]>();
  for (const e of entries) {
    const arr = byTopic.get(e.topic) ?? [];
    arr.push(e);
    byTopic.set(e.topic, arr);
  }

  const signals: CrossNetworkSignal[] = [];

  for (const [topic, list] of byTopic) {
    // Buckets
    const rising: ProviderTopicTrend[] = [];
    const falling: ProviderTopicTrend[] = [];
    const stable: ProviderTopicTrend[] = [];
    const insufficient: ProviderTopicTrend[] = [];

    for (const e of list) {
      if (e.trendResult.state === 'insufficient_history') {
        insufficient.push(e);
        continue;
      }
      if (e.trendResult.state === 'stable_no_signal') {
        stable.push(e);
        continue;
      }
      // state === 'trend'
      if (e.trendResult.direction === 'rising') rising.push(e);
      else if (e.trendResult.direction === 'falling') falling.push(e);
      else stable.push(e);
    }

    const totalActive = rising.length + falling.length;
    if (totalActive < opts.minConcurringNetworks) continue;

    // Se há dominância clara (>= min em uma direção E outra direção < min-1)
    let winner: 'rising' | 'falling' | null = null;
    let winnerList: ProviderTopicTrend[] = [];
    let loserList: ProviderTopicTrend[] = [];

    if (rising.length >= opts.minConcurringNetworks && falling.length === 0) {
      winner = 'rising';
      winnerList = rising;
    } else if (falling.length >= opts.minConcurringNetworks && rising.length === 0) {
      winner = 'falling';
      winnerList = falling;
    } else if (rising.length >= opts.minConcurringNetworks && falling.length >= 1) {
      winner = 'rising';
      winnerList = rising;
      loserList = falling;
    } else if (falling.length >= opts.minConcurringNetworks && rising.length >= 1) {
      winner = 'falling';
      winnerList = falling;
      loserList = rising;
    } else {
      // Nem rising nem falling alcançou o mínimo → skip
      continue;
    }

    const direction: CorrelatedDirection = loserList.length > 0 ? 'divergent' : winner;

    // Average delta dos que concordaram (ignora null)
    const deltas = winnerList
      .map(e => e.trendResult.deltaPct)
      .filter((d): d is number => d !== null);
    const averageDelta = deltas.length > 0
      ? deltas.reduce((s, d) => s + d, 0) / deltas.length
      : null;

    signals.push({
      topic,
      direction,
      networks: winnerList.map(e => e.provider),
      networksInsufficient: insufficient.map(e => e.provider),
      networksDivergent: loserList.map(e => e.provider),
      confidence: computeConfidence(winnerList.length, opts),
      averageDelta,
      perProvider: list.map(e => ({
        provider: e.provider,
        direction: e.trendResult.direction,
        state: e.trendResult.state,
        deltaPct: e.trendResult.deltaPct,
      })),
      correlatorVersion: CROSS_NETWORK_CORRELATOR_VERSION,
    });
  }

  return signals;
}

// ── Dedup de anomalias (§47) ────────────────────────────────────────

export interface ProviderAnomaly {
  provider: SocialProvider;
  anomaly: AnomalyEvent;
  /** Topic associado, se aplicável — sudden_topic_growth traz no metadata.topic;
   *  os demais podem passar undefined ou o provider mesmo. */
  topic?: string;
}

export interface CrossNetworkAnomaly {
  kind: AnomalyKind;
  /** Topic quando aplicável (sudden_topic_growth). */
  topic?: string;
  /** Todas as redes onde a anomalia foi detectada. */
  networks: SocialProvider[];
  /** Severity mais alta entre as ocorrências. */
  severity: AnomalyEvent['severity'];
  /** Todos os summaries — permite drill-down. */
  summaries: Array<{ provider: SocialProvider; summary: string }>;
  /** Hipóteses UNIONIZADAS (deduplicadas). */
  hypotheses: string[];
  /** Confidence média das ocorrências. */
  confidence: number;
  /** Quantas ocorrências foram fundidas neste sinal. */
  occurrences: number;
  correlatorVersion: string;
}

const SEVERITY_ORDER = { info: 0, attention: 1, risk: 2 } as const;

/**
 * §47: dedup de anomalias por (kind, topic). Uma mesma anomalia detectada
 * em 4 redes vira 1 CrossNetworkAnomaly com networks=[4] — nunca 4
 * alertas duplicados no signal bus.
 *
 * Ignora anomalias em state='insufficient_history' — elas viram parte de
 * um "monitoring" separado (fora do escopo aqui).
 */
export function dedupAnomalies(input: ProviderAnomaly[]): CrossNetworkAnomaly[] {
  // Chave: kind + topic (topic undefined → só kind)
  const buckets = new Map<string, ProviderAnomaly[]>();

  for (const pa of input) {
    if (pa.anomaly.state === 'insufficient_history') continue;
    const topic = pa.topic ?? (pa.anomaly.metadata as any)?.topic;
    const key = topic ? `${pa.anomaly.kind}::${topic}` : pa.anomaly.kind;
    const arr = buckets.get(key) ?? [];
    arr.push({ ...pa, topic });
    buckets.set(key, arr);
  }

  const result: CrossNetworkAnomaly[] = [];

  for (const [_key, list] of buckets) {
    // Severity mais alta
    const severities = list.map(x => x.anomaly.severity);
    const maxSev = severities.reduce<AnomalyEvent['severity']>((max, s) => {
      return SEVERITY_ORDER[s] > SEVERITY_ORDER[max] ? s : max;
    }, 'info');

    // Union de hypotheses (dedup)
    const hypSet = new Set<string>();
    for (const x of list) for (const h of x.anomaly.hypotheses) hypSet.add(h);

    // Confidence média
    const avgConf = list.reduce((s, x) => s + x.anomaly.confidence, 0) / list.length;

    result.push({
      kind: list[0].anomaly.kind,
      topic: list[0].topic,
      networks: list.map(x => x.provider),
      severity: maxSev,
      summaries: list.map(x => ({ provider: x.provider, summary: x.anomaly.summary })),
      hypotheses: [...hypSet],
      confidence: avgConf,
      occurrences: list.length,
      correlatorVersion: CROSS_NETWORK_CORRELATOR_VERSION,
    });
  }

  return result;
}
