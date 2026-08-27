/**
 * socialSignalsScheduler — loop periódico que roda o batch runner
 * (PR 19) automaticamente.
 *
 * Faz o pipeline ficar "vivo" sem endpoint manual — a UI Pulso Digital
 * consulta signals que foram calculados em background.
 *
 * ARCHITECTURE:
 *   - `signalsTick(supabase, opts)` — função pura async: descobre
 *     campanhas, roda batch runner, devolve summary. Testável em
 *     isolamento sem timers.
 *   - `startSocialSignalsScheduler({supabase, intervalMs, ...})` — thin
 *     wrapper que registra setInterval e devolve `{ stop }`. Server.ts
 *     (ou outro entrypoint) chama isso pra ligar; testes usam `signalsTick`.
 *
 * ISOLAMENTO DE ERRO em duas camadas:
 *   - Por campanha (batch runner cuida via isolamento)
 *   - No próprio tick (try/catch aqui pra que erro NÃO derrube o interval)
 *
 * NÃO auto-boot no server.ts: precisa ser explicitamente ativado por
 * quem quer usar. Evita side-effects em jobs/CI/deploy que só carregam
 * o módulo pra fazer typecheck.
 *
 * REGRA §35: cada tick delega decisão pro batch runner, que delega pro
 * runner de campanha — cross-tenant continua impossível.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  runSignalsForCampaigns,
  discoverActiveCampaigns,
  type BatchSignalsSummary,
  type BatchSignalsOptions,
} from './socialSignalsBatchRunner.js';

// ── Tipos ────────────────────────────────────────────────────────────

export interface SignalsTickOptions {
  /**
   * Se true, usa `discoverActiveCampaigns` do batch runner (lê
   * campaign_configs). Se false, `campaignIds` obrigatório.
   * Default true.
   */
  autoDiscover?: boolean;

  /** Lista explícita de campanhas — usada se `autoDiscover: false`. */
  campaignIds?: readonly string[];

  /** Options propagadas para cada run — persist, broadcast, focusTopics etc. */
  batchOptions?: BatchSignalsOptions;

  /** Limite para autoDiscover — passa direto pro discovery. Default 500. */
  discoverLimit?: number;
}

export interface SignalsTickResult {
  ok: true;
  summary: BatchSignalsSummary;
  discoveredCount: number;
  tickAt: string;
}

export interface SignalsTickError {
  ok: false;
  errorMessage: string;
  errorKind: string;
  tickAt: string;
}

export type SignalsTickOutcome = SignalsTickResult | SignalsTickError;

export interface StartSchedulerOptions extends SignalsTickOptions {
  supabase: SupabaseClient;
  /** Intervalo em ms entre ticks. Default 15 minutos. */
  intervalMs?: number;
  /** Se true, dispara UM tick imediatamente ao iniciar (não espera intervalo). Default false. */
  runOnStart?: boolean;
  /** Callback opcional pra cada outcome — pro caller logar/monitorar. */
  onTick?: (outcome: SignalsTickOutcome) => void;
}

export interface SchedulerHandle {
  /** Para o loop; próximo tick não roda. Idempotente. */
  stop(): void;
  /** Estado atual — util pra observabilidade e health check. */
  isRunning(): boolean;
}

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 min
export const SOCIAL_SIGNALS_SCHEDULER_VERSION = '2026-08-27.v1';

// ── API pública ─────────────────────────────────────────────────────

/**
 * Executa UM ciclo completo: descobre campanhas (ou usa a lista dada),
 * roda o batch runner, devolve o outcome. NUNCA lança — erros viram
 * `{ok: false, ...}`.
 */
export async function signalsTick(
  supabase: SupabaseClient,
  opts: SignalsTickOptions = {},
): Promise<SignalsTickOutcome> {
  const tickAt = new Date().toISOString();
  try {
    let campaignIds: readonly string[];
    if (opts.autoDiscover === false) {
      if (!opts.campaignIds || opts.campaignIds.length === 0) {
        return {
          ok: false,
          errorMessage: 'signalsTick: autoDiscover=false requer campaignIds não-vazio',
          errorKind: 'ConfigError',
          tickAt,
        };
      }
      campaignIds = opts.campaignIds;
    } else {
      campaignIds = await discoverActiveCampaigns(supabase, {
        limit: opts.discoverLimit,
      });
    }
    const summary = await runSignalsForCampaigns(supabase, {
      campaignIds,
      options: opts.batchOptions,
    });
    return {
      ok: true,
      summary,
      discoveredCount: campaignIds.length,
      tickAt,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      errorKind: err instanceof Error ? err.constructor.name : 'unknown',
      tickAt,
    };
  }
}

/**
 * Inicia o scheduler. Registra um setInterval que chama `signalsTick`
 * periodicamente. Devolve um `SchedulerHandle` com `.stop()`.
 *
 * NÃO faz auto-boot — precisa ser chamado explicitamente por quem
 * quer o loop rodando (ex.: server.ts).
 */
export function startSocialSignalsScheduler(opts: StartSchedulerOptions): SchedulerHandle {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs < 1_000) {
    throw new Error(`startSocialSignalsScheduler: intervalMs inválido (${intervalMs})`);
  }

  let running = true;
  let currentTimer: ReturnType<typeof setTimeout> | null = null;
  const tickOpts: SignalsTickOptions = {
    autoDiscover: opts.autoDiscover,
    campaignIds: opts.campaignIds,
    batchOptions: opts.batchOptions,
    discoverLimit: opts.discoverLimit,
  };

  const doTick = async () => {
    if (!running) return;
    const outcome = await signalsTick(opts.supabase, tickOpts);
    if (opts.onTick) {
      try { opts.onTick(outcome); } catch (err) {
        console.warn(
          `[socialSignalsScheduler] onTick handler lançou: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  const scheduleNext = () => {
    if (!running) return;
    currentTimer = setTimeout(async () => {
      try { await doTick(); } finally { scheduleNext(); }
    }, intervalMs);
  };

  if (opts.runOnStart) {
    // fire and forget — o próximo tick já é agendado
    void doTick().finally(scheduleNext);
  } else {
    scheduleNext();
  }

  return {
    stop() {
      if (!running) return;
      running = false;
      if (currentTimer) {
        clearTimeout(currentTimer);
        currentTimer = null;
      }
    },
    isRunning() {
      return running;
    },
  };
}
