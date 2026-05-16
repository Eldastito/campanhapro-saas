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
    .order('monthly_cents', { ascending: true });
  if (error) return [];
  return (data ?? []).map(row => ({
    id: row.id,
    name: row.name,
    monthlyCents: row.monthly_cents,
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
    .eq('campaign_id', campaignId)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    campaignId: data.campaign_id,
    planId: data.plan_id,
    status: data.status,
    features: data.features ?? [],
    currentPeriodStart: data.current_period_start,
    currentPeriodEnd: data.current_period_end,
    stripeSubscriptionId: data.stripe_subscription_id,
    stripeCustomerId: data.stripe_customer_id,
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
): Promise<Subscription> {
  const { data: plan, error: planErr } = await supabase
    .from('plans').select('*').eq('id', planId).eq('active', true).single();
  if (planErr || !plan) throw new Error('plan_not_found');

  const periodStart = new Date().toISOString();
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Try to update an existing active subscription; otherwise insert
  const existing = await getActiveSubscription(supabase, campaignId);
  if (existing) {
    const { data, error } = await supabase
      .from('subscriptions')
      .update({
        plan_id: planId,
        features: plan.features,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        status: 'active',
        updated_at: new Date().toISOString(),
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
      campaign_id: campaignId,
      plan_id: planId,
      features: plan.features,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      status: 'active',
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
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('campaign_id', campaignId)
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
      campaign_id: params.campaignId,
      metric: params.metric,
      quantity: params.quantity ?? 1,
      cost_cents: params.costCents ?? 0,
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
    .select('metric, quantity, cost_cents')
    .eq('campaign_id', campaignId)
    .gte('recorded_at', periodStart);

  const rows = data ?? [];
  const aiRows = rows.filter(r => r.metric === 'ai_call');
  return {
    campaignId,
    periodStart,
    periodEnd,
    aiCostCents: aiRows.reduce((s, r) => s + (r.cost_cents ?? 0), 0),
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
    campaignId: row.campaign_id,
    planId: row.plan_id,
    status: row.status,
    features: row.features ?? [],
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
  };
}
