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

export interface SchedulerStatus {
  running: boolean;
  /** ISO do momento em que o scheduler foi startado. */
  startedAt: string;
  /** Quantos ticks completados (inclui erros). */
  tickCount: number;
  /** Último outcome observado. `null` até o primeiro tick. */
  lastOutcome: SignalsTickOutcome | null;
  schedulerVersion: string;
}

export interface SchedulerHandle {
  /** Para o loop; próximo tick não roda. Idempotente. */
  stop(): void;
  /** Estado atual — util pra observabilidade e health check. */
  isRunning(): boolean;
  /** Snapshot completo de estado — útil pra endpoint de status. */
  getStatus(): SchedulerStatus;
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
  const startedAt = new Date().toISOString();
  let tickCount = 0;
  let lastOutcome: SignalsTickOutcome | null = null;
  const tickOpts: SignalsTickOptions = {
    autoDiscover: opts.autoDiscover,
    campaignIds: opts.campaignIds,
    batchOptions: opts.batchOptions,
    discoverLimit: opts.discoverLimit,
  };

  const doTick = async () => {
    if (!running) return;
    const outcome = await signalsTick(opts.supabase, tickOpts);
    tickCount += 1;
    lastOutcome = outcome;
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
    getStatus() {
      return {
        running,
        startedAt,
        tickCount,
        lastOutcome,
        schedulerVersion: SOCIAL_SIGNALS_SCHEDULER_VERSION,
      };
    },
  };
}

// ── Env-gated bootstrap ─────────────────────────────────────────────

/**
 * Env vars lidas por `maybeStartSocialSignalsScheduler`. Todas opcionais
 * exceto `SOCIAL_SIGNALS_SCHEDULER_ENABLED=1` que é o gate.
 */
export interface SchedulerEnv {
  SOCIAL_SIGNALS_SCHEDULER_ENABLED?: string;
  /** Intervalo em milissegundos. Default 900000 (15min). Valores <1000
   *  são REJEITADOS (retorna null com log). */
  SOCIAL_SIGNALS_SCHEDULER_INTERVAL_MS?: string;
  /** Se '1', chama tick imediato ao startar. Default: '0'. */
  SOCIAL_SIGNALS_SCHEDULER_RUN_ON_START?: string;
  /** Se '1', tick persiste signals em social_signals. Default: '1'. */
  SOCIAL_SIGNALS_SCHEDULER_PERSIST?: string;
  /** Se '1', tick broadcasta em campaign:<id>:social_signals. Default: '1'. */
  SOCIAL_SIGNALS_SCHEDULER_BROADCAST?: string;
  /** Se '1', tick tenta notificar Slack (usa notifierConfigFromEnv). Default: '0'. */
  SOCIAL_SIGNALS_SCHEDULER_NOTIFY?: string;
}

export interface MaybeStartOptions {
  supabase: SupabaseClient;
  env?: SchedulerEnv;
  onTick?: (outcome: SignalsTickOutcome) => void;
}

const DEFAULT_ENV_INTERVAL_MS = DEFAULT_INTERVAL_MS;

function parseBool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return v === '1' || v.toLowerCase() === 'true';
}

/**
 * Boot condicional pro server.ts. Devolve null quando o scheduler está
 * desligado (env flag off ou intervalo inválido). Handle quando ligado.
 *
 * Nunca lança — problemas com env são registrados em stderr e o loop
 * simplesmente não sobe.
 *
 * Uso típico em server.ts:
 *   const handle = maybeStartSocialSignalsScheduler({ supabase });
 *   if (handle) process.on('SIGTERM', () => handle.stop());
 */
export function maybeStartSocialSignalsScheduler(
  opts: MaybeStartOptions,
): SchedulerHandle | null {
  const env = opts.env ?? (process.env as SchedulerEnv);
  const enabled = parseBool(env.SOCIAL_SIGNALS_SCHEDULER_ENABLED, false);
  if (!enabled) return null;

  let intervalMs = DEFAULT_ENV_INTERVAL_MS;
  const rawInterval = env.SOCIAL_SIGNALS_SCHEDULER_INTERVAL_MS;
  if (rawInterval !== undefined && rawInterval !== '') {
    const n = Number(rawInterval);
    if (!Number.isFinite(n) || n < 1_000) {
      console.warn(
        `[socialSignalsScheduler] SOCIAL_SIGNALS_SCHEDULER_INTERVAL_MS inválido (${rawInterval}); usando default ${DEFAULT_ENV_INTERVAL_MS}ms`,
      );
    } else {
      intervalMs = n;
    }
  }

  const runOnStart = parseBool(env.SOCIAL_SIGNALS_SCHEDULER_RUN_ON_START, false);
  const persist = parseBool(env.SOCIAL_SIGNALS_SCHEDULER_PERSIST, true);
  const broadcast = parseBool(env.SOCIAL_SIGNALS_SCHEDULER_BROADCAST, true);
  const notify = parseBool(env.SOCIAL_SIGNALS_SCHEDULER_NOTIFY, false);

  try {
    const handle = startSocialSignalsScheduler({
      supabase: opts.supabase,
      intervalMs,
      runOnStart,
      onTick: opts.onTick,
      batchOptions: { persist, broadcast, notify },
    });
    _currentSchedulerHandle = handle;
    console.log(
      `[socialSignalsScheduler] enabled — interval=${intervalMs}ms runOnStart=${runOnStart} persist=${persist} broadcast=${broadcast} notify=${notify}`,
    );
    return handle;
  } catch (err: unknown) {
    console.warn(
      `[socialSignalsScheduler] startSocialSignalsScheduler falhou: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// ── Handle registry (para o endpoint /scheduler-status observar) ────

let _currentSchedulerHandle: SchedulerHandle | null = null;

/**
 * Devolve o handle do scheduler ativo, se houver. Consumido pelo
 * endpoint admin de status. Retorna null se scheduler não foi
 * iniciado (env off) ou já foi parado.
 *
 * Isso é um singleton em processo — assume 1 server = 1 scheduler
 * ativo. Se o server for horizontal scale, cada worker tem o seu.
 */
export function getCurrentSchedulerHandle(): SchedulerHandle | null {
  if (_currentSchedulerHandle && !_currentSchedulerHandle.isRunning()) {
    _currentSchedulerHandle = null;
  }
  return _currentSchedulerHandle;
}

/**
 * Reseta o registry — útil pra testes que criam múltiplos handles
 * seguidamente. Em prod nunca é chamado.
 */
export function _resetCurrentSchedulerHandleForTests(): void {
  _currentSchedulerHandle = null;
}
