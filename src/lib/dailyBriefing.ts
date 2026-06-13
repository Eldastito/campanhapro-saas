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

/**
 * Coleta sumário das últimas 24h: visitas, engajamentos, novos contatos.
 * Vai como dado PRÉ-MASTIGADO no intent, dando ao manager pretexto pra
 * drillar com as tools. Sem isso, briefings eram genéricos ("analise o dia")
 * porque o LLM não sabia o que tinha mudado.
 */
async function fetchDailyDelta(supabaseAdmin: any, campaignId: string) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  try {
    const [visitsR, engR, contactsR, blastsR] = await Promise.all([
      supabaseAdmin.from('visits')
        .select('id, bairro, realizada, votos', { count: 'exact', head: false })
        .eq('campaignId', campaignId).gte('createdAt', since).limit(2000),
      supabaseAdmin.from('engagement_actions')
        .select('id, tipo, sentimento, "novosApoiadores", "contatosColetados"')
        .eq('campaignId', campaignId).gte('createdAt', since).limit(1000),
      supabaseAdmin.from('contacts')
        .select('id, supportLevel, neighborhood', { count: 'exact', head: false })
        .eq('campaignId', campaignId).gte('createdAt', since).limit(2000),
      supabaseAdmin.from('whatsapp_blasts')
        .select('id, sent, failed').eq('campaignId', campaignId).gte('createdAt', since).limit(50),
    ]);
    const visits = (visitsR.data ?? []) as any[];
    const eng = (engR.data ?? []) as any[];
    const contacts = (contactsR.data ?? []) as any[];
    const blasts = (blastsR.data ?? []) as any[];

    const visitsRealizadas = visits.filter(v => v.realizada).length;
    const votosCaptados = visits.reduce((s, v) => s + (Number(v.votos) || 0), 0);
    const topBairrosVisitas = Object.entries(
      visits.reduce<Record<string, number>>((acc, v) => {
        const b = String(v.bairro || '').trim(); if (b) acc[b] = (acc[b] || 0) + 1; return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b, n]) => `${b}(${n})`).join(', ');

    const engPorTipo = eng.reduce<Record<string, number>>((acc, e) => {
      const t = String(e.tipo || 'outro'); acc[t] = (acc[t] || 0) + 1; return acc;
    }, {});
    const novosApoiadoresEng = eng.reduce((s, e) => s + (Number(e.novosApoiadores) || 0), 0);

    const novosApoiadoresCRM = contacts.filter((c: any) =>
      c.supportLevel === 'apoiador' || c.supportLevel === 'multiplicador').length;

    const blastsTotal = blasts.reduce((s, b) => s + (Number(b.sent) || 0), 0);
    const blastsFalha = blasts.reduce((s, b) => s + (Number(b.failed) || 0), 0);

    return {
      hasData: visits.length + eng.length + contacts.length + blasts.length > 0,
      summary:
        `- Visitas registradas: ${visits.length} (realizadas: ${visitsRealizadas}, votos estimados: ${votosCaptados})` +
        (topBairrosVisitas ? ` — top bairros: ${topBairrosVisitas}` : '') + '\n' +
        `- Ações de campo: ${eng.length}` +
        (Object.keys(engPorTipo).length ? ` — tipos: ${Object.entries(engPorTipo).map(([t, n]) => `${t}(${n})`).join(', ')}` : '') +
        (novosApoiadoresEng > 0 ? ` — novos apoiadores reportados: ${novosApoiadoresEng}` : '') + '\n' +
        `- Novos contatos no CRM: ${contacts.length}` +
        (novosApoiadoresCRM > 0 ? ` (${novosApoiadoresCRM} classificados como apoiador/multiplicador)` : '') + '\n' +
        (blasts.length > 0 ? `- WhatsApp blasts: ${blastsTotal} enviadas, ${blastsFalha} falhas\n` : ''),
    };
  } catch (e: any) {
    console.warn('[DailyBriefing] fetchDailyDelta falhou:', e?.message);
    return { hasData: false, summary: '' };
  }
}

const buildIntent = (c: CampaignRow, delta: { hasData: boolean; summary: string }): string => {
  const local = [c.electionCity, c.electionState].filter(Boolean).join('/') || 'a região da campanha';
  return `BRIEFING DIÁRIO — ANÁLISE INTERNA (rotina automática 1x/dia).

Campanha de "${c.name || 'o candidato'}" em ${local}.

${delta.hasData
  ? `📊 ATIVIDADE DAS ÚLTIMAS 24H:\n${delta.summary}\n`
  : `⚠️ NENHUMA atividade registrada nas últimas 24h.\n`}
Use os dados acima como ponto de partida e delegue aos especialistas:
- Comandante de Campo (call_field): use analyze_territorial_gap e get_team_activity — quais bairros sub-atendidos vs onde a equipe foi? quais líderes inativos?
- CRM (call_crm): use get_conversion_funnel — onde o funil está travando? que segmento priorizar com os novos contatos?
- Estrategista (call_strategist): consolide e use get_competitive_intel — qual a prioridade do dia e por quê?

No FINALIZE entregue:
1. **Diagnóstico do dia** (3-5 bullets do que os dados mostram — compare com a memória RAG se houver briefing anterior)
2. **Ações delegadas** (lista: quem faz / o quê / em qual bairro/segmento / métrica)
3. **1 alerta** se algo estiver em risco (meta, inatividade, gap crítico)

Publique os achados mais importantes no war room (call_strategist com 'publicar insight'). Máximo 3 rodadas. Se não houver dados suficientes, finalize dizendo que faltam dados e o que cadastrar.`;
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
        const delta = await fetchDailyDelta(supabaseAdmin, c.id);
        const result = await runManager({ supabaseAdmin, campaignId: c.id, userId: null, intent: buildIntent(c, delta) });
        console.log(`[DailyBriefing] OK ${c.id}: status=${result.status} cost=$${(result.totalCostCents / 100).toFixed(3)} iter=${result.iterations} hasData=${delta.hasData}`);
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
