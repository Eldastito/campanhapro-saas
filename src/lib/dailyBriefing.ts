/**
 * Briefing Diário — gatilho AGENDADO que olha para DENTRO da plataforma.
 *
 * Diferente do Monitoramento Proativo (que vasculha a INTERNET por menções/ataques),
 * o Briefing Diário aciona o Orquestrador 1x/dia para ANALISAR os dados inseridos
 * na plataforma (visitas, novos contatos, pesquisas, funil, atividade da equipe) e
 * DELEGAR tarefas aos agentes — fechando o ciclo "dados do dia → ação".
 *
 * Gatilho: campaign.dailyBriefingEnabled = true e passou >20h da última execução,
 * disparando preferencialmente no começo da manhã (horário de Brasília).
 *
 * setInterval (não pg_cron) pelos mesmos motivos do proactiveMonitor: zero infra,
 * e last_run garante que nada é perdido em restart — só pode atrasar.
 */
import { runManager } from './managerAgent';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // varre a cada 30 min
const MIN_HOURS_BETWEEN = 20;             // ~1x/dia
let timer: NodeJS.Timeout | null = null;

interface CampaignRow {
  id: string;
  name: string;
  electionRole: string | null;
  electionCity: string | null;
  electionState: string | null;
  dailyBriefingLastRunAt: string | null;
}

const buildIntent = (c: CampaignRow): string => {
  const local = [c.electionCity, c.electionState].filter(Boolean).join('/') || 'a região da campanha';
  return `BRIEFING DIÁRIO — ANÁLISE INTERNA (rotina automática 1x/dia).

Analise o ESTADO ATUAL da operação da campanha de "${c.name || 'o candidato'}" em ${local} usando os dados REAIS da plataforma. Delegue aos especialistas para que cada um use suas ferramentas:
- Comandante de Campo (call_field): use analyze_territorial_gap e get_team_activity — onde estamos parados? quais bairros sub-atendidos? quais líderes inativos?
- CRM (call_crm): use get_conversion_funnel — onde o funil está travando? que segmento priorizar?
- Estrategista (call_strategist): consolide e use get_competitive_intel — qual a prioridade do dia e por quê?

Com base nisso, no FINALIZE entregue:
1. **Diagnóstico do dia** (3-5 bullets do que os dados mostram)
2. **Ações delegadas** (lista: quem faz / o quê / em qual bairro/segmento / métrica)
3. **1 alerta** se algo estiver em risco (meta, inatividade, gap crítico)

Publique os achados mais importantes no war room (call_strategist com 'publicar insight'). Seja eficiente: máximo 3 rodadas. Se não houver dados suficientes, finalize dizendo que faltam dados e o que cadastrar.`;
};

const runOnce = async (supabaseAdmin: any) => {
  if (!supabaseAdmin) return;
  try {
    const { data: campaigns, error } = await supabaseAdmin
      .from('campaigns')
      .select('id, name, "electionRole", "electionCity", "electionState", "dailyBriefingLastRunAt"')
      .eq('dailyBriefingEnabled', true);
    if (error || !campaigns || campaigns.length === 0) return;

    const now = Date.now();
    const hourBR = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()));

    for (const c of campaigns as CampaignRow[]) {
      const lastRun = c.dailyBriefingLastRunAt ? new Date(c.dailyBriefingLastRunAt).getTime() : 0;
      const hoursSince = (now - lastRun) / 3_600_000;
      // Roda se passou >20h E estamos no começo do dia (7h-10h BR), ou se já
      // passou muito tempo (>26h) independentemente do horário (catch-up).
      const due = hoursSince >= MIN_HOURS_BETWEEN && ((hourBR >= 7 && hourBR <= 10) || hoursSince >= 26);
      if (!due) continue;

      console.log(`[DailyBriefing] Disparando p/ campanha ${c.id} (último: ${c.dailyBriefingLastRunAt || 'nunca'})`);
      await supabaseAdmin.from('campaigns')
        .update({ dailyBriefingLastRunAt: new Date().toISOString() })
        .eq('id', c.id);

      try {
        const result = await runManager({ supabaseAdmin, campaignId: c.id, userId: null, intent: buildIntent(c) });
        console.log(`[DailyBriefing] OK ${c.id}: status=${result.status} cost=$${(result.totalCostCents / 100).toFixed(3)} iter=${result.iterations}`);
      } catch (runErr: any) {
        console.error(`[DailyBriefing] FALHA ${c.id}:`, runErr?.message || runErr);
      }
    }
  } catch (err: any) {
    console.error('[DailyBriefing] erro no varredor:', err?.message || err);
  }
};

export const startDailyBriefing = (supabaseAdmin: any) => {
  if (!supabaseAdmin) { console.log('[DailyBriefing] supabaseAdmin ausente — desabilitado.'); return; }
  if (timer) clearInterval(timer);
  console.log(`[DailyBriefing] iniciado — varredura a cada ${CHECK_INTERVAL_MS / 60_000} min.`);
  setTimeout(() => runOnce(supabaseAdmin), 60_000);
  timer = setInterval(() => runOnce(supabaseAdmin), CHECK_INTERVAL_MS);
};

export const stopDailyBriefing = () => {
  if (timer) { clearInterval(timer); timer = null; console.log('[DailyBriefing] parado.'); }
};
