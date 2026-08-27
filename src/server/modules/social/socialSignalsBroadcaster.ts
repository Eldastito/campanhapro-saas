/**
 * socialSignalsBroadcaster — realtime pub/sub para signals recém-gerados.
 *
 * CLAUDE.md regra: "Use Broadcast, não `postgres_changes`" — porque
 * postgres_changes respeita RLS e não dispara para cliente anônimo/authed.
 * Backend faz POST direto no endpoint /realtime/v1/api/broadcast com a
 * service key. Cliente assina supabase.channel('<topic>').on('broadcast', ...).
 *
 * TOPIC: `campaign:<campaignId>:social_signals`
 * EVENT: `new`
 * PAYLOAD: `{ signals: SocialSignal[], emittedAt: ISO string }`
 *
 * REGRA §35 aplicada por convenção: cada canal é escopado por campaignId.
 * O cliente só assina o canal da SUA campanha (frontend valida). O
 * backend nunca broadcasta pra campanhas diferentes num mesmo call.
 *
 * REGRA §39: pura I/O. Nenhuma decisão de conteúdo. Recebe SocialSignal[]
 * já produzido pelo pipeline e transporta para os assinantes.
 *
 * Tolerância a falha: broadcast NÃO deve derrubar o runner. Se o
 * endpoint responder erro, devolvemos `{ reason:'error', ... }` — o
 * caller loga; a persistência (que é a fonte da verdade) já rodou.
 */

// ── Tipos ────────────────────────────────────────────────────────────

import type { SocialSignal } from './intelligence/socialSignalBus.js';

export interface BroadcastResult {
  attempted: number;
  broadcast: number;
  reason: 'ok' | 'skipped_empty' | 'skipped_no_env' | 'error';
  errorMessage?: string;
  httpStatus?: number;
}

export interface BroadcastConfig {
  /** Base URL do Supabase — normalmente SUPABASE_URL. */
  supabaseUrl: string;
  /** Chave com permissão de broadcast — SUPABASE_SERVICE_ROLE_KEY. */
  serviceRoleKey: string;
  /** Injeção pra tests — default global fetch. */
  fetchImpl?: typeof fetch;
}

export const SOCIAL_SIGNALS_BROADCASTER_VERSION = '2026-08-27.v1';

const BROADCAST_EVENT = 'new' as const;

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Deriva o topic a partir do campaignId. Cliente precisa assinar o mesmo
 * nome — mantenha em sync.
 */
export function socialSignalsTopic(campaignId: string): string {
  if (!campaignId) throw new Error('socialSignalsTopic: campaignId obrigatório');
  return `campaign:${campaignId}:social_signals`;
}

function serializeForWire(s: SocialSignal): Record<string, unknown> {
  return {
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
  };
}

// ── API pública ─────────────────────────────────────────────────────

/**
 * Broadcasta um batch de signals no canal da campanha. Lista vazia
 * é short-circuit (reason='skipped_empty'). Sem env válido → skip
 * silencioso (reason='skipped_no_env') — não é erro fatal em dev/tests.
 */
export async function broadcastSignals(
  cfg: BroadcastConfig,
  campaignId: string,
  signals: SocialSignal[],
): Promise<BroadcastResult> {
  if (!campaignId) throw new Error('broadcastSignals: campaignId obrigatório');
  if (!signals.length) {
    return { attempted: 0, broadcast: 0, reason: 'skipped_empty' };
  }
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
    return { attempted: signals.length, broadcast: 0, reason: 'skipped_no_env' };
  }

  const url = `${cfg.supabaseUrl.replace(/\/$/, '')}/realtime/v1/api/broadcast`;
  const topic = socialSignalsTopic(campaignId);
  const body = {
    messages: [{
      topic,
      event: BROADCAST_EVENT,
      payload: {
        signals: signals.map(serializeForWire),
        emittedAt: new Date().toISOString(),
        broadcasterVersion: SOCIAL_SIGNALS_BROADCASTER_VERSION,
      },
    }],
  };

  const fetcher = cfg.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: {
        apikey: cfg.serviceRoleKey,
        Authorization: `Bearer ${cfg.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err: unknown) {
    return {
      attempted: signals.length,
      broadcast: 0,
      reason: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch { /* ignore */ }
    return {
      attempted: signals.length,
      broadcast: 0,
      reason: 'error',
      httpStatus: response.status,
      errorMessage: `broadcast rejected: ${response.status} ${detail.slice(0, 200)}`,
    };
  }

  return { attempted: signals.length, broadcast: signals.length, reason: 'ok' };
}

/**
 * Convenience: monta o config a partir de env vars canônicos.
 * Retorna `null` se as vars não estão setadas (o caller decide skip vs error).
 */
export function broadcastConfigFromEnv(): BroadcastConfig | null {
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey };
}
