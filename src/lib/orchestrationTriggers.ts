/**
 * Gatilhos do Orquestrador.
 *
 * Ponto de entrada único e SEGURO para qualquer gatilho (evento ou agendamento)
 * acionar o Agente Orquestrador (runManager) em segundo plano, sem bloquear o
 * fluxo que o disparou e sem derrubar o request em caso de erro.
 *
 * Tipos de gatilho hoje:
 *  - schedule: proactiveMonitor (defesa de imagem, a cada X horas) — já existente
 *  - event:    fireOrchestration() chamado por eventos (ex.: novo dossiê salvo)
 *
 * Controle de custo: quem dispara é responsável por decidir SE deve disparar
 * (ex.: só para campanhas com IA proativa habilitada). Aqui só executamos.
 */
import { runManager } from './managerAgent';

export interface FireOrchestrationOpts {
  campaignId: string;
  intent: string;
  /** Origem do gatilho (vai para o log) — ex.: 'intel_dossier_saved'. */
  source: string;
  userId?: string | null;
}

/**
 * Dispara o orquestrador em BACKGROUND (fire-and-forget). Retorna imediatamente.
 * Erros são logados, nunca propagados — um gatilho não pode quebrar o fluxo
 * que o originou.
 */
export function fireOrchestration(supabaseAdmin: any, opts: FireOrchestrationOpts): void {
  if (!supabaseAdmin || !opts.campaignId || !opts.intent) return;
  void (async () => {
    try {
      console.log(`[trigger:${opts.source}] disparando orquestrador p/ campanha ${opts.campaignId}`);
      const r = await runManager({
        supabaseAdmin,
        campaignId: opts.campaignId,
        userId: opts.userId ?? null,
        intent: opts.intent,
        source: opts.source,
      });
      console.log(`[trigger:${opts.source}] ok status=${r.status} cost=$${(r.totalCostCents / 100).toFixed(3)} iter=${r.iterations}`);
    } catch (e: any) {
      console.error(`[trigger:${opts.source}] falha:`, e?.message || e);
    }
  })();
}
