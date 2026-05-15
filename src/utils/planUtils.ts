import { Plan } from '../types/user';

// ============================================================
// Plano Management — Fonte única de verdade
// ============================================================
// A plataforma tem DOIS planos comercialmente: Limitado e Completo.
// Internamente mapeamos para 3 enums legados (Essencial, Estrategico, Total).

export type PlanTier = 'limitado' | 'completo';

export interface PlanConfigData {
  planTier: PlanTier;
  features: string[];
  limits: {
    aiCalls: number;
    teamMembers: number;
    visits: number;
  };
}

// Mapeamento Plan (user-level enum) → PlanTier (feature access)
export const PLAN_TO_TIER: Record<Plan, PlanTier> = {
  [Plan.ESSENCIAL]: 'limitado',
  [Plan.ESTRATEGICO]: 'limitado',
  [Plan.TOTAL]: 'completo',
};

// Features de cada tier — keys usadas no featureToTabMap em CampaignWebApp
export const TIER_CONFIG: Record<PlanTier, PlanConfigData> = {
  limitado: {
    planTier: 'limitado',
    features: ['dashboard', 'visits', 'team', 'help'],
    limits: { aiCalls: 100, teamMembers: 50, visits: 1000 }
  },
  completo: {
    planTier: 'completo',
    features: [
      'dashboard', 'ai_agents', 'visits', 'team',
      'financial', 'engagement', 'reports', 'tools',
      'resources', 'crm', 'demonstration', 'analytics',
      'election_day'
    ],
    limits: { aiCalls: 999999, teamMembers: 999999, visits: 999999 }
  }
};

export function getPlanConfig(plan: Plan): PlanConfigData {
  return TIER_CONFIG[PLAN_TO_TIER[plan]];
}

/**
 * Sincroniza mudança de plano entre users.plan e campaign_configs.
 * Use este método em QUALQUER lugar que alterar o plano de um usuário.
 */
export async function syncPlanForCampaign(
  supabase: any,
  userId: string,
  campaignId: string,
  plan: Plan
): Promise<void> {
  const config = getPlanConfig(plan);

  // 1. Atualiza users.plan
  const { error: userErr } = await supabase
    .from('users')
    .update({ plan })
    .eq('id', userId);

  if (userErr) throw new Error(`Falha ao atualizar users.plan: ${userErr.message}`);

  // 2. Upsert campaign_configs com todos os campos derivados
  const { error: cfgErr } = await supabase
    .from('campaign_configs')
    .upsert({
      id: campaignId,
      features: config.features,
      limits: config.limits,
      status: 'active',
    }, { onConflict: 'id' });

  if (cfgErr) throw new Error(`Falha ao atualizar campaign_configs: ${cfgErr.message}`);
}

/**
 * Garante que exista um registro em campaign_configs para a campanha dada.
 * Chamado quando um novo usuário se registra.
 */
export async function ensureCampaignConfig(
  supabase: any,
  campaignId: string,
  plan: Plan = Plan.ESSENCIAL
): Promise<void> {
  if (!campaignId) return;

  const { data: existing } = await supabase
    .from('campaign_configs')
    .select('id')
    .eq('id', campaignId)
    .maybeSingle();

  if (!existing) {
    const config = getPlanConfig(plan);
    await supabase.from('campaign_configs').insert({
      id: campaignId,
      features: config.features,
      limits: config.limits,
      status: 'active',
    });
  }
}
