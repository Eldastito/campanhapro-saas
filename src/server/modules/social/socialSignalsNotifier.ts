/**
 * socialSignalsNotifier — bridge para Slack quando um signal cruza um
 * threshold de severity.
 *
 * FLUXO:
 *   pipeline produz SocialSignal[]
 *      → runner filtra severity >= minSeverity (default 'risk')
 *      → notifier dedupica em memória por dedupKey
 *      → POST em Slack webhook com payload formatado
 *
 * IDEMPOTÊNCIA:
 *   - In-memory Set de dedupKeys já notificados (por campaignId)
 *   - LRU cap (5000 entries por campaign) — evita vazamento em prod longa
 *   - Restart do server RESETA o cache (best-effort — dupes aceitas em
 *     redeploy que roda ~2min por Coolify)
 *
 * REGRA §42 preservada: mensagem para Slack SEPARA fato de hipótese —
 * summary vai como texto principal; hypotheses como bloco secundário
 * com label "hipóteses (não afirmação)".
 *
 * ISOLAMENTO: cache é escopado por (campaignId, dedupKey). Notificações
 * de campanhas diferentes NUNCA colidem no dedup.
 *
 * Não impõe rate limit no Slack — assume que o filter de severity +
 * dedup mantém a taxa < 1 req/min em uso normal.
 */

import type {
  SocialSignal,
  SocialSignalSeverity,
} from './intelligence/socialSignalBus.js';
import {
  SIGNAL_SEVERITY_ORDER,
} from './intelligence/socialSignalBus.js';

// ── Tipos ────────────────────────────────────────────────────────────

export interface NotifyResult {
  attempted: number;
  notified: number;
  skippedBelowThreshold: number;
  skippedDeduped: number;
  reason: 'ok' | 'skipped_empty' | 'skipped_no_env' | 'error';
  errorMessage?: string;
  httpStatus?: number;
}

export interface NotifyConfig {
  /** Slack incoming webhook URL. Obrigatório para enviar. */
  slackWebhookUrl: string;
  /** Filtro mínimo (default 'risk'). Exemplo: 'attention' notifica risk+crisis+attention. */
  minSeverity?: SocialSignalSeverity;
  /** Injeção pra testes — default global fetch. */
  fetchImpl?: typeof fetch;
  /** Injeção pra testes — clock ao notificar. Default new Date(). */
  now?: () => Date;
  /**
   * Injeção pra testes — função de sleep entre retry pós-429.
   * Default: `setTimeout` real via Promise. Passar `async () => {}` em
   * testes pra pular a espera.
   */
  sleepImpl?: (ms: number) => Promise<void>;
}

// Retry-After em segundos → ms. Rejeita valores inválidos ou negativos.
// Cap em 60s pra não bloquear o worker por muito tempo (>60s = deixa o
// próximo tick tentar).
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const n = Number(header);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.min(n * 1000, 60_000);
  return ms;
}

const DEFAULT_RETRY_AFTER_MS = 5_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const SOCIAL_SIGNALS_NOTIFIER_VERSION = '2026-08-27.v1';

// ── Cache LRU-ish por campanha ──────────────────────────────────────

const CACHE_MAX_PER_CAMPAIGN = 5000;
const _notifiedCache = new Map<string, Set<string>>();

function getCache(campaignId: string): Set<string> {
  let s = _notifiedCache.get(campaignId);
  if (!s) {
    s = new Set<string>();
    _notifiedCache.set(campaignId, s);
  }
  return s;
}

function trimCache(campaignId: string): void {
  const s = _notifiedCache.get(campaignId);
  if (!s) return;
  if (s.size <= CACHE_MAX_PER_CAMPAIGN) return;
  // Set em JS preserva insertion order — remove os N mais antigos
  const excess = s.size - CACHE_MAX_PER_CAMPAIGN;
  const iter = s.values();
  for (let i = 0; i < excess; i++) {
    const v = iter.next().value;
    if (v !== undefined) s.delete(v);
  }
}

/**
 * Reseta o cache de dedup. Útil pra testes ou pra forçar re-notificar
 * (ex.: mudança na config Slack).
 */
export function _resetNotifierCacheForTests(campaignId?: string): void {
  if (campaignId) _notifiedCache.delete(campaignId);
  else _notifiedCache.clear();
}

// ── Status helpers (para observabilidade) ──────────────────────────

export interface SlackNotifierStatus {
  /** Envs configuradas — sem vazar o URL. */
  configured: boolean;
  /** minSeverity efetivo (env ou default). null se não configurado. */
  minSeverity: SocialSignalSeverity | null;
  /** Tamanho do dedup cache pra uma campanha. */
  cachedDedupKeys: number;
  cacheMaxPerCampaign: number;
  notifierVersion: string;
}

/**
 * Snapshot do estado atual do Slack notifier pra uma campanha. Usado no
 * endpoint /notifier-status pra admin verificar se o webhook está
 * configurado e quantos dedupKeys estão na cache in-memory.
 *
 * NÃO devolve o próprio URL do webhook — não vaza pro cliente.
 */
export function getSlackNotifierStatus(campaignId: string): SlackNotifierStatus {
  if (!campaignId) throw new Error('getSlackNotifierStatus: campaignId obrigatório');
  const cfg = notifierConfigFromEnv();
  const cache = _notifiedCache.get(campaignId);
  return {
    configured: cfg !== null,
    minSeverity: cfg ? (cfg.minSeverity ?? DEFAULT_MIN_SEVERITY) : null,
    cachedDedupKeys: cache ? cache.size : 0,
    cacheMaxPerCampaign: CACHE_MAX_PER_CAMPAIGN,
    notifierVersion: SOCIAL_SIGNALS_NOTIFIER_VERSION,
  };
}

// ── Payload builder ────────────────────────────────────────────────

const SEVERITY_EMOJI: Record<SocialSignalSeverity, string> = {
  info: ':information_source:',
  attention: ':warning:',
  risk: ':red_circle:',
  crisis: ':rotating_light:',
};

const SEVERITY_LABEL_PT: Record<SocialSignalSeverity, string> = {
  info: 'Info',
  attention: 'Atenção',
  risk: 'Risco',
  crisis: 'Crise',
};

interface SlackPayload {
  text: string;
  blocks?: unknown[];
}

/**
 * Monta o payload Slack estilo mrkdwn. Um bloco por signal — evita
 * spammar chat com N mensagens.
 */
function buildSlackPayload(signals: SocialSignal[]): SlackPayload {
  const header = signals.length === 1
    ? `${SEVERITY_EMOJI[signals[0].severity]} *Sinal ${SEVERITY_LABEL_PT[signals[0].severity]}* — Pulso Digital`
    : `${SEVERITY_EMOJI[signals[0].severity]} *${signals.length} sinais* — Pulso Digital`;

  const summary = signals.map(s => {
    const emoji = SEVERITY_EMOJI[s.severity];
    const sevLabel = SEVERITY_LABEL_PT[s.severity];
    const topic = s.topic ? ` · ${s.topic}` : '';
    const providers = s.providers.length ? ` (${s.providers.join(', ')})` : '';
    const conf = `${(s.confidence * 100).toFixed(0)}%`;
    // §42: separar fato de hipótese
    const hypotheses = s.hypotheses.length > 0
      ? `\n_Hipóteses (não afirmação):_ ${s.hypotheses.slice(0, 3).join(' · ')}`
      : '';
    return `${emoji} *${sevLabel}*${topic}${providers} (confidence ${conf})\n${s.summary}${hypotheses}`;
  }).join('\n\n');

  return { text: `${header}\n\n${summary}` };
}

// ── API pública ─────────────────────────────────────────────────────

const DEFAULT_MIN_SEVERITY: SocialSignalSeverity = 'risk';

/**
 * Notifica no Slack os signals que cruzam `minSeverity`, filtrando já-
 * notificados via cache in-memory por (campaignId, dedupKey).
 *
 * Sem `slackWebhookUrl` → skip silencioso (reason='skipped_no_env').
 * Lista vazia → skip (reason='skipped_empty').
 * HTTP não-ok ou fetch throws → reason='error' com detalhe.
 */
export async function notifySignals(
  cfg: NotifyConfig,
  campaignId: string,
  signals: SocialSignal[],
): Promise<NotifyResult> {
  if (!campaignId) throw new Error('notifySignals: campaignId obrigatório');
  if (!signals.length) {
    return {
      attempted: 0, notified: 0,
      skippedBelowThreshold: 0, skippedDeduped: 0,
      reason: 'skipped_empty',
    };
  }
  if (!cfg.slackWebhookUrl) {
    return {
      attempted: signals.length, notified: 0,
      skippedBelowThreshold: 0, skippedDeduped: 0,
      reason: 'skipped_no_env',
    };
  }

  const min = cfg.minSeverity ?? DEFAULT_MIN_SEVERITY;
  const minRank = SIGNAL_SEVERITY_ORDER[min];

  const cache = getCache(campaignId);
  let skippedBelowThreshold = 0;
  let skippedDeduped = 0;
  const toNotify: SocialSignal[] = [];

  for (const s of signals) {
    if (SIGNAL_SEVERITY_ORDER[s.severity] < minRank) {
      skippedBelowThreshold += 1;
      continue;
    }
    if (cache.has(s.dedupKey)) {
      skippedDeduped += 1;
      continue;
    }
    toNotify.push(s);
  }

  if (toNotify.length === 0) {
    return {
      attempted: signals.length, notified: 0,
      skippedBelowThreshold, skippedDeduped,
      reason: 'ok',
    };
  }

  const payload = buildSlackPayload(toNotify);
  const fetcher = cfg.fetchImpl ?? fetch;
  const sleeper = cfg.sleepImpl ?? defaultSleep;

  const postSlack = async (): Promise<Response> => fetcher(cfg.slackWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let response: Response;
  try {
    response = await postSlack();
    // Retry ÚNICO em 429 respeitando Retry-After (segundos).
    // Slack e Resend documentam esse header; sem ele, cap em 30s como
    // fallback conservador. Uma tentativa só — evita loop exponencial
    // que poderia agravar o rate-limit durante um pico.
    if (response.status === 429) {
      const waitMs = parseRetryAfterMs(response.headers.get('retry-after')) ?? DEFAULT_RETRY_AFTER_MS;
      await sleeper(waitMs);
      response = await postSlack();
    }
  } catch (err: unknown) {
    return {
      attempted: signals.length, notified: 0,
      skippedBelowThreshold, skippedDeduped,
      reason: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch { /* ignore */ }
    return {
      attempted: signals.length, notified: 0,
      skippedBelowThreshold, skippedDeduped,
      reason: 'error',
      httpStatus: response.status,
      errorMessage: `slack rejected: ${response.status} ${detail.slice(0, 200)}`,
    };
  }

  // Marca como notificados só APÓS sucesso
  for (const s of toNotify) cache.add(s.dedupKey);
  trimCache(campaignId);

  return {
    attempted: signals.length,
    notified: toNotify.length,
    skippedBelowThreshold,
    skippedDeduped,
    reason: 'ok',
  };
}

/**
 * Convenience: monta config a partir de env vars canônicas.
 * Retorna null se as vars não estão setadas.
 */
export function notifierConfigFromEnv(): NotifyConfig | null {
  const slackWebhookUrl = process.env.SOCIAL_SIGNALS_SLACK_WEBHOOK_URL ?? '';
  if (!slackWebhookUrl) return null;
  const rawMin = process.env.SOCIAL_SIGNALS_NOTIFY_MIN_SEVERITY;
  let minSeverity: SocialSignalSeverity | undefined;
  if (rawMin && rawMin in SIGNAL_SEVERITY_ORDER) {
    minSeverity = rawMin as SocialSignalSeverity;
  }
  return { slackWebhookUrl, minSeverity };
}
