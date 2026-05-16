import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActiveSubscription, isWithinAiBudget } from '../modules/billing/billingService';

/**
 * Express middleware factory: rejects requests when the active subscription
 * does not include the named feature. Use sparingly — many features are
 * already gated by the tab visibility in CampaignWebApp; this is a
 * defense-in-depth check on the server.
 */
export function requireFeature(supabase: SupabaseClient, feature: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const sub = await getActiveSubscription(supabase, campaignId);
      if (!sub) {
        return res.status(402).json({ error: 'no_active_subscription', feature });
      }
      if (!sub.features.includes(feature)) {
        return res.status(402).json({ error: 'feature_not_in_plan', feature, planId: sub.planId });
      }
      next();
    } catch (err: any) {
      // Fail-open during early bring-up: subscriptions table may not be populated yet.
      // In production this should fail-closed — toggle via env var.
      if (process.env.BILLING_FAIL_CLOSED === 'true') {
        return res.status(500).json({ error: 'billing_check_failed' });
      }
      next();
    }
  };
}

/**
 * Express middleware factory: rejects requests when the campaign has exceeded
 * its AI budget for the current period. Apply to expensive routes that call
 * out to AI providers (Paperclip, RAG, simulation generators).
 */
export function requireAiBudget(supabase: SupabaseClient): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const ok = await isWithinAiBudget(supabase, campaignId);
      if (!ok) {
        return res.status(402).json({ error: 'ai_budget_exceeded' });
      }
      next();
    } catch {
      // Same fail-open philosophy
      if (process.env.BILLING_FAIL_CLOSED === 'true') {
        return res.status(500).json({ error: 'budget_check_failed' });
      }
      next();
    }
  };
}
