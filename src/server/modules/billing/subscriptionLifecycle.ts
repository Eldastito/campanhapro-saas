/**
 * Subscription lifecycle sweep.
 *
 * Runs periodically (every LIFECYCLE_INTERVAL_HOURS, default 6h) and:
 *   1. Sends renewal reminders N days before current_period_end (default 3 and 1)
 *   2. Downgrades subscriptions in 'past_due' for more than GRACE_PERIOD_DAYS
 *      (default 7) to the Free plan, cancelling the paid plan
 *   3. Confirms expired 'canceled' subscriptions (period_end < now) by removing
 *      paid features
 *
 * Every action is idempotent (email_log unique key, status transitions are
 * gated by current status) so the sweep can run multiple times per day
 * without duplicate notifications or accidental downgrades.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  sendPaymentUpcomingEmail,
  sendSubscriptionDowngradedEmail,
} from '../email/emailService';
import { getPaymentGateway } from './paymentGateway';
import { audit } from '../observability/auditLogger';

export interface LifecycleConfig {
  /** Days before current_period_end to send a reminder. Default [3, 1]. */
  reminderDays: number[];
  /** Days a subscription can stay in past_due before auto-downgrade. Default 7. */
  gracePeriodDays: number;
  /** Plan id to downgrade to. Default 'free'. */
  downgradePlanId: string;
}

export const DEFAULT_CONFIG: LifecycleConfig = {
  reminderDays: (process.env.LIFECYCLE_REMINDER_DAYS ?? '3,1')
    .split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0),
  gracePeriodDays: parseInt(process.env.LIFECYCLE_GRACE_DAYS ?? '7', 10) || 7,
  downgradePlanId: process.env.LIFECYCLE_DOWNGRADE_PLAN ?? 'free',
};

export interface SweepResult {
  remindersSent: number;
  downgraded: number;
  canceledExpired: number;
  errors: number;
  ranAt: string;
}

/**
 * Main entry point. Pass `now` for deterministic tests.
 */
export async function runLifecycleSweep(
  supabase: SupabaseClient,
  config: LifecycleConfig = DEFAULT_CONFIG,
  now: Date = new Date(),
): Promise<SweepResult> {
  const result: SweepResult = {
    remindersSent: 0, downgraded: 0, canceledExpired: 0, errors: 0,
    ranAt: now.toISOString(),
  };

  // ----- 1. Renewal reminders -----
  for (const daysAhead of config.reminderDays) {
    try {
      const sent = await sendReminders(supabase, daysAhead, now);
      result.remindersSent += sent;
    } catch (err: any) {
      console.error(`[lifecycle] reminder sweep (${daysAhead}d) failed:`, err.message);
      result.errors++;
    }
  }

  // ----- 2. Auto-downgrade stale past_due -----
  try {
    const downgraded = await downgradeStalePastDue(supabase, config, now);
    result.downgraded = downgraded;
  } catch (err: any) {
    console.error('[lifecycle] downgrade sweep failed:', err.message);
    result.errors++;
  }

  // ----- 3. Confirm expired canceled subscriptions -----
  try {
    const canceled = await confirmExpiredCanceled(supabase, config, now);
    result.canceledExpired = canceled;
  } catch (err: any) {
    console.error('[lifecycle] expired-canceled sweep failed:', err.message);
    result.errors++;
  }

  await audit(supabase, {
    actorType: 'system',
    action: 'lifecycle.sweep',
    severity: result.errors > 0 ? 'warn' : 'info',
    metadata: result as any,
  });

  return result;
}

/**
 * Find paid subscriptions whose current_period_end is between
 * (daysAhead-0.5d, daysAhead+0.5d) from `now`. The window prevents the reminder
 * from firing twice if the sweep runs more than once per day around the boundary.
 */
async function sendReminders(
  supabase: SupabaseClient,
  daysAhead: number,
  now: Date,
): Promise<number> {
  const target = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const windowStart = new Date(target.getTime() - 12 * 60 * 60 * 1000);
  const windowEnd = new Date(target.getTime() + 12 * 60 * 60 * 1000);

  const { data: subs, error } = await supabase
    .from('subscriptions')
    .select('id, "campaignId", "planId", "currentPeriodStart", "currentPeriodEnd", status')
    .in('status', ['active', 'trialing'])
    .gte('currentPeriodEnd', windowStart.toISOString())
    .lt('currentPeriodEnd', windowEnd.toISOString());

  if (error) {
    console.error('[lifecycle] reminder query error:', error.message);
    return 0;
  }

  let sent = 0;
  for (const sub of subs ?? []) {
    if (!sub.campaignId || !sub.planId) continue;

    const { data: plan } = await supabase
      .from('plans').select('name, "monthlyCents"').eq('id', sub.planId).maybeSingle();
    if (!plan || !plan.monthlyCents) continue; // skip free / unknown plans

    const { data: admin } = await supabase
      .from('users')
      .select('email, name')
      .eq('campaignId', sub.campaignId)
      .eq('type', 'Admin')
      .order('createdAt', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!admin?.email) continue;

    await sendPaymentUpcomingEmail(supabase, {
      campaignId: sub.campaignId,
      subscriptionId: sub.id,
      periodStart: sub.currentPeriodStart,
      email: admin.email,
      name: admin.name ?? admin.email.split('@')[0],
      planName: plan.name,
      amountCents: plan.monthlyCents,
      daysUntilDue: daysAhead,
      dueDate: sub.currentPeriodEnd,
    });
    sent++;
  }
  return sent;
}

async function downgradeStalePastDue(
  supabase: SupabaseClient,
  config: LifecycleConfig,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - config.gracePeriodDays * 24 * 60 * 60 * 1000);

  const { data: subs, error } = await supabase
    .from('subscriptions')
    .select('id, "campaignId", "planId", "currentPeriodEnd", "asaasSubscriptionId", "paymentProvider", "updatedAt"')
    .eq('status', 'past_due')
    .lt('updatedAt', cutoff.toISOString());

  if (error) {
    console.error('[lifecycle] past_due query error:', error.message);
    return 0;
  }

  let downgraded = 0;
  for (const sub of subs ?? []) {
    if (!sub.campaignId) continue;

    // Look up the downgrade plan once
    const { data: downgradePlan } = await supabase
      .from('plans').select('id, name, features').eq('id', config.downgradePlanId).maybeSingle();
    if (!downgradePlan) {
      console.warn('[lifecycle] downgrade plan not found:', config.downgradePlanId);
      continue;
    }

    // Capture old plan name for the email BEFORE updating
    const { data: oldPlan } = sub.planId
      ? await supabase.from('plans').select('name').eq('id', sub.planId).maybeSingle()
      : { data: null };
    const previousPlanName = oldPlan?.name ?? sub.planId ?? 'desconhecido';

    // Cancel the paid subscription on the upstream gateway (Asaas)
    if (sub.paymentProvider === 'asaas' && sub.asaasSubscriptionId) {
      try {
        const gateway = getPaymentGateway();
        if (gateway.providerName === 'asaas') {
          await gateway.cancelSubscription({ providerSubscriptionId: sub.asaasSubscriptionId });
        }
      } catch (err: any) {
        // Non-fatal — we still proceed to downgrade locally
        console.warn('[lifecycle] gateway cancel failed:', err.message);
      }
    }

    // Atomic transition: only downgrade if still past_due (idempotent)
    const { data: updated, error: updateErr } = await supabase
      .from('subscriptions')
      .update({
        planId: downgradePlan.id,
        status: 'active',
        features: downgradePlan.features ?? [],
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString(),
        updatedAt: now.toISOString(),
      })
      .eq('id', sub.id)
      .eq('status', 'past_due')        // CAS-style: skip if status already changed
      .select('id')
      .maybeSingle();

    if (updateErr || !updated) continue;

    // Notify the admin
    const { data: admin } = await supabase
      .from('users')
      .select('email, name')
      .eq('campaignId', sub.campaignId)
      .eq('type', 'Admin')
      .order('createdAt', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (admin?.email) {
      await sendSubscriptionDowngradedEmail(supabase, {
        campaignId: sub.campaignId,
        email: admin.email,
        name: admin.name ?? admin.email.split('@')[0],
        previousPlanName,
        gracePeriodDays: config.gracePeriodDays,
        subscriptionId: sub.id,
      });
    }

    await audit(supabase, {
      campaignId: sub.campaignId,
      actorType: 'system',
      action: 'lifecycle.downgrade',
      resourceType: 'subscription',
      resourceId: sub.id,
      severity: 'warn',
      metadata: { previousPlanName, gracePeriodDays: config.gracePeriodDays },
    });

    downgraded++;
  }
  return downgraded;
}

async function confirmExpiredCanceled(
  supabase: SupabaseClient,
  config: LifecycleConfig,
  now: Date,
): Promise<number> {
  // Canceled subscriptions whose grace period (current_period_end) has passed —
  // downgrade them to free so the user keeps access but loses paid features.
  const { data: subs, error } = await supabase
    .from('subscriptions')
    .select('id, "campaignId", "planId", "currentPeriodEnd"')
    .eq('status', 'canceled')
    .lt('currentPeriodEnd', now.toISOString());

  if (error) return 0;

  let count = 0;
  for (const sub of subs ?? []) {
    if (!sub.campaignId) continue;
    if (sub.planId === config.downgradePlanId) continue; // already free

    const { data: downgradePlan } = await supabase
      .from('plans').select('id, name, features').eq('id', config.downgradePlanId).maybeSingle();
    if (!downgradePlan) continue;

    const { data: oldPlan } = sub.planId
      ? await supabase.from('plans').select('name').eq('id', sub.planId).maybeSingle()
      : { data: null };
    const previousPlanName = oldPlan?.name ?? sub.planId ?? 'desconhecido';

    const { data: updated } = await supabase
      .from('subscriptions')
      .update({
        planId: downgradePlan.id,
        status: 'active',
        features: downgradePlan.features ?? [],
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString(),
        updatedAt: now.toISOString(),
      })
      .eq('id', sub.id)
      .eq('status', 'canceled')
      .select('id')
      .maybeSingle();
    if (!updated) continue;

    await audit(supabase, {
      campaignId: sub.campaignId,
      actorType: 'system',
      action: 'lifecycle.canceled_expired',
      resourceType: 'subscription',
      resourceId: sub.id,
      severity: 'info',
      metadata: { previousPlanName },
    });
    count++;
  }
  return count;
}

/**
 * Starts the periodic sweep on an interval. Disabled when LIFECYCLE_ENABLED=false
 * (useful for tests and ephemeral environments).
 */
let intervalHandle: NodeJS.Timeout | null = null;

export function startLifecycleSweeper(
  supabase: SupabaseClient,
  intervalHours = parseInt(process.env.LIFECYCLE_INTERVAL_HOURS ?? '6', 10),
): void {
  if (process.env.LIFECYCLE_ENABLED === 'false') {
    console.log('[lifecycle] disabled via LIFECYCLE_ENABLED=false');
    return;
  }
  if (intervalHandle) return; // already running
  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;

  // Run once on startup (5s delay so server is fully up), then on the interval
  setTimeout(() => {
    runLifecycleSweep(supabase).catch(err =>
      console.error('[lifecycle] initial sweep failed:', err.message),
    );
  }, 5_000);

  intervalHandle = setInterval(() => {
    runLifecycleSweep(supabase).catch(err =>
      console.error('[lifecycle] periodic sweep failed:', err.message),
    );
  }, intervalMs);

  console.log(`[lifecycle] sweeper started, every ${intervalHours}h`);
}

export function stopLifecycleSweeper(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
