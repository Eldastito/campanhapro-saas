import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  listPlans, getActiveSubscription, subscribeCampaign, cancelSubscription,
  getUsageForCurrentPeriod, isWithinAiBudget,
} from './billingService';
import { getPaymentGateway } from './paymentGateway';
import { audit, actorFromRequest } from '../observability/auditLogger';
import { sendSubscriptionCanceledEmail } from '../email/emailService';

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

  return router;
}
