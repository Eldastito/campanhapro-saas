import { Plan } from '../types/user';

// ============================================================
// Plano Management — Fonte única de verdade
// ============================================================
// A plataforma tem DOIS planos comercialmente: Limitado e Completo.
// Internamente mapeamos para 3 enums legados (Essencial, Estrategico, Total).

export type PlanTier = 'gratis' | 'limitado' | 'completo';

export interface PlanConfigData {
  planTier: PlanTier;
  features: string[];
  limits: {
    aiCalls: number;       // chamadas de IA/mês (0 = travado, só durante trial liberado)
    teamMembers: number;   // limite de membros operacionais
    visits: number;        // limite de visitas registradas
    whatsappPerDay: number; // disparos WhatsApp por dia POR CAMPANHA
    forms: number;          // formulários ativos
  };
}

// Mapeamento Plan (user-level enum) → PlanTier (feature access)
export const PLAN_TO_TIER: Record<Plan, PlanTier> = {
  [Plan.GRATIS]: 'gratis',
  [Plan.ESSENCIAL]: 'limitado',
  [Plan.ESTRATEGICO]: 'limitado',
  [Plan.TOTAL]: 'completo',
};

// Features de cada tier — keys usadas no featureToTabMap em CampaignWebApp.
// Convenção: -1 = ILIMITADO (quotaEnforcer trata < 0 como bypass do gate).
// Source of truth comercial é a tabela `plans` no banco; este TIER_CONFIG é o
// MAPA DEFAULT usado quando uma campanha não tem plano sincronizado ainda
// (ensureCampaignConfig). Os limites espelham `plans` para não divergir.
export const TIER_CONFIG: Record<PlanTier, PlanConfigData> = {
  gratis: {
    planTier: 'gratis',
    // Plano grátis: foco em COLETA (gera lead p/ IA aprender). Equipe e
    // contatos livres (não oneram a plataforma e trazem mais leads). IA
    // travada (só durante trial). Sem WhatsApp — isca do upgrade pro 10k.
    features: ['dashboard', 'crm', 'visits', 'team', 'forms', 'engagement', 'help'],
    limits: { aiCalls: 0, teamMembers: -1, visits: -1, whatsappPerDay: 0, forms: -1 }
  },
  limitado: {
    planTier: 'limitado',
    features: ['dashboard', 'visits', 'team', 'help'],
    limits: { aiCalls: 100, teamMembers: -1, visits: -1, whatsappPerDay: 1000, forms: -1 }
  },
  completo: {
    planTier: 'completo',
    features: [
      'dashboard', 'ai_agents', 'visits', 'team',
      'financial', 'engagement', 'reports', 'tools',
      'resources', 'crm', 'demonstration', 'analytics',
      'election_day'
    ],
    limits: { aiCalls: -1, teamMembers: -1, visits: -1, whatsappPerDay: -1, forms: -1 }
  }
};

export function getPlanConfig(plan: Plan): PlanConfigData {
  return {
    planTier: PLAN_TO_TIER[plan],
    features: PLAN_FEATURES[plan],
    limits: TIER_CONFIG[PLAN_TO_TIER[plan]].limits,
  };
}

// ============================================================
// Módulos por plano (3 tiers reais) — alinhado à tabela `plans`.
// São FEATURE KEYS (não nomes de aba). Cada plano superior inclui os
// módulos dos inferiores. Total = planTier 'completo' (vê tudo).
// ============================================================
// PLANO GRÁTIS — isca de conversão. Estratégia:
// • LIBERA: o que gera lead (CRM, formulários, equipe, visitas, engajamento básico).
// • TRAVA: IA (ai_agents, intelligence, scenarios, content_studio, rag, paperclip),
//          Dia D (election_day - gatilho de venda na reta final),
//          Financeiro, Analytics avançado, Reuniões com transcrição,
//          Orquestrador, Compliance, Budget CEO.
// • Cotas duras: 100 WhatsApp/dia POR CAMPANHA, 10 membros, 5 forms, 0 IA.
const GRATIS_FEATURES = [
  'dashboard', 'crm', 'help', 'visits', 'team', 'engagement', 'forms', 'resources',
];

// Essencial 10k: ganha Caixa de Entrada Omnichannel (sem bot IA, sem Call Center
// — a dor de atender msgs na mão sem IA é o gatilho de upgrade pro 15k/20k).
// Cap de 1.000 msgs/mês no banco (plans.limits.messages_per_month).
const ESSENCIAL_FEATURES = [
  'dashboard', 'crm', 'help', 'visits', 'team', 'engagement',
  'resources', 'goals', 'routines', 'ai_agents', 'forms',
  'whatsapp_omnichannel',
];
// Estratégico 15k: ganha Call Center (Receptivo + Áreas + Telemarketing Ativo
// + Relatórios) + 10x mais mensagens. Bot IA do Atendimento ainda gated — dor =
// "atendentes humanos respondendo, quero IA fazendo o trabalho" → 20k.
const ESTRATEGICO_FEATURES = [
  ...ESSENCIAL_FEATURES,
  'analytics', 'financial', 'content_studio', 'rag', 'meetings',
  'tools', 'training', 'call_center',
];
const TOTAL_FEATURES = [
  ...ESTRATEGICO_FEATURES,
  'election_day', 'intelligence', 'scenarios', 'budget_ceo', 'paperclip', 'compliance',
];

export const PLAN_FEATURES: Record<Plan, string[]> = {
  [Plan.GRATIS]: GRATIS_FEATURES,
  [Plan.ESSENCIAL]: ESSENCIAL_FEATURES,
  [Plan.ESTRATEGICO]: ESTRATEGICO_FEATURES,
  [Plan.TOTAL]: TOTAL_FEATURES,
};

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

  // 2. Upsert campaign_configs com todos os campos derivados.
  //    planTier 'completo' (Total) libera tudo; 'limitado' gateia por features.
  //    limits em snake_case pra casar com o schema do banco.
  const { error: cfgErr } = await supabase
    .from('campaign_configs')
    .upsert({
      id: campaignId,
      planTier: config.planTier,
      features: config.features,
      limits: {
        ai_calls: config.limits.aiCalls,
        team_members: config.limits.teamMembers,
        visits: config.limits.visits,
        whatsapp_per_day: config.limits.whatsappPerDay,
        forms: config.limits.forms,
      },
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
  plan: Plan = Plan.GRATIS  // default agora é GRATIS — novos cadastros entram travados até pagar
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
