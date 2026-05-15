/**
 * Monitor proativo de defesa de imagem.
 *
 * A cada `CHECK_INTERVAL_MS` o módulo varre as campanhas com
 * `proactive_monitoring_enabled = true` e dispara o Manager Agent
 * com uma intent fixa de monitoramento web (web_search nativo do Anthropic).
 *
 * Gatilho:  campaign.proactive_monitoring_last_run_at < now() - intervalHours
 * Resultado: vira insight em war_room_intelligence + manager_run logado.
 *
 * Por que setInterval (e não pg_cron):
 *  - Zero infra externa, basta o server tar de pé
 *  - Trade-off: restart do server zera o relógio do interval (mas a próxima
 *    janela é detectada via last_run_at, então nada é perdido — só atrasa)
 *  - Pra escalar futuro: substituir por Supabase pg_cron + Edge Function
 */
import { runManager } from './managerAgent';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // varre o banco a cada 30 min

let timer: NodeJS.Timeout | null = null;

interface CampaignRow {
    id: string;
    proactive_monitoring_interval_hours: number;
    proactive_monitoring_last_run_at: string | null;
    proactive_monitoring_keywords: string | null;
    election_role: string | null;
    election_state: string | null;
    election_city: string | null;
    candidate_number: string | null;
    name: string;
}

const buildIntent = (c: CampaignRow): string => {
    const target = c.name || '(candidato sem nome cadastrado)';
    const cargo = c.election_role || '(cargo não cadastrado)';
    const local = [c.election_city, c.election_state].filter(Boolean).join('/') || '(localização não cadastrada)';
    const numero = c.candidate_number ? ` (nº ${c.candidate_number})` : '';
    const extras = c.proactive_monitoring_keywords?.trim();
    const horas = c.proactive_monitoring_interval_hours || 6;
    return `MONITORAMENTO PROATIVO — DEFESA DE IMAGEM (rotina automática a cada ${horas}h).

Faça uma busca web (use a ferramenta web_search) sobre menções, notícias e movimentos políticos relacionados ao candidato "${target}"${numero} para o cargo de ${cargo} em ${local}, considerando preferencialmente eventos das ÚLTIMAS ${horas} HORAS.

${extras ? `Termos extras a considerar: ${extras}\n\n` : ''}Identifique e classifique:
1. **Notícias/manchetes** em portais regionais ou nacionais (positivas, neutras, negativas)
2. **Comentários ou postagens em ascensão** em redes sociais (Instagram, X, TikTok, Facebook)
3. **Movimentos de adversários**: novas pautas, eventos, ataques diretos ou indiretos
4. **Sinais de fake news ou crise iminente**: acusações, vídeos descontextualizados, hashtags hostis

Para CADA achado relevante, publique um insight no war_room_intelligence chamando call_strategist com a tarefa "publicar insight no war room sobre: [descrição]" e indique priority:
- 'CRÍTICO' se for crise iminente / fake news viralizando
- 'Alta' se for ataque direto ou narrativa hostil ascendente
- 'Media' se for movimento de adversário ou notícia neutra/negativa
- 'Baixa' se for menção positiva ou contexto informativo

Se NADA relevante for encontrado, finalize com summary "Sem alertas no período monitorado." (não chame agentes desnecessariamente).

Esta é uma rotina automática — seja eficiente, máximo 4 rodadas.`;
};

const runOnce = async (supabaseAdmin: any) => {
    if (!supabaseAdmin) return;
    try {
        // Busca campanhas com monitoramento ativo cuja janela de execução chegou.
        const { data: campaigns, error } = await supabaseAdmin
            .from('campaigns')
            .select('id, name, election_role, election_state, election_city, candidate_number, proactive_monitoring_interval_hours, proactive_monitoring_last_run_at, proactive_monitoring_keywords')
            .eq('proactive_monitoring_enabled', true);

        if (error || !campaigns || campaigns.length === 0) return;

        const now = Date.now();
        for (const c of campaigns as CampaignRow[]) {
            const intervalMs = (c.proactive_monitoring_interval_hours || 6) * 60 * 60 * 1000;
            const lastRun = c.proactive_monitoring_last_run_at ? new Date(c.proactive_monitoring_last_run_at).getTime() : 0;
            const due = !lastRun || now - lastRun >= intervalMs;
            if (!due) continue;

            console.log(`[ProactiveMonitor] Disparando monitoramento p/ campanha ${c.id} (último: ${c.proactive_monitoring_last_run_at || 'nunca'})`);
            // Marca timestamp ANTES de rodar (evita re-disparo se Manager demorar).
            await supabaseAdmin.from('campaigns')
                .update({ proactive_monitoring_last_run_at: new Date().toISOString() })
                .eq('id', c.id);

            try {
                const result = await runManager({
                    supabaseAdmin,
                    campaignId: c.id,
                    userId: null, // disparado pelo sistema (não usuário humano)
                    intent: buildIntent(c),
                });
                console.log(`[ProactiveMonitor] OK campanha ${c.id}: status=${result.status} cost=$${(result.totalCostCents/100).toFixed(3)} iter=${result.iterations}`);
            } catch (runErr: any) {
                console.error(`[ProactiveMonitor] FALHA campanha ${c.id}:`, runErr?.message || runErr);
            }
        }
    } catch (err: any) {
        console.error('[ProactiveMonitor] erro inesperado no varredor:', err?.message || err);
    }
};

export const startProactiveMonitor = (supabaseAdmin: any) => {
    if (!supabaseAdmin) {
        console.log('[ProactiveMonitor] supabaseAdmin ausente — monitor desabilitado.');
        return;
    }
    if (timer) clearInterval(timer);
    console.log(`[ProactiveMonitor] iniciado — varredura a cada ${CHECK_INTERVAL_MS / 60_000} min.`);

    // Roda uma vez 30s após o boot (dá tempo do server estabilizar)
    setTimeout(() => runOnce(supabaseAdmin), 30_000);
    // Depois: varre a cada CHECK_INTERVAL_MS
    timer = setInterval(() => runOnce(supabaseAdmin), CHECK_INTERVAL_MS);
};

export const stopProactiveMonitor = () => {
    if (timer) {
        clearInterval(timer);
        timer = null;
        console.log('[ProactiveMonitor] parado.');
    }
};
