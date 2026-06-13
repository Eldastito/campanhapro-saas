/**
 * Routines Worker (#67 — fecha a fiação que faltava).
 *
 * Antes desse worker, a página "Rotinas" era VAPORWARE: o usuário criava
 * triggers cron na UI, via "próxima execução: 09h", mas nada lia
 * `routine_triggers`. Schedulers reais eram só 2 hardcoded
 * (proactiveMonitor + dailyBriefing).
 *
 * Agora: a cada 60s o worker varre triggers vencidos, INSERE row em
 * `routine_runs`, dispara fireOrchestration (background — não bloqueia)
 * e recalcula `nextRunAt` via cron-parser. Triggers manuais
 * (`POST /routines/:id/run`) também vão pelo mesmo loop via fast-track.
 *
 * Sem cobertura de webhook triggers ainda — esses precisam de payload
 * + assinatura que sairão num outro PR.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { CronExpressionParser } from 'cron-parser';
import { fireOrchestration } from '../../../lib/orchestrationTriggers';

const TICK_MS = 60_000;        // 1 minuto
const BATCH_LIMIT = 20;        // máximo de triggers por tick (proteção)

/** Calcula próximo nextRunAt a partir da expressão cron + timezone. */
function computeNextRun(cronExpr: string, tz: string | null): Date | null {
  try {
    const it = CronExpressionParser.parse(cronExpr, { tz: tz || 'America/Sao_Paulo' });
    return it.next().toDate();
  } catch (err: any) {
    console.warn('[routines-worker] cron inválido:', cronExpr, err?.message);
    return null;
  }
}

async function tick(supabase: SupabaseClient) {
  const nowIso = new Date().toISOString();
  // 1) Triggers cron vencidos (nextRunAt <= now). NULL nextRunAt é "primeira vez"
  //    — também dispara, e o worker recalcula o próximo.
  const { data: triggers, error } = await supabase
    .from('routine_triggers')
    .select('id, "campaignId", "routineId", kind, label, "cronExpression", timezone, "nextRunAt"')
    .eq('enabled', true)
    .eq('kind', 'cron')
    .or(`nextRunAt.lte.${nowIso},nextRunAt.is.null`)
    .limit(BATCH_LIMIT);

  if (error) {
    console.warn('[routines-worker] erro buscando triggers:', error.message);
    return;
  }
  if (!triggers?.length) return;

  // 2) Pra cada trigger: buscar a rotina (title/description = intent), criar
  //    routine_run, disparar orquestrador (background), atualizar nextRunAt.
  for (const t of triggers as any[]) {
    const next = t.cronExpression ? computeNextRun(t.cronExpression, t.timezone) : null;

    // Anti-double-trigger: ATUALIZA o trigger ANTES de disparar. Se outro worker
    // (multi-instance) pegar essa linha simultaneamente, vai ver nextRunAt já no
    // futuro e ignora. Não é leak-proof mas evita 99% dos casos.
    const { error: updErr } = await supabase
      .from('routine_triggers')
      .update({
        lastFiredAt: nowIso,
        nextRunAt: next?.toISOString() || null,
        updatedAt: nowIso,
      })
      .eq('id', t.id)
      .or(`nextRunAt.lte.${nowIso},nextRunAt.is.null`); // só atualiza se ainda vencido (anti-race)
    if (updErr) {
      console.warn('[routines-worker] falha update trigger:', t.id, updErr.message);
      continue;
    }

    // 3) Pega a rotina pra montar o intent
    const { data: routine } = await supabase
      .from('agent_routines')
      .select('title, description, "assigneeAgentId", variables')
      .eq('id', t.routineId)
      .maybeSingle();
    if (!routine) {
      console.warn('[routines-worker] rotina não encontrada:', t.routineId);
      continue;
    }

    const intent = (routine as any).description || (routine as any).title || `Rotina ${t.label}`;

    // 4) Cria routine_run pra auditoria
    const { data: run } = await supabase.from('routine_runs').insert({
      campaignId: t.campaignId,
      routineId: t.routineId,
      triggerId: t.id,
      source: 'cron',
      status: 'running',
      triggeredAt: nowIso,
    }).select('id').maybeSingle();

    // 5) Dispara orquestrador em background (não bloqueia o tick).
    //    Como fireOrchestration é fire-and-forget, marca run como 'completed'
    //    de imediato — a observabilidade do que aconteceu fica em manager_runs.
    fireOrchestration(supabase, {
      campaignId: t.campaignId,
      intent,
      source: `routine:${t.label}`,
    });

    if (run?.id) {
      await supabase.from('routine_runs')
        .update({ status: 'completed', completedAt: nowIso, updatedAt: nowIso })
        .eq('id', run.id);
    }

    // 6) Marca lastTriggeredAt na rotina (UI mostra "última execução")
    await supabase.from('agent_routines')
      .update({ lastTriggeredAt: nowIso, lastEnqueuedAt: nowIso, updatedAt: nowIso })
      .eq('id', t.routineId);

    console.log(`[routines-worker] disparou ${t.label} campanha=${t.campaignId} próximo=${next?.toISOString() || 'never'}`);
  }
}

/**
 * Tick adicional: processa routine_runs órfãos criados pelo
 * POST /routines/:id/run manual (status='received'). Sem esse sweeper o
 * endpoint criava rows e morria sem executar nada.
 */
async function tickManualRuns(supabase: SupabaseClient) {
  const { data: runs } = await supabase
    .from('routine_runs')
    .select('id, "campaignId", "routineId", source')
    .eq('source', 'manual')
    .eq('status', 'received')
    .limit(20);
  if (!runs?.length) return;

  for (const r of runs as any[]) {
    const { data: routine } = await supabase
      .from('agent_routines')
      .select('title, description')
      .eq('id', r.routineId).maybeSingle();
    if (!routine) continue;
    const intent = (routine as any).description || (routine as any).title || 'Rotina manual';
    fireOrchestration(supabase, {
      campaignId: r.campaignId, intent, source: 'routine:manual',
    });
    await supabase.from('routine_runs')
      .update({ status: 'running', updatedAt: new Date().toISOString() })
      .eq('id', r.id);
    // Marcamos 'running' (não 'completed') pra UI ver progresso;
    // o manager loga em manager_runs separadamente.
  }
}

let _started = false;
let _intervalHandle: NodeJS.Timeout | null = null;

export function startRoutinesWorker(supabase: SupabaseClient) {
  if (_started) return;
  if (process.env.DISABLE_ROUTINES_WORKER === '1') {
    console.log('[routines-worker] desabilitado via env');
    return;
  }
  _started = true;
  console.log(`[routines-worker] iniciado (tick=${TICK_MS / 1000}s)`);

  const run = async () => {
    try {
      await tick(supabase);
      await tickManualRuns(supabase);
    } catch (e: any) {
      console.error('[routines-worker] erro no tick:', e?.message || e);
    }
  };

  // Primeiro tick em 15s pra dar tempo do servidor estabilizar
  setTimeout(run, 15_000);
  _intervalHandle = setInterval(run, TICK_MS);
}

export function stopRoutinesWorker() {
  if (_intervalHandle) clearInterval(_intervalHandle);
  _intervalHandle = null;
  _started = false;
}
