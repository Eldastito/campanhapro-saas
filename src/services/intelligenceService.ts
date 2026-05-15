import { supabase } from '../lib/supabaseClient';

/**
 * Serviço de Inteligência Estratégica
 * Consolida dados para as "Victory Skills" dos agentes de IA.
 */

export interface FunnelStats {
  stage: string;
  count: number;
}

export interface TerritorialGap {
  neighborhood: string;
  visits: number;
  potential_votes: number;
  gap_percentage: number;
  risk_level: 'Low' | 'Medium' | 'High' | 'Critical';
}

/**
 * Obtém estatísticas do funil de conversão para a campanha.
 */
export async function getConversionFunnelStats(campaignId: string): Promise<FunnelStats[]> {
  try {
    const { data, error } = await supabase
      .from('voter_journey')
      .select('currentStage')
      .eq('campaignId', campaignId);

    if (error) throw error;

    const stages = [
      'capturado',
      'contato_validado',
      'interessado',
      'apoiador_confirmado',
      'multiplicador'
    ];

    const stats = stages.map(stage => ({
      stage,
      count: data?.filter((d: any) => d.currentStage === stage).length || 0
    }));

    return stats;
  } catch (error) {
    console.error("Erro ao buscar estatísticas do funil:", error);
    return [];
  }
}

/**
 * Analisa gaps territoriais (Visitas vs Potencial Estimado)
 * Nota: O potencial estimado é baseado no cenário ideal da calculadora.
 */
export async function getTerritorialAlerts(campaignId: string): Promise<TerritorialGap[]> {
  try {
    // 1. Pegar visitas por bairro
    const { data: visitsData, error: vError } = await supabase
      .from('visits')
      .select('bairro')
      .eq('campaignId', campaignId)
      .eq('realizada', 'sim');

    if (vError) throw vError;

    // 2. Pegar bairros e metas (exemplo simplificado)
    // Em uma versão real, cruzaríamos com dados de seções eleitorais
    const neighborhoodCounts: Record<string, number> = {};
    visitsData?.forEach((v: any) => {
      if (v.bairro) {
        neighborhoodCounts[v.bairro] = (neighborhoodCounts[v.bairro] || 0) + 1;
      }
    });

    // Simulação de meta (Ex: 100 visitas por bairro relevante)
    const alerts: TerritorialGap[] = Object.entries(neighborhoodCounts).map(([name, count]) => {
      const target = 100; // Mock target
      const gap = Math.max(0, 100 - ( (count / target) * 100 ));
      
      return {
        neighborhood: name,
        visits: count,
        potential_votes: 1000, // Mock potential
        gap_percentage: gap,
        risk_level: gap > 80 ? 'Critical' : gap > 50 ? 'High' : gap > 20 ? 'Medium' : 'Low'
      };
    });

    return alerts.sort((a, b) => b.gap_percentage - a.gap_percentage);
  } catch (error) {
    console.error("Erro ao analisar gaps territoriais:", error);
    return [];
  }
}
