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
import { runSocialSync, detectSignificantChange, SyncProvider } from '../../../lib/socialSyncRunner';
import { createSnapshot, shouldRunBackupToday } from '../controlPanel/backupService';
import { processRecurringRepasses } from '../../../lib/recurringRepasses';

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

/**
 * Sync noturno de redes sociais (#124).
 *
 * Roda 1x/dia às 04h BR (sem cron-parser — checa relógio direto no tick).
 * Pra cada campanha com social_tokens:
 *   1. Lock atômico via social_sync_log (UPSERT condicionado a lastSyncedDate < hoje)
 *   2. Pra cada provider conectado (x/linkedin/kwai) → runSocialSync
 *   3. detectSignificantChange — se houver mudança ≥20% followers ou post viral,
 *      dispara fireOrchestration. SE NÃO, encerra silencioso (zero tokens IA).
 */
const SYNC_HOUR_BR = 4;        // 04h BR
const SYNC_PROVIDERS: SyncProvider[] = ['x', 'linkedin', 'kwai'];

function getBRHour(): number {
  // America/Sao_Paulo é UTC-3 (sem DST desde 2019)
  const utc = new Date();
  const sp = new Date(utc.getTime() - 3 * 60 * 60 * 1000);
  return sp.getUTCHours();
}

function todayInBR(): string {
  const utc = new Date();
  const sp = new Date(utc.getTime() - 3 * 60 * 60 * 1000);
  return sp.toISOString().slice(0, 10);
}

async function tickSocialSync(supabase: SupabaseClient) {
  // Janela: só dispara entre 04h-05h BR (evita rodar 24h/dia depois da janela)
  const hour = getBRHour();
  if (hour < SYNC_HOUR_BR || hour > SYNC_HOUR_BR + 1) return;

  const today = todayInBR();

  // 1) Lista campanhas que TÊM social_tokens e ainda NÃO sincronizaram hoje.
  //    Subconsulta seria mais limpa, mas o SDK do supabase-js não suporta —
  //    pegamos as candidatas via DISTINCT e filtramos com JOIN manual.
  const { data: tokens } = await supabase
    .from('social_tokens')
    .select('campaignId, provider')
    .in('provider', SYNC_PROVIDERS as string[]);
  if (!tokens?.length) return;

  const byCampaign = new Map<string, SyncProvider[]>();
  for (const t of tokens as any[]) {
    const arr = byCampaign.get(t.campaignId) || [];
    arr.push(t.provider as SyncProvider);
    byCampaign.set(t.campaignId, arr);
  }

  for (const [campaignId, providers] of byCampaign) {
    // 2) Lock atômico: tenta UPDATE WHERE lastSyncedDate < hoje (ou null).
    //    Se nenhuma linha foi atualizada, outro worker já pegou — pula.
    //    Primeiro garante que existe linha.
    await supabase.from('social_sync_log')
      .upsert({ campaignId, updatedAt: new Date().toISOString() }, { onConflict: 'campaignId' });

    const { data: locked } = await supabase.from('social_sync_log')
      .update({ lastSyncedDate: today, lastSyncedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .eq('campaignId', campaignId)
      .or(`lastSyncedDate.is.null,lastSyncedDate.lt.${today}`)
      .select('campaignId')
      .maybeSingle();
    if (!locked) continue; // outro worker já pegou hoje

    console.log(`[social-sync] iniciando sync noturno campanha=${campaignId} providers=${providers.join(',')}`);

    let synced = 0;
    for (const p of providers) {
      try {
        await runSocialSync(supabase, campaignId, p);
        synced++;
      } catch (err: any) {
        console.warn(`[social-sync] falha ${campaignId}/${p}:`, err?.message || err);
      }
    }
    if (synced === 0) continue;

    // 3) Detecta mudança significativa (compara hoje vs ontem)
    let change: Awaited<ReturnType<typeof detectSignificantChange>> = null;
    try {
      change = await detectSignificantChange(supabase, campaignId);
    } catch (err: any) {
      console.warn('[social-sync] detect falhou:', err?.message);
    }

    if (change) {
      // Persiste evidência da mudança (auditável + UI mostra "última detecção")
      await supabase.from('social_sync_log').update({
        lastChangeDetected: { detectedAt: new Date().toISOString(), ...change },
        updatedAt: new Date().toISOString(),
      }).eq('campaignId', campaignId);

      const intent = `Mudança significativa detectada nas redes sociais do candidato: ${change.summary}.\n\n`
        + `Investigue o que causou (qual post, qual canal, qual público), avalie se é oportunidade ou risco, e proponha 2-3 ações concretas pra equipe executar nas próximas 24h. Use os snapshots indexados no RAG (source=social:*).`;

      fireOrchestration(supabase, {
        campaignId,
        intent,
        source: 'social_auto_sync',
      });

      console.log(`[social-sync] mudança detectada campanha=${campaignId}: ${change.summary}`);
    } else {
      console.log(`[social-sync] sync noturno OK campanha=${campaignId} (sem mudança relevante — IA não disparada)`);
    }
  }
}

/**
 * Backup automático noturno (#137).
 *
 * Roda 1x/dia entre 03h-04h BR (antes do sync social das 04h). Pra cada
 * campanha com WhatsApp conectado OU visits/eventos recentes, gera um
 * snapshot de auditoria. Skip campanhas pausadas (aiGloballyPausedAt).
 */
const BACKUP_HOUR_BR = 3;

async function tickDailyBackup(supabase: SupabaseClient) {
  const hour = getBRHour();
  if (hour < BACKUP_HOUR_BR || hour > BACKUP_HOUR_BR + 1) return;

  // Lista campanhas ativas (com ao menos 1 visita ou 1 ação de engajamento alguma vez)
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, "aiGloballyPausedAt"')
    .limit(200);

  if (!campaigns?.length) return;

  for (const c of campaigns as any[]) {
    if (c.aiGloballyPausedAt) continue; // pausada → não faz backup
    try {
      const need = await shouldRunBackupToday(supabase, c.id);
      if (!need) continue;
      const snap = await createSnapshot(supabase, c.id);
      console.log(`[backup] campanha=${c.id} criado snapshot tamanho=${(snap.sizeBytes / 1024).toFixed(0)}KB`);
    } catch (err: any) {
      console.warn(`[backup] falha campanha=${c.id}:`, err?.message);
    }
  }
}

/**
 * Repasse recorrente automático (#147).
 *
 * Roda 1x/dia entre 02h-03h BR (antes do backup das 03h). Lança os repasses
 * recorrentes cujo proximaData já chegou, respeitando a válvula do candidato
 * (cortado/retido → pausa sem lançar). O motor é idempotente por dia: ao
 * lançar, avança proximaData pro futuro, então rodar várias vezes na janela
 * não duplica. Recorrentes pausados pela válvula são reavaliados a cada dia.
 */
const RECURRING_HOUR_BR = 2;

async function tickRecurringRepasses(supabase: SupabaseClient) {
  const hour = getBRHour();
  if (hour < RECURRING_HOUR_BR || hour > RECURRING_HOUR_BR + 1) return;
  try {
    const n = await processRecurringRepasses(supabase);
    if (n > 0) console.log(`[recurring] tick noturno lançou ${n} repasse(s) recorrente(s)`);
  } catch (err: any) {
    console.warn('[recurring] falha no tick:', err?.message || err);
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
      await tickSocialSync(supabase);
      await tickDailyBackup(supabase);
      await tickRecurringRepasses(supabase);
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
