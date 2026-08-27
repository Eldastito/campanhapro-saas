/**
 * socialSignalsEmailNotifier — bridge para email quando um signal cruza
 * um threshold de severity. Segundo canal ao lado do Slack notifier
 * (PR 25): Slack pra ops-channel, email pra pessoas específicas
 * (coordenador de campanha, comitê estratégico).
 *
 * FLUXO (idêntico ao Slack notifier em shape):
 *   pipeline produz SocialSignal[]
 *      → runner filtra severity >= minSeverity (default 'risk')
 *      → notifier dedupica em memória por dedupKey
 *      → envia via EmailProvider (Resend/stub) pra cada recipient
 *
 * IDEMPOTÊNCIA:
 *   - In-memory Set de dedupKeys já notificados (por campaignId), com LRU
 *     cap 5000. RESTART DO SERVER RESETA (best-effort — dupes aceitas em
 *     redeploy que roda ~2min por Coolify).
 *   - Cache NAMESPACE INDEPENDENTE do Slack notifier — mesmo signal pode
 *     ir pros dois canais na mesma execução; não colidem no dedup.
 *
 * REGRA §42 preservada no template: summary factual como corpo principal;
 * hipóteses em bloco separado com rótulo "Hipóteses (não afirmação)".
 *
 * ISOLAMENTO: cache é escopado por (campaignId, dedupKey). Notificações
 * de campanhas diferentes NUNCA colidem no dedup.
 *
 * Recipients vêm da config (env: comma-separated SOCIAL_SIGNALS_NOTIFY_EMAILS).
 * Se lista vazia → skip silencioso (reason='skipped_no_env'). Cada
 * destinatário recebe 1 email por batch (não fanout N×; batching de
 * signals em UMA mensagem — evita spam).
 */

import type {
  SocialSignal,
  SocialSignalSeverity,
} from './intelligence/socialSignalBus.js';
import { SIGNAL_SEVERITY_ORDER } from './intelligence/socialSignalBus.js';
import { getEmailProvider } from '../email/emailProvider.js';
import type { EmailProvider } from '../email/emailProvider.js';

// ── Tipos ────────────────────────────────────────────────────────────

export interface EmailNotifyResult {
  attempted: number;
  notified: number;
  skippedBelowThreshold: number;
  skippedDeduped: number;
  reason:
    | 'ok'
    | 'partial'
    | 'skipped_empty'
    | 'skipped_no_env'
    | 'error';
  errorMessage?: string;
  /** Emails accepted pelo provider (ex.: 2/3 recipients aceitos → 2). */
  deliveredCount?: number;
  /** Emails rejeitados. Vazio quando reason='ok'. */
  failedRecipients?: string[];
}

export interface EmailNotifyConfig {
  /** Destinatários. Obrigatório e não vazio. */
  recipients: string[];
  /** Filtro mínimo (default 'risk'). */
  minSeverity?: SocialSignalSeverity;
  /** Provider injetado (default `getEmailProvider()`). */
  provider?: EmailProvider;
  /** Injeção pra tests — override do relógio. Default new Date(). */
  now?: () => Date;
  /**
   * Injeção pra tests — função de sleep pós-429. Default: setTimeout
   * via Promise. Passar `async () => {}` em testes pra pular a espera.
   */
  sleepImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_EMAIL_RETRY_AFTER_MS = 5_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const SOCIAL_SIGNALS_EMAIL_NOTIFIER_VERSION = '2026-08-27.v1';

// ── Cache LRU-ish por campanha (independente do Slack) ──────────────

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
  const excess = s.size - CACHE_MAX_PER_CAMPAIGN;
  const iter = s.values();
  for (let i = 0; i < excess; i++) {
    const v = iter.next().value;
    if (v !== undefined) s.delete(v);
  }
}

/**
 * Reseta o cache de dedup do email notifier. Útil pra tests ou pra forçar
 * re-notificar. Independente do cache do Slack notifier.
 */
export function _resetEmailNotifierCacheForTests(campaignId?: string): void {
  if (campaignId) _notifiedCache.delete(campaignId);
  else _notifiedCache.clear();
}

// ── Status helpers ─────────────────────────────────────────────────

export interface EmailNotifierStatus {
  configured: boolean;
  minSeverity: SocialSignalSeverity | null;
  /** Quantidade de recipients configurados. Não expõe os endereços. */
  recipientsCount: number;
  cachedDedupKeys: number;
  cacheMaxPerCampaign: number;
  notifierVersion: string;
}

/**
 * Snapshot do estado atual do email notifier pra uma campanha. Usado no
 * endpoint /notifier-status.
 *
 * NÃO devolve emails individuais — só a contagem — pra não vazar PII.
 */
export function getEmailNotifierStatus(campaignId: string): EmailNotifierStatus {
  if (!campaignId) throw new Error('getEmailNotifierStatus: campaignId obrigatório');
  const cfg = emailNotifierConfigFromEnv();
  const cache = _notifiedCache.get(campaignId);
  return {
    configured: cfg !== null,
    minSeverity: cfg ? (cfg.minSeverity ?? DEFAULT_MIN_SEVERITY) : null,
    recipientsCount: cfg ? cfg.recipients.length : 0,
    cachedDedupKeys: cache ? cache.size : 0,
    cacheMaxPerCampaign: CACHE_MAX_PER_CAMPAIGN,
    notifierVersion: SOCIAL_SIGNALS_EMAIL_NOTIFIER_VERSION,
  };
}

// ── Template builder ────────────────────────────────────────────────

const SEVERITY_LABEL_PT: Record<SocialSignalSeverity, string> = {
  info: 'Info',
  attention: 'Atenção',
  risk: 'Risco',
  crisis: 'Crise',
};

const SEVERITY_COLOR_HEX: Record<SocialSignalSeverity, string> = {
  info: '#64748b',
  attention: '#f59e0b',
  risk: '#f97316',
  crisis: '#dc2626',
};

/** Escape mínimo para HTML — usa em texto vindo do bus (§42-safe). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

/**
 * Monta o email. Um bloco por signal — evita 1 email por signal (spam).
 * Subject reflete o pico de severity + count.
 */
export function buildEmailTemplate(signals: SocialSignal[]): EmailTemplate {
  // Signals já vêm ordenados pelo bus (severity DESC); [0] é o mais grave.
  const top = signals[0];
  const subject = signals.length === 1
    ? `[Pulso Digital] Sinal ${SEVERITY_LABEL_PT[top.severity]}: ${top.summary.slice(0, 80)}`
    : `[Pulso Digital] ${signals.length} sinais — pico ${SEVERITY_LABEL_PT[top.severity]}`;

  const blocks = signals.map(s => {
    const color = SEVERITY_COLOR_HEX[s.severity];
    const sevLabel = SEVERITY_LABEL_PT[s.severity];
    const topic = s.topic ? ` · ${escapeHtml(s.topic)}` : '';
    const providers = s.providers.length ? ` (${escapeHtml(s.providers.join(', '))})` : '';
    const conf = `${(s.confidence * 100).toFixed(0)}%`;
    const hypothesesHtml = s.hypotheses.length > 0
      ? `<div style="margin-top:8px; padding:8px 12px; border-left:3px solid #f59e0b; background:#fef3c7; color:#78350f; font-size:13px;">
           <strong>Hipóteses (não afirmação):</strong>
           <ul style="margin:4px 0 0; padding-left:18px;">
             ${s.hypotheses.slice(0, 5).map(h => `<li>${escapeHtml(h)}</li>`).join('')}
           </ul>
         </div>`
      : '';
    return `
      <div style="margin:12px 0; padding:12px; border:1px solid #e2e8f0; border-radius:8px;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
          <span style="background:${color}; color:#fff; padding:2px 8px; border-radius:4px; font-size:12px; font-weight:600;">${sevLabel}</span>
          <span style="color:#64748b; font-size:12px;">${escapeHtml(s.source)}${topic}${providers} · confidence ${conf}</span>
        </div>
        <div style="color:#1e293b; font-size:14px; line-height:1.5;">${escapeHtml(s.summary)}</div>
        ${hypothesesHtml}
      </div>
    `;
  }).join('');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width:600px; margin:0 auto; padding:16px;">
      <h2 style="color:#0f172a; margin:0 0 8px;">Pulso Digital · alerta</h2>
      <p style="color:#64748b; font-size:13px; margin:0 0 16px;">
        ${signals.length === 1 ? 'Um sinal cruzou' : `${signals.length} sinais cruzaram`} o threshold configurado.
        Hipóteses são possibilidades a explorar — nunca afirmação (§42).
      </p>
      ${blocks}
      <p style="color:#94a3b8; font-size:11px; margin-top:24px;">
        Enviado pelo scheduler CampanhaPro — Pulso Digital.
      </p>
    </div>
  `;

  const textBlocks = signals.map(s => {
    const sevLabel = SEVERITY_LABEL_PT[s.severity];
    const topic = s.topic ? ` · ${s.topic}` : '';
    const providers = s.providers.length ? ` (${s.providers.join(', ')})` : '';
    const conf = `${(s.confidence * 100).toFixed(0)}%`;
    const hypotheses = s.hypotheses.length > 0
      ? `\nHipóteses (não afirmação):\n${s.hypotheses.slice(0, 5).map(h => `  - ${h}`).join('\n')}`
      : '';
    return `[${sevLabel}] ${s.source}${topic}${providers} (confidence ${conf})\n${s.summary}${hypotheses}`;
  }).join('\n\n---\n\n');

  const text = `Pulso Digital · alerta\n${signals.length === 1 ? 'Um sinal cruzou' : `${signals.length} sinais cruzaram`} o threshold configurado.\n\n${textBlocks}\n\nEnviado pelo scheduler CampanhaPro — Pulso Digital.`;

  return { subject, html, text };
}

// ── API pública ─────────────────────────────────────────────────────

const DEFAULT_MIN_SEVERITY: SocialSignalSeverity = 'risk';

/**
 * Envia email pros recipients configurados sobre signals que cruzam
 * minSeverity, filtrando já-notificados via cache in-memory por
 * (campaignId, dedupKey).
 *
 * Lista de recipients vazia → skip silencioso (reason='skipped_no_env').
 * Lista de signals vazia → skip (reason='skipped_empty').
 * Provider rejeita 1 recipient → reason='partial' com failedRecipients.
 * Provider rejeita TODOS → reason='error' + failedRecipients.
 */
export async function emailNotifySignals(
  cfg: EmailNotifyConfig,
  campaignId: string,
  signals: SocialSignal[],
): Promise<EmailNotifyResult> {
  if (!campaignId) throw new Error('emailNotifySignals: campaignId obrigatório');
  if (!signals.length) {
    return {
      attempted: 0, notified: 0,
      skippedBelowThreshold: 0, skippedDeduped: 0,
      reason: 'skipped_empty',
    };
  }
  if (!cfg.recipients || cfg.recipients.length === 0) {
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

  const template = buildEmailTemplate(toNotify);
  const provider = cfg.provider ?? getEmailProvider();
  const sleeper = cfg.sleepImpl ?? defaultSleep;

  // 1 request por recipient (Resend API não faz BCC nativo; mais transparente
  // pro debugging quando 1 endereço falha)
  const failedRecipients: string[] = [];
  let deliveredCount = 0;

  const params = {
    subject: template.subject,
    html: template.html,
    text: template.text,
  };

  for (const to of cfg.recipients) {
    let result = await provider.sendEmail({ to, ...params });
    // Retry ÚNICO em 429 (rate-limit) respeitando Retry-After do provider.
    // Sem loop exponencial — mesma justificativa do Slack notifier (PR 34):
    // scheduler tenta de novo no próximo tick com cache in-memory garantindo
    // idempotência.
    if (!result.ok && result.status === 429) {
      const waitMs = result.retryAfterMs ?? DEFAULT_EMAIL_RETRY_AFTER_MS;
      await sleeper(waitMs);
      result = await provider.sendEmail({ to, ...params });
    }
    if (result.ok) {
      deliveredCount += 1;
    } else {
      failedRecipients.push(to);
    }
  }

  const anyDelivered = deliveredCount > 0;
  const allDelivered = failedRecipients.length === 0;

  if (!anyDelivered) {
    // Nenhum aceito → não marca como notificado (retry seguro no próximo tick)
    return {
      attempted: signals.length,
      notified: 0,
      skippedBelowThreshold, skippedDeduped,
      reason: 'error',
      errorMessage: 'todos os recipients rejeitados pelo provider',
      failedRecipients,
    };
  }

  // Pelo menos 1 aceito → marca como notificado; evitamos re-enviar
  // mesmo pra quem falhou (aceitamos que essa pessoa perde esse batch —
  // caso contrário quem já recebeu recebe de novo no próximo tick)
  for (const s of toNotify) cache.add(s.dedupKey);
  trimCache(campaignId);

  return {
    attempted: signals.length,
    notified: toNotify.length,
    skippedBelowThreshold, skippedDeduped,
    reason: allDelivered ? 'ok' : 'partial',
    deliveredCount,
    ...(allDelivered ? {} : { failedRecipients }),
  };
}

/**
 * Convenience: monta config a partir de env vars canônicas.
 * Retorna null se as vars não estão setadas.
 * `SOCIAL_SIGNALS_NOTIFY_EMAILS` é comma-separated; whitespace trimado;
 * emails vazios filtrados.
 */
export function emailNotifierConfigFromEnv(): EmailNotifyConfig | null {
  const raw = process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS ?? '';
  const recipients = raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
  if (recipients.length === 0) return null;
  const rawMin = process.env.SOCIAL_SIGNALS_EMAIL_NOTIFY_MIN_SEVERITY;
  let minSeverity: SocialSignalSeverity | undefined;
  if (rawMin && rawMin in SIGNAL_SEVERITY_ORDER) {
    minSeverity = rawMin as SocialSignalSeverity;
  }
  return { recipients, minSeverity };
}
