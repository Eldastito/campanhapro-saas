/**
 * socialSignalStore — persistência de `SocialSignal[]` no Postgres.
 *
 * `SocialSignalsPipeline` (PR 13) devolve signals in-memory. Este módulo
 * grava esses signals na tabela `social_signals` (migration
 * 20260827020000) e expõe leitura filtrada para o Pulso Digital
 * (§53-§59), notificações, e relatórios históricos.
 *
 * IDEMPOTÊNCIA (§34 aplicado a signals): upsert por
 * UNIQUE(campaignId, dedupKey). Rodar o pipeline 2× consecutivamente
 * atualiza o mesmo signal (severity, confidence, payload podem
 * mudar entre runs conforme mais dados entram), NÃO cria duplicata.
 *
 * ISOLAMENTO POR CAMPANHA (§35): `campaignId` sempre no top-level +
 * usado como filtro OBRIGATÓRIO em toda leitura. RLS na tabela reforça
 * do lado do banco.
 *
 * REGRA §42 preservada: `hypotheses` fica em coluna separada de
 * `summary`. Nada de fundir na hora de gravar.
 *
 * Este módulo NÃO:
 *   - Roda o pipeline (isso é responsabilidade do socialSignalsRunner)
 *   - Notifica (Slack/email/push) — próxima camada
 *   - Faz broadcast realtime — o gatilho pode ser Postgres NOTIFY
 *     dentro do socialSignalsRunner com persist=true (fica pra PR
 *     futuro se necessário)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SocialProvider } from './contracts/socialProvider.js';
import type {
  SocialSignal,
  SocialSignalSource,
  SocialSignalSeverity,
} from './intelligence/socialSignalBus.js';
import { SIGNAL_SEVERITY_ORDER } from './intelligence/socialSignalBus.js';

// ── Tipos ────────────────────────────────────────────────────────────

export interface StoredSocialSignal {
  id: string;
  campaignId: string;
  dedupKey: string;
  source: SocialSignalSource;
  severity: SocialSignalSeverity;
  summary: string;
  hypotheses: string[];
  providers: SocialProvider[];
  topic: string | null;
  confidence: number;
  emittedAt: string;
  /** JSON opaco com o SocialSignal.payload original. */
  payload: Record<string, unknown>;
  busVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistSignalsResult {
  attempted: number;
  written: number;
  reason: 'ok' | 'error';
  errorMessage?: string;
}

export interface QuerySignalsParams {
  /** Filtro por severity mínima (info < attention < risk < crisis).
   *  Ex.: 'risk' → só risk e crisis. */
  minSeverity?: SocialSignalSeverity;
  source?: SocialSignalSource;
  topic?: string;
  provider?: SocialProvider;
  since?: Date;
  limit?: number;
}

// ── Serialização ────────────────────────────────────────────────────

/**
 * Converte `SocialSignal` do runtime pra row insertável. Timestamps
 * viram ISO, providers vira array simples pro jsonb.
 */
function signalToRow(campaignId: string, s: SocialSignal): Record<string, unknown> {
  return {
    campaignId,
    dedupKey: s.dedupKey,
    source: s.source,
    severity: s.severity,
    summary: s.summary,
    hypotheses: s.hypotheses,
    providers: s.providers,
    topic: s.topic ?? null,
    confidence: s.confidence,
    emittedAt: s.emittedAt.toISOString(),
    payload: s.payload,
    busVersion: s.busVersion,
    updatedAt: new Date().toISOString(),
  };
}

// ── API pública ─────────────────────────────────────────────────────

/**
 * Grava (upsert) uma lista de signals. Idempotente por
 * UNIQUE(campaignId, dedupKey). Lista vazia devolve `written: 0` sem
 * chamar Supabase.
 */
export async function persistSignals(
  supabase: SupabaseClient,
  campaignId: string,
  signals: SocialSignal[],
): Promise<PersistSignalsResult> {
  if (!campaignId) throw new Error('persistSignals: campaignId obrigatório');
  if (!signals.length) return { attempted: 0, written: 0, reason: 'ok' };

  const rows = signals.map(s => signalToRow(campaignId, s));
  const { error } = await supabase
    .from('social_signals')
    .upsert(rows, { onConflict: 'campaignId,dedupKey' });

  if (error) {
    return {
      attempted: signals.length,
      written: 0,
      reason: 'error',
      errorMessage: `upsert failed: ${error.message}`,
    };
  }
  return { attempted: signals.length, written: signals.length, reason: 'ok' };
}

/**
 * Lê signals de UMA campanha. Todos os filtros são opcionais; sem
 * filtros devolve os N (default 100) mais recentes.
 *
 * `minSeverity` filtra >= no rank (info=0, attention=1, risk=2, crisis=3);
 * feito em memória pra não amarrar a schema em nível SQL. Como a fila
 * é ordenada por emittedAt DESC e cortada em `limit`, isso pode reduzir
 * o resultado abaixo de `limit` — comportamento intencional; o consumer
 * paginará se precisar.
 */
export async function querySignals(
  supabase: SupabaseClient,
  campaignId: string,
  params: QuerySignalsParams = {},
): Promise<StoredSocialSignal[]> {
  if (!campaignId) throw new Error('querySignals: campaignId obrigatório');

  let q = supabase
    .from('social_signals')
    .select('*')
    .eq('campaignId', campaignId)
    .order('emittedAt', { ascending: false })
    .limit(params.limit ?? 100);

  if (params.source) q = q.eq('source', params.source);
  if (params.topic) q = q.eq('topic', params.topic);
  if (params.since) q = q.gte('emittedAt', params.since.toISOString());

  const { data, error } = await q;
  if (error) throw new Error(`querySignals failed: ${error.message}`);
  const rows = (data ?? []) as StoredSocialSignal[];

  let filtered = rows;
  if (params.minSeverity) {
    const floor = SIGNAL_SEVERITY_ORDER[params.minSeverity];
    filtered = filtered.filter(r => SIGNAL_SEVERITY_ORDER[r.severity] >= floor);
  }
  if (params.provider) {
    const p = params.provider;
    filtered = filtered.filter(r => Array.isArray(r.providers) && r.providers.includes(p));
  }
  return filtered;
}

// ── Stats agregado ─────────────────────────────────────────────────

export interface SignalStatsParams {
  /** ISO ou Date. Sinais com `emittedAt >= since` entram na contagem.
   *  Default: 7 dias atrás. */
  since?: Date;
  /** ISO ou Date. Sinais com `emittedAt < until` entram na contagem.
   *  Default: agora. */
  until?: Date;
  /**
   * Se 'day', o resultado inclui `byDay`: um bucket por dia UTC no
   * intervalo, com counts totais + por severity. Undefined pra pular
   * o overhead quando o consumer só quer os agregados totais.
   */
  bucket?: 'day';
}

export interface SignalDayBucket {
  /** yyyy-mm-dd em UTC. */
  date: string;
  total: number;
  crisis: number;
  risk: number;
  attention: number;
  info: number;
}

export interface SignalStats {
  total: number;
  sinceDate: string;
  untilDate: string;
  bySeverity: Record<SocialSignalSeverity, number>;
  bySource: Record<SocialSignalSource, number>;
  /** Contagem por topic. Chave `null` (literal string "__null__") pra
   *  signals sem topic — evita ambiguidade JSON. */
  byTopic: Record<string, number>;
  /** Contagem por provider. Signals com N providers contam N vezes
   *  (um por provider). */
  byProvider: Record<SocialProvider, number>;
  /**
   * Presente quando `params.bucket === 'day'`. Um bucket por dia UTC no
   * intervalo, ordenado ASC. Dias sem signals aparecem com counts=0
   * (importante pra sparkline não pular no eixo X).
   */
  byDay?: SignalDayBucket[];
}

const ZERO_BY_SEVERITY: Record<SocialSignalSeverity, number> = {
  info: 0, attention: 0, risk: 0, crisis: 0,
};

const ZERO_BY_SOURCE: Record<SocialSignalSource, number> = {
  trend: 0, anomaly: 0, cross_network_trend: 0, cross_network_anomaly: 0,
};

const ZERO_BY_PROVIDER: Record<SocialProvider, number> = {
  instagram: 0, facebook: 0, youtube: 0, tiktok: 0, x: 0, linkedin: 0, kwai: 0,
};

const DEFAULT_STATS_SINCE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Agrega counts de sinais no intervalo [since, until). Consumido pelo
 * dashboard de resumo (widget na home) e por relatórios semanais.
 *
 * Isolamento §35: filtra por `campaignId` em TODA query. RLS reforça.
 *
 * Provider counting: signals com N providers contam N vezes (um por
 * provider). Isso reflete "presença por rede" — mais útil pra relatório
 * do que "quantidade única de signals".
 *
 * Topics sem valor → agregados em `"__null__"` (chave literal). Evita
 * ambiguidade com `"null"` textual.
 */
export async function getSignalStats(
  supabase: SupabaseClient,
  campaignId: string,
  params: SignalStatsParams = {},
): Promise<SignalStats> {
  if (!campaignId) throw new Error('getSignalStats: campaignId obrigatório');

  const until = params.until ?? new Date();
  const since = params.since ?? new Date(until.getTime() - DEFAULT_STATS_SINCE_MS);

  // Se o consumer pediu bucket=day, precisamos do emittedAt pra rotular
  // cada row. Sem bucket, o SELECT fica minimalista.
  const selectCols = params.bucket === 'day'
    ? 'severity, source, topic, providers, emittedAt'
    : 'severity, source, topic, providers';

  // Puxa TODOS os signals do intervalo. Poderíamos usar aggregate SQL
  // (COUNT(*) GROUP BY ...) mas o volume esperado (<1000/campanha/semana)
  // torna o roundtrip menor que compilar SQL agregado no PostgREST.
  const { data, error } = await supabase
    .from('social_signals')
    .select(selectCols)
    .eq('campaignId', campaignId)
    .gte('emittedAt', since.toISOString())
    .lt('emittedAt', until.toISOString());

  if (error) throw new Error(`getSignalStats failed: ${error.message}`);

  const rows = ((data ?? []) as unknown) as Array<{
    severity: SocialSignalSeverity;
    source: SocialSignalSource;
    topic: string | null;
    providers: SocialProvider[] | null;
    emittedAt?: string;
  }>;

  const bySeverity: Record<SocialSignalSeverity, number> = { ...ZERO_BY_SEVERITY };
  const bySource: Record<SocialSignalSource, number> = { ...ZERO_BY_SOURCE };
  const byTopic: Record<string, number> = {};
  const byProvider: Record<SocialProvider, number> = { ...ZERO_BY_PROVIDER };

  for (const r of rows) {
    if (r.severity in bySeverity) bySeverity[r.severity] += 1;
    if (r.source in bySource) bySource[r.source] += 1;
    const topicKey = r.topic ?? '__null__';
    byTopic[topicKey] = (byTopic[topicKey] ?? 0) + 1;
    if (Array.isArray(r.providers)) {
      for (const p of r.providers) {
        if (p in byProvider) byProvider[p] += 1;
      }
    }
  }

  const result: SignalStats = {
    total: rows.length,
    sinceDate: since.toISOString(),
    untilDate: until.toISOString(),
    bySeverity,
    bySource,
    byTopic,
    byProvider,
  };

  if (params.bucket === 'day') {
    result.byDay = buildDayBuckets(rows, since, until);
  }

  return result;
}

// ── Day bucket helpers ─────────────────────────────────────────────

/** yyyy-mm-dd em UTC — chave estável pra bucket + eixo X. */
function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Enumera todos os dias UTC no intervalo [since, until) e agrega counts
 * por severity por dia. Dias vazios ficam com counts=0 pra não haver
 * gap no eixo X do sparkline.
 *
 * Iteração no dia UTC do `since` até (mas não incluindo) o dia UTC de
 * `until`. Se `until` cai no meio de um dia, esse dia entra (porque
 * cai no [since, until) até o instante de until, e os signals daquele
 * dia foram carregados até esse instante).
 */
function buildDayBuckets(
  rows: Array<{ severity: SocialSignalSeverity; emittedAt?: string }>,
  since: Date,
  until: Date,
): SignalDayBucket[] {
  const buckets = new Map<string, SignalDayBucket>();

  // Pré-popula todos os dias do intervalo — evita gap
  const cursor = new Date(Date.UTC(
    since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate(),
  ));
  const untilDayMs = Date.UTC(
    until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate(),
  );
  // Includes the day of `until` when until has any time > 00:00 UTC
  const endMs = until.getUTCHours() === 0 && until.getUTCMinutes() === 0
    && until.getUTCSeconds() === 0 && until.getUTCMilliseconds() === 0
    ? untilDayMs
    : untilDayMs + 24 * 60 * 60 * 1000;

  while (cursor.getTime() < endMs) {
    const key = utcDateKey(cursor);
    buckets.set(key, {
      date: key, total: 0, crisis: 0, risk: 0, attention: 0, info: 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  for (const r of rows) {
    if (!r.emittedAt) continue;
    const d = new Date(r.emittedAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = utcDateKey(d);
    const bucket = buckets.get(key);
    if (!bucket) continue; // signal fora do range (defensive)
    bucket.total += 1;
    if (r.severity in bucket) {
      // TS narrow: severity is one of the keys explicitly
      bucket[r.severity] += 1;
    }
  }

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export const SOCIAL_SIGNAL_STORE_VERSION = '2026-08-27.v1';
