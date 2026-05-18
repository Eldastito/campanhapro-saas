import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActiveSubscription, isWithinAiBudget } from '../modules/billing/billingService';

const FREE_PLAN_ID = process.env.LIFECYCLE_DOWNGRADE_PLAN ?? 'free';

async function resolveEffectiveFeatures(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<string[]> {
  const sub = await getActiveSubscription(supabase, campaignId);
  if (sub) return sub.features;
  const { data: freePlan } = await supabase
    .from('plans')
    .select('features')
    .eq('id', FREE_PLAN_ID)
    .maybeSingle();
  return (freePlan?.features as string[]) ?? [];
}

/**
 * Express middleware factory: rejects requests when the active subscription
 * does not include the named feature. Campaigns without any subscription
 * default to the Free plan's features (so paid features are blocked, but
 * Free features stay accessible).
 */
export function requireFeature(supabase: SupabaseClient, feature: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const features = await resolveEffectiveFeatures(supabase, campaignId);
      if (!features.includes(feature)) {
        return res.status(402).json({
          error: 'feature_not_in_plan',
          feature,
          upgradeRequired: true,
        });
      }
      next();
    } catch (err: any) {
      // Fail-closed by default; flip to fail-open via env for emergency bypass
      if (process.env.BILLING_FAIL_OPEN === 'true') {
        return next();
      }
      console.error('[requireFeature] check failed:', err.message);
      return res.status(500).json({ error: 'billing_check_failed' });
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
