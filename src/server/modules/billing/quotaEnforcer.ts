/**
 * Enforcement de cotas do plano GRATIS (e cotas duras dos pagos).
 *
 * Fonte da verdade: campaign_configs.limits (JSON com blasts_per_month, forms,
 * ai_calls, team_members, visits). Quando o cliente bate na cota:
 *   - Disparos em massa POR MÊS → bloqueia disparo até o 1º do mês seguinte.
 *     Conta APENAS blast_recipients — não conta Caixa de Entrada, Call Center
 *     nem bot IA.
 *   - Formulários ativos → bloqueia criação acima do limite.
 *   - IA calls → bloqueia chamadas se aiCalls=0 (a menos que trial 24h esteja
 *     ativo — flag em campaign_configs.aiTrial).
 *
 * Cada bloqueio retorna o motivo PADRONIZADO p/ o frontend mostrar o modal
 * "Veja o que perderia" com call-to-action de upgrade.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface QuotaCheckResult {
  ok: boolean;
  reason?: 'quota_exceeded' | 'feature_locked' | 'no_config';
  feature?: string;          // 'whatsapp_blast' | 'forms' | 'ai_calls' | ...
  used?: number;
  limit?: number;
  resetAt?: string;          // ISO — quando a cota reseta (próximo dia/mês)
  planTier?: string;         // 'gratis' | 'limitado' | 'completo'
  upgradeMessage?: string;   // texto pronto pro frontend exibir
}

/** Lê config + limites da campanha. Inclui trial de IA, se ativo. */
async function loadCampaignConfig(supabase: SupabaseClient, campaignId: string) {
  const { data } = await supabase
    .from('campaign_configs')
    .select('"planTier", features, limits, "aiTrialUntil", "aiTrialUsed"')
    .eq('id', campaignId)
    .maybeSingle();
  return data as any | null;
}

/**
 * Conta os disparos EM MASSA do mês corrente pra essa campanha (UTC).
 * blast_recipients = uma linha por destinatário; campaignId vem da tabela.
 *
 * IMPORTANTE: isto NÃO conta mensagens recebidas, nem respostas individuais
 * da Caixa de Entrada, nem mensagens do bot/IA, nem do Call Center. Conta
 * apenas o que o cliente dispara via /api/v1/whatsapp/blast.
 */
async function countBlastsThisMonth(supabase: SupabaseClient, campaignId: string): Promise<number> {
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from('blast_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaignId', campaignId)
    .gte('createdAt', start.toISOString());
  return count || 0;
}

/** Conta formulários "ativos" da campanha. */
async function countActiveForms(supabase: SupabaseClient, campaignId: string): Promise<number> {
  const { count } = await supabase
    .from('forms')
    .select('id', { count: 'exact', head: true })
    .eq('campaignId', campaignId)
    .or('status.eq.active,active.eq.true');
  return count || 0;
}

/** Conta chamadas de IA do mês atual (para cota mensal de pagantes). */
async function countAiCallsThisMonth(supabase: SupabaseClient, campaignId: string): Promise<number> {
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  // Coluna é 'timestamp' em ai_usage (não 'created_at'). Bug anterior fazia
  // a query falhar silenciosamente → count=null → 0 → considerava "sem uso".
  const { count } = await supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('campaignId', campaignId)
    .gte('timestamp', start.toISOString());
  return count || 0;
}

const UPGRADE_GENERIC = 'Esta ação faz parte do Plano Pro. Faltam dias até a eleição — não chegue na reta final sem isso.';
const UPGRADE_AI = '🤖 IA está no Plano Pro. Classificar eleitores, dossiê de adversários e estratégia automática — seu opositor pode já estar usando.';
const UPGRADE_WA = '📱 Você atingiu o limite de DISPAROS EM MASSA do mês. Plano Total: disparos ilimitados. (Caixa de Entrada e Call Center continuam funcionando normalmente.)';
const UPGRADE_FORMS = '📝 Plano Grátis permite poucos formulários ativos. Plano Pro: ilimitados.';
const UPGRADE_DIAD = '🗳️ Dia D / Leitor de BU é exclusivo do Plano Pro. No dia da eleição você precisa disso pra acompanhar a apuração antes dos concorrentes.';

/**
 * Verifica se a campanha pode disparar mais N mensagens de WhatsApp EM MASSA
 * no MÊS corrente. Não confunda com mensagens da Caixa de Entrada ou do Call
 * Center — essas NÃO consomem cota.
 *
 * Lê blasts_per_month dos limits (nome novo). Aceita os legados
 * messages_per_month e whatsapp_per_day por compatibilidade enquanto
 * sobram campanhas com schema antigo (migration roda no DB mas há cache).
 */
export async function checkWhatsAppQuota(
  supabase: SupabaseClient, campaignId: string, requestedCount: number = 1,
): Promise<QuotaCheckResult> {
  const cfg = await loadCampaignConfig(supabase, campaignId);
  if (!cfg) return { ok: false, reason: 'no_config', upgradeMessage: 'Configuração não encontrada.' };

  const limit = Number(
    cfg?.limits?.blasts_per_month
      ?? cfg?.limits?.messages_per_month     // legado pré-#109
      ?? cfg?.limits?.whatsapp_per_day        // legado mais antigo
      ?? cfg?.limits?.whatsappPerDay
      ?? 999999,
  );
  if (limit < 0 || limit >= 999999) return { ok: true, planTier: cfg.planTier, limit }; // -1 = ilimitado

  const used = await countBlastsThisMonth(supabase, campaignId);
  if (used + requestedCount > limit) {
    // Próximo mês UTC (reset)
    const reset = new Date(); reset.setUTCMonth(reset.getUTCMonth() + 1); reset.setUTCDate(1); reset.setUTCHours(0, 0, 0, 0);
    return {
      ok: false, reason: 'quota_exceeded', feature: 'whatsapp_blast',
      used, limit, resetAt: reset.toISOString(), planTier: cfg.planTier,
      upgradeMessage: UPGRADE_WA,
    };
  }
  return { ok: true, used, limit, planTier: cfg.planTier };
}

/** Verifica se pode criar mais 1 formulário. */
export async function checkFormsQuota(
  supabase: SupabaseClient, campaignId: string,
): Promise<QuotaCheckResult> {
  const cfg = await loadCampaignConfig(supabase, campaignId);
  if (!cfg) return { ok: false, reason: 'no_config' };

  const limit = Number(cfg?.limits?.forms ?? 999999);
  if (limit < 0 || limit >= 999999) return { ok: true, planTier: cfg.planTier, limit }; // -1 = ilimitado

  const used = await countActiveForms(supabase, campaignId);
  if (used >= limit) {
    return {
      ok: false, reason: 'quota_exceeded', feature: 'forms',
      used, limit, planTier: cfg.planTier, upgradeMessage: UPGRADE_FORMS,
    };
  }
  return { ok: true, used, limit, planTier: cfg.planTier };
}

/**
 * Verifica se a campanha pode chamar IA agora.
 *  - planTier 'gratis': bloqueia SEMPRE, exceto se trial 24h estiver ativo
 *    (campaign_configs.aiTrialUntil > now), respeitando a cota do trial
 *    (passada via opção `trialCotaCheck`).
 *  - Pagantes: respeita cota mensal de ai_calls.
 */
export async function checkAiQuota(
  supabase: SupabaseClient, campaignId: string,
  opts: { trialCotaCheck?: (used: number) => boolean } = {},
): Promise<QuotaCheckResult> {
  const cfg = await loadCampaignConfig(supabase, campaignId);
  if (!cfg) return { ok: false, reason: 'no_config' };

  // Lê o limite com fallback defensivo: ai_calls (preferido) → aiCalls (legacy)
  // → ai_budget_cents (semântica diferente mas pelo menos consistente com -1 =
  // ilimitado, 0 = travado). Sem o fallback, configs antigas sem ai_calls
  // caíam pra default 0 e bloqueavam TUDO mesmo no Total. Bug visto em prod.
  const rawLimit = cfg?.limits?.ai_calls ?? cfg?.limits?.aiCalls ?? cfg?.limits?.ai_budget_cents;
  const monthlyLimit = rawLimit == null ? -1 : Number(rawLimit);
  const tier = cfg.planTier;

  // Pagantes: cota mensal
  if (tier !== 'gratis') {
    if (monthlyLimit < 0 || monthlyLimit >= 999999) return { ok: true, planTier: tier }; // -1 = ilimitado
    const used = await countAiCallsThisMonth(supabase, campaignId);
    if (used >= monthlyLimit) {
      return { ok: false, reason: 'quota_exceeded', feature: 'ai_calls',
        used, limit: monthlyLimit, planTier: tier,
        upgradeMessage: 'Você atingiu a cota mensal de IA. Faça upgrade para o Plano Total (ilimitado).' };
    }
    return { ok: true, used, limit: monthlyLimit, planTier: tier };
  }

  // GRATIS: bloqueado por padrão. Libera SÓ se trial 24h ativo.
  const trialUntil = cfg.aiTrialUntil ? new Date(cfg.aiTrialUntil).getTime() : 0;
  const trialActive = trialUntil > Date.now();
  if (!trialActive) {
    return { ok: false, reason: 'feature_locked', feature: 'ai_calls',
      planTier: tier, upgradeMessage: UPGRADE_AI };
  }
  // Trial ativo: chama o callback de cota se passado (ex.: 25 classif, 5 dossiês)
  if (opts.trialCotaCheck) {
    const usedTrial = Number(cfg.aiTrialUsed || 0);
    if (!opts.trialCotaCheck(usedTrial)) {
      return { ok: false, reason: 'quota_exceeded', feature: 'ai_trial',
        used: usedTrial, planTier: tier,
        upgradeMessage: '🎯 Você usou toda a cota do seu trial de IA. Plano Pro = uso ilimitado.' };
    }
  }
  return { ok: true, planTier: tier, resetAt: cfg.aiTrialUntil };
}

/**
 * Verifica se a feature genérica está habilitada no plano da campanha
 * (lê features[] de campaign_configs).
 */
export async function checkFeatureEnabled(
  supabase: SupabaseClient, campaignId: string, featureKey: string,
): Promise<QuotaCheckResult> {
  const cfg = await loadCampaignConfig(supabase, campaignId);
  if (!cfg) return { ok: false, reason: 'no_config' };
  const features: string[] = Array.isArray(cfg.features) ? cfg.features : [];
  if (features.includes(featureKey)) return { ok: true, planTier: cfg.planTier };

  // Mensagens específicas por feature
  const msgs: Record<string, string> = {
    election_day: UPGRADE_DIAD,
    ai_agents: UPGRADE_AI, intelligence: UPGRADE_AI, scenarios: UPGRADE_AI,
    content_studio: UPGRADE_AI, rag: UPGRADE_AI, paperclip: UPGRADE_AI,
  };
  return {
    ok: false, reason: 'feature_locked', feature: featureKey, planTier: cfg.planTier,
    upgradeMessage: msgs[featureKey] || UPGRADE_GENERIC,
  };
}
