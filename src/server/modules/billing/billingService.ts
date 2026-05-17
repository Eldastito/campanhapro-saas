import type { SupabaseClient } from '@supabase/supabase-js';

export interface Plan {
  id: string;
  name: string;
  monthlyCents: number;
  features: string[];
  limits: PlanLimits;
}

export interface PlanLimits {
  contacts: number;          // -1 = unlimited
  ai_budget_cents: number;   // -1 = unlimited
  team_users: number;        // -1 = unlimited
  messages_per_month: number; // -1 = unlimited
}

export interface Subscription {
  id: string;
  campaignId: string;
  planId: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused';
  features: string[];
  currentPeriodStart: string;
  currentPeriodEnd: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
}

export interface UsageSummary {
  campaignId: string;
  periodStart: string;
  periodEnd: string;
  aiCostCents: number;
  aiCalls: number;
  messagesOutbound: number;
  simulations: number;
  embeddings: number;
}

export async function listPlans(supabase: SupabaseClient): Promise<Plan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('active', true)
    .order('monthlyCents', { ascending: true });
  if (error) return [];
  return (data ?? []).map(row => ({
    id: row.id,
    name: row.name,
    monthlyCents: row.monthlyCents,
    features: row.features ?? [],
    limits: row.limits ?? {},
  }));
}

export async function getActiveSubscription(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<Subscription | null> {
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('campaignId', campaignId)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('createdAt', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    campaignId: data.campaignId,
    planId: data.planId,
    status: data.status,
    features: data.features ?? [],
    currentPeriodStart: data.currentPeriodStart,
    currentPeriodEnd: data.currentPeriodEnd,
    stripeSubscriptionId: data.stripeSubscriptionId,
    stripeCustomerId: data.stripeCustomerId,
  };
}

/**
 * Subscribes a campaign to a plan. If a subscription already exists for the
 * campaign, it is updated (plan change). Stripe-aware paths are stubbed —
 * when STRIPE_SECRET_KEY is set, the integration layer would create a real
 * Checkout Session here.
 */
export async function subscribeCampaign(
  supabase: SupabaseClient,
  campaignId: string,
  planId: string,
  providerInfo?: {
    provider: string;
    providerCustomerId?: string;
    providerSubscriptionId?: string;
  },
): Promise<Subscription> {
  const { data: plan, error: planErr } = await supabase
    .from('plans').select('*').eq('id', planId).eq('active', true).single();
  if (planErr || !plan) throw new Error('plan_not_found');

  const periodStart = new Date().toISOString();
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const providerColumns: Record<string, any> = {};
  if (providerInfo) {
    providerColumns.paymentProvider = providerInfo.provider;
    if (providerInfo.provider === 'asaas') {
      if (providerInfo.providerCustomerId) providerColumns.asaasCustomerId = providerInfo.providerCustomerId;
      if (providerInfo.providerSubscriptionId) providerColumns.asaasSubscriptionId = providerInfo.providerSubscriptionId;
    } else if (providerInfo.provider === 'stripe') {
      if (providerInfo.providerCustomerId) providerColumns.stripeCustomerId = providerInfo.providerCustomerId;
      if (providerInfo.providerSubscriptionId) providerColumns.stripeSubscriptionId = providerInfo.providerSubscriptionId;
    }
  }

  // Try to update an existing active subscription; otherwise insert
  const existing = await getActiveSubscription(supabase, campaignId);
  if (existing) {
    const { data, error } = await supabase
      .from('subscriptions')
      .update({
        planId: planId,
        features: plan.features,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        status: 'active',
        updatedAt: new Date().toISOString(),
        ...providerColumns,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error || !data) throw error ?? new Error('update_failed');
    return mapSubscription(data);
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .insert({
      campaignId: campaignId,
      planId: planId,
      features: plan.features,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      status: 'active',
      ...providerColumns,
    })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('insert_failed');
  return mapSubscription(data);
}

export async function cancelSubscription(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<void> {
  await supabase
    .from('subscriptions')
    .update({ status: 'canceled', updatedAt: new Date().toISOString() })
    .eq('campaignId', campaignId)
    .in('status', ['active', 'trialing', 'past_due']);
}

/** Records a metered usage event. Never throws (audit-like guarantee). */
export async function recordUsage(
  supabase: SupabaseClient,
  params: {
    campaignId: string;
    metric: 'ai_call' | 'message_outbound' | 'simulation' | 'embedding';
    quantity?: number;
    costCents?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await supabase.from('usage_records').insert({
      campaignId: params.campaignId,
      metric: params.metric,
      quantity: params.quantity ?? 1,
      costCents: params.costCents ?? 0,
      metadata: params.metadata ?? {},
    });
  } catch (err) {
    console.error('[billing] recordUsage failed:', err);
  }
}

export async function getUsageForCurrentPeriod(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<UsageSummary> {
  const sub = await getActiveSubscription(supabase, campaignId);
  const periodStart = sub?.currentPeriodStart ?? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const periodEnd = sub?.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

  const { data } = await supabase
    .from('usage_records')
    .select('metric, quantity, "costCents"')
    .eq('campaignId', campaignId)
    .gte('recordedAt', periodStart);

  const rows = data ?? [];
  const aiRows = rows.filter(r => r.metric === 'ai_call');
  return {
    campaignId,
    periodStart,
    periodEnd,
    aiCostCents: aiRows.reduce((s, r) => s + (r.costCents ?? 0), 0),
    aiCalls: aiRows.reduce((s, r) => s + (r.quantity ?? 0), 0),
    messagesOutbound: rows.filter(r => r.metric === 'message_outbound').reduce((s, r) => s + (r.quantity ?? 0), 0),
    simulations: rows.filter(r => r.metric === 'simulation').reduce((s, r) => s + (r.quantity ?? 0), 0),
    embeddings: rows.filter(r => r.metric === 'embedding').reduce((s, r) => s + (r.quantity ?? 0), 0),
  };
}

/**
 * Returns true if the campaign is within its AI budget for the current period.
 * Unlimited plans (ai_budget_cents === -1) always return true.
 */
export async function isWithinAiBudget(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<boolean> {
  const sub = await getActiveSubscription(supabase, campaignId);
  if (!sub) return false; // no active subscription → no budget
  const { data: plan } = await supabase
    .from('plans').select('limits').eq('id', sub.planId).single();
  const budget = plan?.limits?.ai_budget_cents ?? 0;
  if (budget === -1) return true;
  if (budget === 0) return false;
  const usage = await getUsageForCurrentPeriod(supabase, campaignId);
  return usage.aiCostCents < budget;
}

function mapSubscription(row: any): Subscription {
  return {
    id: row.id,
    campaignId: row.campaignId,
    planId: row.planId,
    status: row.status,
    features: row.features ?? [],
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    stripeSubscriptionId: row.stripeSubscriptionId,
    stripeCustomerId: row.stripeCustomerId,
  };
}
