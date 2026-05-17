import { supabase } from '../lib/supabaseClient';

export interface LeaderStat {
  name: string;
  total_contacts: number;
  conversions: number; // Indeciso -> Apoiador ou Multiplicador
  conversion_rate: number;
}

export interface EngagementTask {
  id: string;
  contact_name: string;
  contact_phone: string;
  neighborhood: string;
  nba: string;
  reason: string;
}

/**
 * Obtém estatísticas de conversão por líder da equipe.
 */
export async function getLeaderConversionStats(campaignId: string): Promise<LeaderStat[]> {
  try {
    // 1. Buscar as visitas para associar contatos aos líderes
    const { data: visits, error: visitsError } = await supabase
      .from('visits')
      .select('voterId, lider')
      .eq('campaignId', campaignId);

    if (visitsError) throw visitsError;

    // 2. Buscar as jornadas dos eleitores para ver o estágio de conversão
    const { data: journeys, error: journeysError } = await supabase
      .from('voter_journey')
      .select('contactId, currentStage')
      .eq('campaignId', campaignId);

    if (journeysError) throw journeysError;

    // 3. Mapear estágios por contato para acesso rápido
    const stageMap: Record<string, string> = {};
    journeys?.forEach((j: any) => {
      stageMap[j.contactId] = j.currentStage;
    });

    // 4. Calcular estatísticas por líder
    const leaderMap: Record<string, { total: number; converted: number }> = {};

    // Usar um Set para evitar contar o mesmo contato múltiplas vezes para o mesmo líder nas estatísticas de conversão
    const trackedPairs = new Set<string>();

    visits?.forEach((v: any) => {
      if (!v.voterId) return;
      const leaderName = v.lider || 'Sem Líder';
      const pairKey = `${leaderName}-${v.voterId}`;
      
      if (!trackedPairs.has(pairKey)) {
        if (!leaderMap[leaderName]) leaderMap[leaderName] = { total: 0, converted: 0 };
        leaderMap[leaderName].total += 1;
        
        const stage = stageMap[v.voterId];
        if (stage === 'apoiador_confirmado' || stage === 'multiplicador') {
          leaderMap[leaderName].converted += 1;
        }
        trackedPairs.add(pairKey);
      }
    });

    return Object.entries(leaderMap).map(([name, stats]) => ({
      name,
      total_contacts: stats.total,
      conversions: stats.converted,
      conversion_rate: stats.total > 0 ? (stats.converted / stats.total) * 100 : 0
    })).sort((a, b) => b.conversions - a.conversions);
  } catch (error) {
    console.error("Erro ao calcular estatísticas de líderes:", error);
    return [];
  }
}

/**
 * Gera tarefas de engajamento baseadas nas NBAs pendentes mais críticas.
 */
export async function generateEngagementTasks(campaignId: string): Promise<EngagementTask[]> {
  try {
    const { data, error } = await supabase
      .from('contacts')
      .select(`
        id,
        name,
        phone,
        neighborhood,
        voter_journey (
          currentStage,
          nextBestAction,
          nextActionReason
        )
      `)
      .eq('campaignId', campaignId)
      .not('voter_journey', 'is', null);

    if (error) throw error;

    // Filtrar contatos que têm uma NBA e não são multiplicadores ainda
    const tasks = data
      ?.filter((c: any) => {
        const journey = c.voter_journey?.[0];
        return journey && journey.nextBestAction && journey.currentStage !== 'multiplicador';
      })
      .map((c: any) => ({
        id: c.id,
        contact_name: c.name,
        contact_phone: c.phone,
        neighborhood: c.neighborhood,
        nba: c.voter_journey[0].nextBestAction,
        reason: c.voter_journey[0].nextActionReason
      }))
      .slice(0, 5); // Mostrar apenas as 5 mais prioritárias

    return tasks || [];
  } catch (error) {
    console.error("Erro ao gerar tarefas de engajamento:", error);
    return [];
  }
}
