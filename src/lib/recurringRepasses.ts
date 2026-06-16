/**
 * Motor de Repasse Recorrente (#147).
 *
 * Roda 1x/dia (via routinesWorker). Pra cada modelo recorrente ativo cuja
 * próxima data já chegou:
 *   1. Checa a VÁLVULA do candidato (party_candidates.repasseStatus):
 *      - 'cortado' ou 'retido' → pausa (pausadoPelaValvula=true), não lança
 *      - liberado e estava pausado → despausa e processa
 *   2. Cria o repasse real em party_repasses + recalcula totais do candidato
 *   3. Avança proximaData conforme a frequência; se passar de dataFim, desativa
 *
 * Tudo best-effort: erro num recorrente não derruba os outros.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // se o mês destino não tem o dia (ex: 31), o JS rola pro mês seguinte —
  // corrige voltando pro último dia do mês alvo.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
function nextDate(iso: string, freq: string): string {
  if (freq === 'semanal') return addDays(iso, 7);
  if (freq === 'quinzenal') return addDays(iso, 14);
  return addMonths(iso, 1); // mensal
}

const BLOQUEIA_VALVULA = new Set(['cortado', 'retido']);

export async function processRecurringRepasses(supabase: SupabaseClient): Promise<number> {
  const hoje = new Date().toISOString().slice(0, 10);
  let lancados = 0;

  const { data: recs } = await supabase
    .from('party_recurring_repasses')
    .select('*')
    .eq('ativo', true)
    .lte('proximaData', hoje)
    .limit(500);
  if (!recs?.length) return 0;

  for (const r of recs as any[]) {
    try {
      // Encerrou? (passou da eleição) → desativa
      if (r.dataFim && r.proximaData > r.dataFim) {
        await supabase.from('party_recurring_repasses')
          .update({ ativo: false, updatedAt: new Date().toISOString() }).eq('id', r.id);
        continue;
      }

      // Checa válvula do candidato
      const { data: cand } = await supabase.from('party_candidates')
        .select('repasseStatus, displayName').eq('id', r.candidateId).maybeSingle();
      const status = String((cand as any)?.repasseStatus || 'liberado').toLowerCase();

      if (BLOQUEIA_VALVULA.has(status)) {
        // Válvula cortou/segurou → pausa o recorrente (não lança), avisa via flag
        if (!r.pausadoPelaValvula) {
          await supabase.from('party_recurring_repasses')
            .update({ pausadoPelaValvula: true, updatedAt: new Date().toISOString() }).eq('id', r.id);
          console.log(`[recurring] pausado pela válvula: ${(cand as any)?.displayName} (${status})`);
        }
        continue; // não avança proximaData — assim que liberar, lança no próximo tick
      }

      // Válvula liberada → se estava pausado pela válvula, despausa
      if (r.pausadoPelaValvula) {
        await supabase.from('party_recurring_repasses')
          .update({ pausadoPelaValvula: false, updatedAt: new Date().toISOString() }).eq('id', r.id);
      }

      // Lança o repasse real
      const v = Number(r.valor) || 0;
      await supabase.from('party_repasses').insert({
        partyId: r.partyId, candidateId: r.candidateId, valor: v,
        data: hoje, descricao: r.descricao ? `${r.descricao} (recorrente)` : 'Repasse recorrente',
        itens: [], createdBy: r.createdBy,
      });

      // Recalcula totais do candidato
      const { data: all } = await supabase.from('party_repasses').select('valor, itens').eq('candidateId', r.candidateId);
      const totalRecebido = (all || []).reduce((s: number, x: any) => s + Number(x.valor || 0), 0);
      const totalAlocado = (all || []).reduce((s: number, x: any) =>
        s + (Array.isArray(x.itens) ? x.itens.reduce((a: number, it: any) => a + Number(it.valor || 0), 0) : 0), 0);
      await supabase.from('party_candidates')
        .update({ valorRecebido: totalRecebido, valorAlocado: totalAlocado, updatedAt: new Date().toISOString() })
        .eq('id', r.candidateId);

      // Avança próxima data
      const prox = nextDate(r.proximaData, r.frequencia);
      const encerra = r.dataFim && prox > r.dataFim;
      await supabase.from('party_recurring_repasses').update({
        proximaData: prox,
        ativo: !encerra,
        lastRunAt: new Date().toISOString(),
        totalLancado: (Number(r.totalLancado) || 0) + 1,
        updatedAt: new Date().toISOString(),
      }).eq('id', r.id);

      lancados++;
      console.log(`[recurring] lançou R$${v} pra ${(cand as any)?.displayName} · próxima ${encerra ? 'ENCERRADO' : prox}`);
    } catch (err: any) {
      console.warn(`[recurring] falha no recorrente ${r.id}:`, err?.message);
    }
  }
  return lancados;
}
