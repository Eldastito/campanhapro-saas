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

export const SOCIAL_SIGNAL_STORE_VERSION = '2026-08-27.v1';
