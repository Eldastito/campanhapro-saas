import { SupabaseClient } from '@supabase/supabase-js';
import { CampaignSnapshot } from '../server/modules/integrations/campanhaproCenariosClient';

/**
 * Builds a campanhapro.snapshot.v1 payload from live Supabase data.
 * Designed to run server-side with the admin client.
 */
export async function buildCampaignSnapshot(
  supabase: SupabaseClient,
  campaignId: string
): Promise<CampaignSnapshot> {
  const [visitsRes, teamRes, pesquisasRes, engagementsRes, incomesRes, expensesRes] =
    await Promise.all([
      supabase
        .from('visits')
        .select('id, bairro, municipio, lider, realizada, votos, createdAt')
        .eq('campaignId', campaignId),
      supabase
        .from('users')
        .select('id, type, neighborhood, municipio')
        .eq('campaignId', campaignId),
      supabase
        .from('pesquisas')
        .select('id, intencaoVoto, bairro, createdAt')
        .eq('campaignId', campaignId),
      supabase
        .from('contact_interactions')
        .select('id, type, contactId, createdAt')
        .eq('campaignId', campaignId),
      supabase
        .from('financials')
        .select('amount, category, date')
        .eq('campaignId', campaignId)
        .eq('type', 'income'),
      supabase
        .from('financials')
        .select('amount, category, date')
        .eq('campaignId', campaignId)
        .eq('type', 'expense'),
    ]);

  const totalIncome = (incomesRes.data || []).reduce(
    (sum: number, r: any) => sum + (Number(r.amount) || 0),
    0
  );
  const totalExpenses = (expensesRes.data || []).reduce(
    (sum: number, r: any) => sum + (Number(r.amount) || 0),
    0
  );

  return {
    schemaVersion: 'campanhapro.snapshot.v1',
    campaignId,
    generatedAt: new Date().toISOString(),
    visits: visitsRes.data || [],
    teamMembers: teamRes.data || [],
    pesquisas: pesquisasRes.data || [],
    engagements: engagementsRes.data || [],
    financialSummary: {
      totalIncome,
      totalExpenses,
      balance: totalIncome - totalExpenses,
    },
  };
}
