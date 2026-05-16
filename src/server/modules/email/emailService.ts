/**
 * High-level email API. Each function:
 *   1. Renders the right template
 *   2. Calls the active provider
 *   3. Logs to email_log with idempotency key so retries don't double-send
 *
 * All functions are never-throws — email is an enhancement, not a critical
 * path. Failures are logged + audited but never bubble up to break the
 * primary action.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getEmailProvider } from './emailProvider';
import { templates } from './templates';
import { audit } from '../observability/auditLogger';

interface LogContext {
  campaignId?: string | null;
  recipientId?: string | null;
  recipientEmail: string;
  template: string;
  subject: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

async function sendAndLog(
  supabase: SupabaseClient,
  ctx: LogContext,
  body: { html: string; text?: string },
): Promise<void> {
  const provider = getEmailProvider();

  // Idempotency precheck — if a row with the same (template, idempotencyKey)
  // already exists and is sent/delivered, skip the send entirely.
  if (ctx.idempotencyKey) {
    const { data: existing } = await supabase
      .from('email_log')
      .select('id, status')
      .eq('template', ctx.template)
      .eq('idempotency_key', ctx.idempotencyKey)
      .in('status', ['sent', 'delivered'])
      .maybeSingle();
    if (existing) {
      return;
    }
  }

  let result;
  try {
    result = await provider.sendEmail({
      to: ctx.recipientEmail,
      subject: ctx.subject,
      html: body.html,
      text: body.text,
    });
  } catch (err: any) {
    result = { providerMessageId: null, ok: false, error: err.message };
  }

  try {
    await supabase.from('email_log').insert({
      campaign_id: ctx.campaignId ?? null,
      recipient_id: ctx.recipientId ?? null,
      recipient_email: ctx.recipientEmail,
      template: ctx.template,
      subject: ctx.subject,
      status: result.ok ? 'sent' : 'failed',
      provider: provider.providerName,
      provider_message_id: result.providerMessageId,
      idempotency_key: ctx.idempotencyKey ?? null,
      error: result.error ?? null,
      metadata: ctx.metadata ?? {},
    });
  } catch (err: any) {
    console.error('[email] log write failed:', err.message);
  }

  if (!result.ok) {
    await audit(supabase, {
      campaignId: ctx.campaignId ?? null,
      actorType: 'system',
      action: 'email.send_failed',
      resourceType: 'email',
      severity: 'warn',
      metadata: { template: ctx.template, error: result.error },
    });
  }
}

// ----- Public API -----

export async function sendWelcomeEmail(
  supabase: SupabaseClient,
  params: {
    campaignId: string;
    userId: string;
    email: string;
    name: string;
    campaignName: string;
  },
): Promise<void> {
  const tpl = templates.welcome({ name: params.name, campaignName: params.campaignName });
  await sendAndLog(supabase, {
    campaignId: params.campaignId,
    recipientId: params.userId,
    recipientEmail: params.email,
    template: 'welcome',
    subject: tpl.subject,
    idempotencyKey: `welcome:${params.campaignId}`,
    metadata: { campaignName: params.campaignName },
  }, tpl);
}

export async function sendPaymentConfirmedEmail(
  supabase: SupabaseClient,
  params: {
    campaignId: string;
    email: string;
    name: string;
    planName: string;
    amountCents: number;
    paymentMethod: string;
    paymentEventId: string;     // used as idempotency key
  },
): Promise<void> {
  const tpl = templates.paymentConfirmed({
    name: params.name,
    planName: params.planName,
    amountCents: params.amountCents,
    paymentMethod: params.paymentMethod,
  });
  await sendAndLog(supabase, {
    campaignId: params.campaignId,
    recipientEmail: params.email,
    template: 'payment_confirmed',
    subject: tpl.subject,
    idempotencyKey: `payment_confirmed:${params.paymentEventId}`,
    metadata: { planName: params.planName, amountCents: params.amountCents, paymentMethod: params.paymentMethod },
  }, tpl);
}

export async function sendPaymentOverdueEmail(
  supabase: SupabaseClient,
  params: {
    campaignId: string;
    email: string;
    name: string;
    planName: string;
    amountCents: number;
    paymentEventId: string;
  },
): Promise<void> {
  const tpl = templates.paymentOverdue({
    name: params.name,
    planName: params.planName,
    amountCents: params.amountCents,
  });
  await sendAndLog(supabase, {
    campaignId: params.campaignId,
    recipientEmail: params.email,
    template: 'payment_overdue',
    subject: tpl.subject,
    idempotencyKey: `payment_overdue:${params.paymentEventId}`,
    metadata: { planName: params.planName, amountCents: params.amountCents },
  }, tpl);
}

export async function sendSubscriptionCanceledEmail(
  supabase: SupabaseClient,
  params: {
    campaignId: string;
    email: string;
    name: string;
    planName: string;
    periodEnd: string;
    subscriptionId: string;
  },
): Promise<void> {
  const tpl = templates.subscriptionCanceled({
    name: params.name,
    planName: params.planName,
    periodEnd: params.periodEnd,
  });
  await sendAndLog(supabase, {
    campaignId: params.campaignId,
    recipientEmail: params.email,
    template: 'subscription_canceled',
    subject: tpl.subject,
    idempotencyKey: `subscription_canceled:${params.subscriptionId}`,
    metadata: { planName: params.planName, periodEnd: params.periodEnd },
  }, tpl);
}

export async function sendTeamInviteEmail(
  supabase: SupabaseClient,
  params: {
    campaignId: string;
    email: string;
    inviterName: string;
    campaignName: string;
    role: string;
    inviteUrl: string;
    inviteId: string;     // idempotency key
  },
): Promise<void> {
  const tpl = templates.teamInvite({
    inviterName: params.inviterName,
    campaignName: params.campaignName,
    role: params.role,
    inviteUrl: params.inviteUrl,
  });
  await sendAndLog(supabase, {
    campaignId: params.campaignId,
    recipientEmail: params.email,
    template: 'team_invite',
    subject: tpl.subject,
    idempotencyKey: `team_invite:${params.inviteId}`,
    metadata: { role: params.role, campaignName: params.campaignName },
  }, tpl);
}

export async function sendPaymentUpcomingEmail(
  supabase: SupabaseClient,
  params: {
    campaignId: string;
    email: string;
    name: string;
    planName: string;
    amountCents: number;
    daysUntilDue: number;
    dueDate: string;
    subscriptionId: string;
    /** A reminder is sent at most once per (subscription, period, daysBucket) */
    periodStart: string;
  },
): Promise<void> {
  const tpl = templates.paymentUpcoming({
    name: params.name,
    planName: params.planName,
    amountCents: params.amountCents,
    daysUntilDue: params.daysUntilDue,
    dueDate: params.dueDate,
  });
  await sendAndLog(supabase, {
    campaignId: params.campaignId,
    recipientEmail: params.email,
    template: 'payment_upcoming',
    subject: tpl.subject,
    idempotencyKey: `payment_upcoming:${params.subscriptionId}:${params.periodStart}:${params.daysUntilDue}`,
    metadata: { planName: params.planName, amountCents: params.amountCents, daysUntilDue: params.daysUntilDue },
  }, tpl);
}

export async function sendSubscriptionDowngradedEmail(
  supabase: SupabaseClient,
  params: {
    campaignId: string;
    email: string;
    name: string;
    previousPlanName: string;
    gracePeriodDays: number;
    subscriptionId: string;
  },
): Promise<void> {
  const tpl = templates.subscriptionDowngraded({
    name: params.name,
    previousPlanName: params.previousPlanName,
    gracePeriodDays: params.gracePeriodDays,
  });
  await sendAndLog(supabase, {
    campaignId: params.campaignId,
    recipientEmail: params.email,
    template: 'subscription_downgraded',
    subject: tpl.subject,
    idempotencyKey: `subscription_downgraded:${params.subscriptionId}`,
    metadata: { previousPlanName: params.previousPlanName, gracePeriodDays: params.gracePeriodDays },
  }, tpl);
}
