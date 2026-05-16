import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  listPlans, getActiveSubscription, subscribeCampaign, cancelSubscription,
  getUsageForCurrentPeriod, isWithinAiBudget,
} from './billingService';
import { getPaymentGateway } from './paymentGateway';
import { audit, actorFromRequest } from '../observability/auditLogger';
import { sendSubscriptionCanceledEmail } from '../email/emailService';
import { requireSupremeAdmin } from '../../middleware/requireSupremeAdmin';
import { runLifecycleSweep } from './subscriptionLifecycle';

interface PlanInput {
  id: string;
  name: string;
  monthly_cents: number;
  features: string[];
  limits: Record<string, number>;
  active?: boolean;
}

function validatePlanInput(
  body: any,
  opts: { requireId: boolean },
): { value: PlanInput; error?: undefined } | { error: string; value?: undefined } {
  if (!body || typeof body !== 'object') return { error: 'body_required' };

  if (opts.requireId) {
    if (typeof body.id !== 'string' || !/^[a-z0-9_-]{2,32}$/.test(body.id)) {
      return { error: 'invalid_id (lowercase alphanumeric, 2-32 chars)' };
    }
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.length > 80) {
    return { error: 'invalid_name (1-80 chars)' };
  }

  if (!Number.isInteger(body.monthly_cents) || body.monthly_cents < 0 || body.monthly_cents > 100_000_000) {
    return { error: 'invalid_monthly_cents (integer 0 to 100_000_000)' };
  }

  if (!Array.isArray(body.features) ||
      !body.features.every((f: any) => typeof f === 'string' && /^[a-z0-9_]+$/.test(f))) {
    return { error: 'invalid_features (array of lowercase identifiers)' };
  }

  if (!body.limits || typeof body.limits !== 'object' || Array.isArray(body.limits)) {
    return { error: 'invalid_limits (object)' };
  }
  const allowedLimits = ['contacts', 'ai_budget_cents', 'team_users', 'messages_per_month'];
  for (const k of Object.keys(body.limits)) {
    if (!allowedLimits.includes(k)) return { error: `unknown_limit: ${k}` };
    const v = body.limits[k];
    if (!Number.isInteger(v) || v < -1 || v > 1_000_000_000) {
      return { error: `invalid_limit_value: ${k}` };
    }
  }

  if (body.active !== undefined && typeof body.active !== 'boolean') {
    return { error: 'invalid_active (boolean)' };
  }

  return {
    value: {
      id: body.id,
      name: body.name.trim(),
      monthly_cents: body.monthly_cents,
      features: body.features,
      limits: body.limits,
      ...(body.active !== undefined ? { active: body.active } : {}),
    },
  };
}

export function createBillingRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // GET /api/v1/billing/plans — public list of plans
  router.get('/plans', async (_req, res) => {
    const plans = await listPlans(supabase);
    res.json({ plans });
  });

  // GET /api/v1/billing/subscription — current subscription + plan + usage
  router.get('/subscription', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const [subscription, usage, withinBudget] = await Promise.all([
      getActiveSubscription(supabase, campaignId),
      getUsageForCurrentPeriod(supabase, campaignId),
      isWithinAiBudget(supabase, campaignId),
    ]);

    let plan = null;
    if (subscription) {
      const { data } = await supabase
        .from('plans').select('*').eq('id', subscription.planId).maybeSingle();
      plan = data;
    }

    res.json({ subscription, plan, usage, withinBudget });
  });

  // POST /api/v1/billing/checkout
  // Body: { planId, name?, email?, cpfCnpj?, phone?, method? }
  //
  // Drives the configured PaymentGateway (asaas / stripe / stub).
  // For Asaas: creates a customer if needed, then a subscription, and returns
  // the checkout URL (Asaas customer area) that the user is redirected to.
  router.post('/checkout', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { planId, name, email, cpfCnpj, phone, method } = req.body as {
      planId: string;
      name?: string;
      email?: string;
      cpfCnpj?: string;
      phone?: string;
      method?: 'pix' | 'credit_card' | 'debit_card' | 'boleto' | 'undefined';
    };
    if (!planId) return res.status(400).json({ error: 'planId obrigatório' });

    try {
      // Look up plan price
      const { data: plan, error: planErr } = await supabase
        .from('plans').select('id, name, monthly_cents').eq('id', planId).eq('active', true).single();
      if (planErr || !plan) return res.status(404).json({ error: 'plan_not_found' });

      const gateway = getPaymentGateway();
      let checkoutUrl: string | null = null;
      let providerCustomerId: string | undefined;
      let providerSubscriptionId: string | undefined;

      // Free plan or stub gateway: skip the external HTTP round-trip
      if (gateway.providerName === 'stub' || plan.monthly_cents === 0) {
        const sub = await subscribeCampaign(supabase, campaignId, planId, {
          provider: gateway.providerName === 'stub' ? 'stub' : gateway.providerName,
        });
        await audit(supabase, {
          ...actorFromRequest(req),
          action: 'billing.subscribe',
          resourceType: 'subscription',
          resourceId: sub.id,
          severity: 'info',
          metadata: { planId, provider: gateway.providerName, free: plan.monthly_cents === 0 },
        });
        return res.json({ subscription: sub, checkoutUrl: null, provider: gateway.providerName });
      }

      // Real gateway path
      if (!name || !email) {
        return res.status(400).json({ error: 'name e email obrigatórios para gateways de pagamento' });
      }

      // Re-use the gateway customer id if we already have one for this campaign
      const existingSub = await getActiveSubscription(supabase, campaignId);
      if (existingSub?.id) {
        const { data: existingRow } = await supabase
          .from('subscriptions').select('asaas_customer_id, stripe_customer_id')
          .eq('id', existingSub.id).maybeSingle();
        if (existingRow?.asaas_customer_id && gateway.providerName === 'asaas') {
          providerCustomerId = existingRow.asaas_customer_id;
        }
      }
      if (!providerCustomerId) {
        const customer = await gateway.createCustomer({
          campaignId, name, email, cpfCnpj, phone,
        });
        providerCustomerId = customer.providerCustomerId;
      }

      const subResult = await gateway.createSubscription({
        campaignId,
        providerCustomerId,
        planId,
        amountCents: plan.monthly_cents,
        cycle: 'monthly',
        description: `Assinatura CampanhaPro — plano ${plan.name}`,
        allowedMethods: method ? [method] : ['undefined'],
      });

      providerSubscriptionId = subResult.providerSubscriptionId;
      checkoutUrl = subResult.checkoutUrl;

      const sub = await subscribeCampaign(supabase, campaignId, planId, {
        provider: gateway.providerName,
        providerCustomerId,
        providerSubscriptionId,
      });

      await audit(supabase, {
        ...actorFromRequest(req),
        action: 'billing.subscribe',
        resourceType: 'subscription',
        resourceId: sub.id,
        severity: 'info',
        metadata: { planId, provider: gateway.providerName, providerSubscriptionId },
      });

      return res.json({
        subscription: sub,
        checkoutUrl,
        pixQrCode: subResult.pixQrCode,
        pixCopyPaste: subResult.pixCopyPaste,
        provider: gateway.providerName,
      });
    } catch (err: any) {
      console.error('[billing] checkout failed:', err);
      return res.status(400).json({ error: err.message });
    }
  });

  // POST /api/v1/billing/cancel
  router.post('/cancel', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    // Look up the provider subscription id before flipping our row to canceled
    const existing = await getActiveSubscription(supabase, campaignId);
    if (existing?.id) {
      const { data } = await supabase.from('subscriptions')
        .select('payment_provider, asaas_subscription_id, stripe_subscription_id')
        .eq('id', existing.id).maybeSingle();
      const gateway = getPaymentGateway();
      const providerSubId =
        gateway.providerName === 'asaas' ? data?.asaas_subscription_id :
        gateway.providerName === 'stripe' ? data?.stripe_subscription_id :
        null;
      if (providerSubId) {
        try {
          await gateway.cancelSubscription({ providerSubscriptionId: providerSubId });
        } catch (err: any) {
          console.error('[billing] gateway cancel failed:', err.message);
          // continue — we still want to mark our row canceled
        }
      }
    }

    await cancelSubscription(supabase, campaignId);

    await audit(supabase, {
      ...actorFromRequest(req),
      action: 'billing.cancel',
      resourceType: 'subscription',
      severity: 'warn',
    });

    // Cancellation confirmation email (non-blocking)
    if (existing?.id) {
      try {
        const userId = (req as any).user?.id;
        const userEmail = (req as any).user?.email;
        const { data: planRow } = existing.planId
          ? await supabase.from('plans').select('name').eq('id', existing.planId).maybeSingle()
          : { data: null };
        const { data: profileRow } = userId
          ? await supabase.from('users').select('name').eq('id', userId).maybeSingle()
          : { data: null };
        if (userEmail) {
          sendSubscriptionCanceledEmail(supabase, {
            campaignId,
            email: userEmail,
            name: profileRow?.name ?? userEmail.split('@')[0],
            planName: planRow?.name ?? existing.planId,
            periodEnd: existing.currentPeriodEnd,
            subscriptionId: existing.id,
          }).catch(err => console.warn('[billing] cancel email failed:', err.message));
        }
      } catch (err: any) {
        console.warn('[billing] cancel email prep failed:', err.message);
      }
    }

    res.json({ ok: true });
  });

  // GET /api/v1/billing/usage — paginated usage records
  router.get('/usage', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10) || 100, 500);
    const metric = String(req.query.metric ?? '').trim();

    let q = supabase
      .from('usage_records')
      .select('id, metric, quantity, cost_cents, metadata, recorded_at')
      .eq('campaign_id', campaignId)
      .order('recorded_at', { ascending: false })
      .limit(limit);

    if (metric && ['ai_call', 'message_outbound', 'simulation', 'embedding'].includes(metric)) {
      q = q.eq('metric', metric);
    }

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ records: data ?? [] });
  });

  // -----------------------------------------------------------------------
  // SUPREME ADMIN endpoints — plan catalogue CRUD
  // -----------------------------------------------------------------------
  // Only the SaaS operator (SUPREME_ADMIN_EMAIL or is_supreme_admin flag)
  // can edit plans. Campaign-level Admins must NOT be allowed to change
  // their own pricing.

  // GET /admin/plans — list ALL plans (including inactive)
  router.get('/admin/plans', requireSupremeAdmin(), async (_req, res) => {
    const { data, error } = await supabase
      .from('plans')
      .select('*')
      .order('monthly_cents', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ plans: data ?? [] });
  });

  // POST /admin/plans — create a new plan
  router.post('/admin/plans', requireSupremeAdmin(), async (req, res) => {
    const validation = validatePlanInput(req.body, { requireId: true });
    if (validation.error || !validation.value) return res.status(400).json({ error: validation.error });

    const { data, error } = await supabase
      .from('plans')
      .insert(validation.value)
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });

    await audit(supabase, {
      ...actorFromRequest(req),
      action: 'admin.plan.create',
      resourceType: 'plan',
      resourceId: data.id,
      severity: 'warn',
      metadata: { name: data.name, monthly_cents: data.monthly_cents },
    });

    res.status(201).json({ plan: data });
  });

  // PUT /admin/plans/:id — update an existing plan
  // NOTE: Existing subscriptions snapshot features at subscribe time, so
  // changes here only apply to NEW subscriptions and renewals. This is
  // industry standard — never mutate active customer pricing retroactively.
  router.put('/admin/plans/:id', requireSupremeAdmin(), async (req, res) => {
    const validation = validatePlanInput(req.body, { requireId: false });
    if (validation.error || !validation.value) return res.status(400).json({ error: validation.error });

    const updateFields = { ...validation.value };
    delete (updateFields as any).id;

    const { data, error } = await supabase
      .from('plans')
      .update(updateFields)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error || !data) return res.status(404).json({ error: 'plan_not_found' });

    await audit(supabase, {
      ...actorFromRequest(req),
      action: 'admin.plan.update',
      resourceType: 'plan',
      resourceId: req.params.id,
      severity: 'warn',
      metadata: { changes: Object.keys(updateFields) },
    });

    res.json({ plan: data });
  });

  // DELETE /admin/plans/:id — soft-delete (sets active=false)
  router.delete('/admin/plans/:id', requireSupremeAdmin(), async (req, res) => {
    // Refuse if any active subscription still references the plan
    const { count } = await supabase
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', req.params.id)
      .in('status', ['active', 'trialing', 'past_due']);
    if ((count ?? 0) > 0) {
      return res.status(409).json({
        error: 'plan_in_use',
        activeSubscriptions: count,
      });
    }

    const { error } = await supabase
      .from('plans')
      .update({ active: false })
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });

    await audit(supabase, {
      ...actorFromRequest(req),
      action: 'admin.plan.deactivate',
      resourceType: 'plan',
      resourceId: req.params.id,
      severity: 'warn',
    });

    res.json({ ok: true });
  });

  // POST /admin/lifecycle/run — manual trigger for the lifecycle sweeper.
  // Returns the SweepResult so the operator can verify the run.
  router.post('/admin/lifecycle/run', requireSupremeAdmin(), async (req, res) => {
    try {
      const result = await runLifecycleSweep(supabase);
      await audit(supabase, {
        ...actorFromRequest(req),
        action: 'admin.lifecycle.manual_run',
        severity: 'info',
        metadata: result as any,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
