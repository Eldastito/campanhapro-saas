/**
 * SocialSignalBus — §48-§49 do PRD Social Intelligence.
 *
 * PROBLEMA (§48-§49): trends, anomalias e cross-network signals são
 * produzidos independentemente. UI, agents e alertas precisam de UMA
 * fila priorizada, deduplicada, com severity CONTEXTUAL (não só a
 * "significância interna" que o detector viu).
 *
 * SOLUÇÃO:
 *   1. `SocialSignal` normaliza cada evento vindo dos detectors
 *      (trend/anomaly/cross-network) num shape único.
 *   2. `SocialSignalBus` acumula sinais em memória, dedup por
 *      `dedupKey` (kind+topic+providers-set), priorityza por
 *      (severity → confidence → emittedAt DESC), expõe filtros
 *      `bySeverity`, `byTopic`, `byProvider`, `after(date)`.
 *   3. `buildSignalsFromTrends`, `buildSignalsFromAnomalies`,
 *      `buildSignalsFromCrossNetworkSignals`, `buildSignalsFromCrossNetworkAnomalies`
 *      são adapters puros — recebem outputs dos detectors, devolvem
 *      `SocialSignal[]`. Sem I/O. Sem IA.
 *
 * REGRA §39: DETERMINÍSTICO. Bus é lista em memória com sort estável;
 * severity contextual usa regras claras. IA entra depois só pra
 * ENRIQUECER hypotheses ou re-classificar em segundo plano.
 *
 * REGRA §42: severity nunca vira "verdade" — cada signal traz
 * `hypotheses[]` separado do `summary` factual. UI mostra os dois
 * distintamente.
 *
 * O que NÃO faz (fica pros próximos PRs):
 *   - Não persiste em Postgres (fica em memória do processo).
 *   - Não dispara notificação (Slack/email/push). Isso é outra camada.
 *   - Não faz roteamento por campanha (o consumer filtra por si).
 *   - Não aplica "contexto eleição" na severity — API para o consumer
 *     passar `contextBoost` mas o cálculo padrão é neutro.
 */

import type { TrendResult, TrendDirection } from './trendDetector.js';
import type { AnomalyEvent, AnomalyKind, AnomalySeverity } from './anomalyDetector.js';
import type {
  CrossNetworkSignal,
  CrossNetworkAnomaly,
  CorrelatedDirection,
  CorrelationConfidence,
} from './crossNetworkCorrelator.js';
import type { SocialProvider } from '../contracts/socialProvider.js';

// ── Tipos ────────────────────────────────────────────────────────────

/**
 * Fonte estrutural do sinal — indica qual detector o produziu.
 * O consumer usa pra decidir UI (badge, ícone) e drill-down.
 */
export type SocialSignalSource =
  | 'trend'
  | 'anomaly'
  | 'cross_network_trend'
  | 'cross_network_anomaly';

/**
 * Severity CONTEXTUAL do Signal Bus — quatro níveis. Diferente da
 * AnomalySeverity interna, que só vai até 'risk'; aqui existe 'crisis'
 * para a soma de fatores (cross-network + risk + alta confidence).
 *
 * Ordem: info < attention < risk < crisis.
 */
export type SocialSignalSeverity = 'info' | 'attention' | 'risk' | 'crisis';

export const SIGNAL_SEVERITY_ORDER: Record<SocialSignalSeverity, number> = Object.freeze({
  info: 0,
  attention: 1,
  risk: 2,
  crisis: 3,
});

export interface SocialSignal {
  /** Chave estável para dedup dentro do bus. Determinística por conteúdo. */
  dedupKey: string;
  source: SocialSignalSource;
  severity: SocialSignalSeverity;
  /** Sentença factual — nunca hipótese. §39. */
  summary: string;
  /** Lista de hipóteses; nunca afirmação. §42. */
  hypotheses: string[];
  /** Providers envolvidos. Sempre uma lista, mesmo com 1 rede. */
  providers: SocialProvider[];
  /** Topic quando aplicável (trends de topic, sudden_topic_growth). */
  topic?: string;
  /** Confidence 0-1. */
  confidence: number;
  /** Quando o sinal foi produzido. */
  emittedAt: Date;
  /** Payload opaco — o consumer que sabe o shape por source. */
  payload:
    | { kind: 'trend'; result: TrendResult }
    | { kind: 'anomaly'; event: AnomalyEvent }
    | { kind: 'cross_network_trend'; signal: CrossNetworkSignal }
    | { kind: 'cross_network_anomaly'; anomaly: CrossNetworkAnomaly };
  busVersion: string;
}

export const SOCIAL_SIGNAL_BUS_VERSION = '2026-08-27.v1';

// ── Severity mapping ────────────────────────────────────────────────

/**
 * Regras de mapeamento — determinísticas, ordem importa.
 *
 * Trend puro (1 rede):
 *   - state='insufficient_history' → não gera signal (nunca).
 *   - state='stable_no_signal'     → 'info' se |delta|>0 senão skip.
 *   - state='trend' + |delta|>=0.5 → 'attention'
 *   - state='trend' + |delta|>=0.2 → 'info'
 *   - state='trend' + |delta|<0.2  → 'info'
 *
 * Anomaly:
 *   - 'info'      → 'info'
 *   - 'attention' → 'attention'
 *   - 'risk'      → 'risk'
 *   Se confidence>=0.85 e severity=='risk', ELEVA pra 'crisis' quando
 *   for do tipo follower_drop OU comment_spike (indicadores mais fortes
 *   de crise real, conforme §44).
 *
 * Cross-network trend:
 *   - confidence='high' + direction='falling' + agree>=3 → 'risk'
 *   - confidence='high'                                   → 'attention'
 *   - direction='divergent'                               → 'attention'
 *   - confidence='medium'                                  → 'info'
 *   - senão                                                → 'info'
 *
 * Cross-network anomaly (via dedupAnomalies):
 *   - severity='risk'      + networks.length>=3 → 'crisis'
 *   - severity='risk'                            → 'risk'
 *   - severity='attention' + networks.length>=3 → 'risk'
 *   - severity='attention'                       → 'attention'
 *   - severity='info'                             → 'info'
 */

function trendSeverity(t: TrendResult): SocialSignalSeverity | 'skip' {
  if (t.state === 'insufficient_history') return 'skip';
  if (t.state === 'stable_no_signal') return 'skip';
  // state === 'trend'
  const abs = t.deltaPct === null ? 1 : Math.abs(t.deltaPct);
  if (abs >= 0.5) return 'attention';
  return 'info';
}

function anomalySeverity(a: AnomalyEvent): SocialSignalSeverity | 'skip' {
  if (a.state === 'insufficient_history') return 'skip';
  const base: SocialSignalSeverity = a.severity;
  if (base === 'risk' && a.confidence >= 0.85
    && (a.kind === 'follower_drop' || a.kind === 'comment_spike')) {
    return 'crisis';
  }
  return base;
}

function crossNetworkTrendSeverity(s: CrossNetworkSignal): SocialSignalSeverity {
  if (s.confidence === 'high' && s.direction === 'falling' && s.networks.length >= 3) {
    return 'risk';
  }
  if (s.confidence === 'high') return 'attention';
  if (s.direction === 'divergent') return 'attention';
  return 'info';
}

function crossNetworkAnomalySeverity(a: CrossNetworkAnomaly): SocialSignalSeverity {
  const sev = a.severity;
  const wide = a.networks.length >= 3;
  if (sev === 'risk' && wide) return 'crisis';
  if (sev === 'risk') return 'risk';
  if (sev === 'attention' && wide) return 'risk';
  if (sev === 'attention') return 'attention';
  return 'info';
}

// ── Builders (adapters) ─────────────────────────────────────────────

export interface BuildTrendSignalInput {
  provider: SocialProvider;
  topic: string;
  trendResult: TrendResult;
  emittedAt: Date;
}

/**
 * Converte trends individuais em signals. Sinais em
 * `insufficient_history` ou `stable_no_signal` viram NADA — o bus não
 * é lugar de "não achei nada".
 */
export function buildSignalsFromTrends(inputs: BuildTrendSignalInput[]): SocialSignal[] {
  const out: SocialSignal[] = [];
  for (const inp of inputs) {
    const sev = trendSeverity(inp.trendResult);
    if (sev === 'skip') continue;
    const direction: TrendDirection = inp.trendResult.direction;
    const deltaLabel = inp.trendResult.deltaPct === null
      ? 'sem baseline'
      : `${(inp.trendResult.deltaPct * 100).toFixed(1)}%`;
    out.push({
      dedupKey: `trend::${inp.provider}::${inp.topic}::${inp.trendResult.window}::${direction}`,
      source: 'trend',
      severity: sev,
      summary: `[${inp.provider}] ${inp.topic}: ${direction} (${deltaLabel}) na janela ${inp.trendResult.window}`,
      hypotheses: [],
      providers: [inp.provider],
      topic: inp.topic,
      confidence: inp.trendResult.confidence,
      emittedAt: inp.emittedAt,
      payload: { kind: 'trend', result: inp.trendResult },
      busVersion: SOCIAL_SIGNAL_BUS_VERSION,
    });
  }
  return out;
}

export interface BuildAnomalySignalInput {
  provider: SocialProvider;
  topic?: string;
  anomaly: AnomalyEvent;
  emittedAt: Date;
}

export function buildSignalsFromAnomalies(inputs: BuildAnomalySignalInput[]): SocialSignal[] {
  const out: SocialSignal[] = [];
  for (const inp of inputs) {
    const sev = anomalySeverity(inp.anomaly);
    if (sev === 'skip') continue;
    const topic = inp.topic ?? (inp.anomaly.metadata as { topic?: string } | undefined)?.topic;
    const topicPart = topic ? `::${topic}` : '';
    out.push({
      dedupKey: `anomaly::${inp.anomaly.kind}::${inp.provider}${topicPart}`,
      source: 'anomaly',
      severity: sev,
      summary: `[${inp.provider}] ${inp.anomaly.kind}: ${inp.anomaly.summary}`,
      hypotheses: inp.anomaly.hypotheses,
      providers: [inp.provider],
      topic,
      confidence: inp.anomaly.confidence,
      emittedAt: inp.emittedAt,
      payload: { kind: 'anomaly', event: inp.anomaly },
      busVersion: SOCIAL_SIGNAL_BUS_VERSION,
    });
  }
  return out;
}

const CONFIDENCE_FLOOR_BY_CROSS: Record<CorrelationConfidence, number> = Object.freeze({
  low: 0.4,
  medium: 0.6,
  high: 0.8,
});

export interface BuildCrossNetworkTrendSignalInput {
  crossSignal: CrossNetworkSignal;
  emittedAt: Date;
}

export function buildSignalsFromCrossNetworkSignals(
  inputs: BuildCrossNetworkTrendSignalInput[],
): SocialSignal[] {
  const out: SocialSignal[] = [];
  for (const { crossSignal: s, emittedAt } of inputs) {
    const sev = crossNetworkTrendSeverity(s);
    const providersSorted = [...s.networks].sort();
    const netCount = s.networks.length;
    const divergentPart = s.networksDivergent.length > 0
      ? ` — ${s.networksDivergent.length} rede(s) em direção oposta`
      : '';
    const dir: CorrelatedDirection = s.direction;
    out.push({
      dedupKey: `x_trend::${s.topic}::${dir}::${providersSorted.join(',')}`,
      source: 'cross_network_trend',
      severity: sev,
      summary: `Cross-network: ${s.topic} ${dir} em ${netCount} rede(s)${divergentPart}`,
      hypotheses: [],
      providers: providersSorted,
      topic: s.topic,
      confidence: CONFIDENCE_FLOOR_BY_CROSS[s.confidence],
      emittedAt,
      payload: { kind: 'cross_network_trend', signal: s },
      busVersion: SOCIAL_SIGNAL_BUS_VERSION,
    });
  }
  return out;
}

export interface BuildCrossNetworkAnomalySignalInput {
  crossAnomaly: CrossNetworkAnomaly;
  emittedAt: Date;
}

export function buildSignalsFromCrossNetworkAnomalies(
  inputs: BuildCrossNetworkAnomalySignalInput[],
): SocialSignal[] {
  const out: SocialSignal[] = [];
  for (const { crossAnomaly: a, emittedAt } of inputs) {
    const sev = crossNetworkAnomalySeverity(a);
    const providersSorted = [...a.networks].sort();
    const topicPart = a.topic ? `::${a.topic}` : '';
    out.push({
      dedupKey: `x_anomaly::${a.kind}${topicPart}::${providersSorted.join(',')}`,
      source: 'cross_network_anomaly',
      severity: sev,
      summary: `Cross-network anomaly: ${a.kind} em ${a.networks.length} rede(s)${a.topic ? ` — topic: ${a.topic}` : ''}`,
      hypotheses: a.hypotheses,
      providers: providersSorted,
      topic: a.topic,
      confidence: a.confidence,
      emittedAt,
      payload: { kind: 'cross_network_anomaly', anomaly: a },
      busVersion: SOCIAL_SIGNAL_BUS_VERSION,
    });
  }
  return out;
}

// ── Bus ─────────────────────────────────────────────────────────────

export interface SignalBusOptions {
  /** Se true, ao dedup mantém o de MAIOR severity. Default true. */
  keepHigherSeverity?: boolean;
}

/**
 * Bus em memória. Não é EventEmitter — é uma coleção priorizada.
 * Consumers pedem `list()` ou variantes filtradas. Persistência e
 * pub-sub push ficam pros PRs seguintes.
 */
export class SocialSignalBus {
  private signals = new Map<string, SocialSignal>();
  private readonly opts: Required<SignalBusOptions>;

  constructor(opts: SignalBusOptions = {}) {
    this.opts = {
      keepHigherSeverity: opts.keepHigherSeverity ?? true,
    };
  }

  /**
   * Empurra um sinal. Se `dedupKey` já existe:
   *   - keepHigherSeverity=true (default) → só substitui se o novo é
   *     de severity maior OU (mesma severity E emittedAt mais recente).
   *   - keepHigherSeverity=false → sempre substitui.
   */
  push(signal: SocialSignal): void {
    const existing = this.signals.get(signal.dedupKey);
    if (!existing) {
      this.signals.set(signal.dedupKey, signal);
      return;
    }
    if (!this.opts.keepHigherSeverity) {
      this.signals.set(signal.dedupKey, signal);
      return;
    }
    const existingRank = SIGNAL_SEVERITY_ORDER[existing.severity];
    const incomingRank = SIGNAL_SEVERITY_ORDER[signal.severity];
    if (incomingRank > existingRank) {
      this.signals.set(signal.dedupKey, signal);
    } else if (incomingRank === existingRank && signal.emittedAt >= existing.emittedAt) {
      this.signals.set(signal.dedupKey, signal);
    }
    // else: keep existing.
  }

  pushMany(signals: SocialSignal[]): void {
    for (const s of signals) this.push(s);
  }

  /**
   * Retorna todos os signals, priorizados:
   *   severity DESC → confidence DESC → emittedAt DESC.
   * Sort estável — Array.prototype.sort no Node é estável (V8 TimSort).
   */
  list(): SocialSignal[] {
    return [...this.signals.values()].sort((a, b) => {
      const s = SIGNAL_SEVERITY_ORDER[b.severity] - SIGNAL_SEVERITY_ORDER[a.severity];
      if (s !== 0) return s;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.emittedAt.getTime() - a.emittedAt.getTime();
    });
  }

  bySeverity(severity: SocialSignalSeverity): SocialSignal[] {
    return this.list().filter(s => s.severity === severity);
  }

  atLeastSeverity(severity: SocialSignalSeverity): SocialSignal[] {
    const min = SIGNAL_SEVERITY_ORDER[severity];
    return this.list().filter(s => SIGNAL_SEVERITY_ORDER[s.severity] >= min);
  }

  byTopic(topic: string): SocialSignal[] {
    return this.list().filter(s => s.topic === topic);
  }

  byProvider(provider: SocialProvider): SocialSignal[] {
    return this.list().filter(s => s.providers.includes(provider));
  }

  bySource(source: SocialSignalSource): SocialSignal[] {
    return this.list().filter(s => s.source === source);
  }

  after(date: Date): SocialSignal[] {
    return this.list().filter(s => s.emittedAt >= date);
  }

  size(): number {
    return this.signals.size;
  }

  clear(): void {
    this.signals.clear();
  }
}

// ── Exports pra consumer inspecionar dedup manualmente ──────────────

export const SIGNAL_SEVERITY_HELPERS = Object.freeze({
  /**
   * Compara duas severities: retorna >0 se `a` mais severa, <0 se `b`,
   * 0 se iguais.
   */
  compare(a: SocialSignalSeverity, b: SocialSignalSeverity): number {
    return SIGNAL_SEVERITY_ORDER[a] - SIGNAL_SEVERITY_ORDER[b];
  },
  isAtLeast(candidate: SocialSignalSeverity, floor: SocialSignalSeverity): boolean {
    return SIGNAL_SEVERITY_ORDER[candidate] >= SIGNAL_SEVERITY_ORDER[floor];
  },
});

// Re-export para caller que já usa a AnomalySeverity — descobrir tipagens.
export type { AnomalyKind, AnomalySeverity };
