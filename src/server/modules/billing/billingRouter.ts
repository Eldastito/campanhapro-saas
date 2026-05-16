import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  listPlans, getActiveSubscription, subscribeCampaign, cancelSubscription,
  getUsageForCurrentPeriod, isWithinAiBudget,
} from './billingService';
import { audit, actorFromRequest } from '../observability/auditLogger';

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
  // Body: { planId }
  // Stub: when STRIPE_SECRET_KEY is unset, immediately activates the subscription.
  // When set, this would create a Stripe Checkout Session and return the URL.
  router.post('/checkout', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { planId } = req.body as { planId: string };
    if (!planId) return res.status(400).json({ error: 'planId obrigatório' });

    try {
      const sub = await subscribeCampaign(supabase, campaignId, planId);

      await audit(supabase, {
        ...actorFromRequest(req),
        action: 'billing.subscribe',
        resourceType: 'subscription',
        resourceId: sub.id,
        severity: 'info',
        metadata: { planId, mode: process.env.STRIPE_SECRET_KEY ? 'stripe' : 'stub' },
      });

      if (process.env.STRIPE_SECRET_KEY) {
        // Real Stripe path would go here — create Checkout Session, return URL
        return res.json({ subscription: sub, checkoutUrl: null, mode: 'stripe' });
      }

      return res.json({ subscription: sub, mode: 'stub' });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  });

  // POST /api/v1/billing/cancel
  router.post('/cancel', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    await cancelSubscription(supabase, campaignId);

    await audit(supabase, {
      ...actorFromRequest(req),
      action: 'billing.cancel',
      resourceType: 'subscription',
      severity: 'warn',
    });

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
