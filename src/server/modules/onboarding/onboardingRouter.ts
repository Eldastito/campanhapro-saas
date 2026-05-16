import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { subscribeCampaign } from '../billing/billingService';
import { audit, actorFromRequest } from '../observability/auditLogger';

/**
 * Onboarding for new tenants.
 *
 * After supabase.auth.signUp on the frontend, the user has an auth identity
 * but no `users` row, no campaign, and no subscription. This router bootstraps
 * all three in a single authenticated call so the user can immediately access
 * the app on the Free plan and upgrade from the Billing tab.
 *
 * Returns 200 with the existing setup if the user already has a campaign —
 * makes the endpoint idempotent against double-clicks on the signup CTA.
 */
export function createOnboardingRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // GET /api/v1/onboarding/status — does the caller already have a campaign?
  router.get('/status', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { data: user } = await supabase
      .from('users')
      .select('id, campaign_id, type, name, email')
      .eq('id', userId)
      .maybeSingle();

    res.json({
      bootstrapped: !!user?.campaign_id,
      user: user ?? null,
    });
  });

  // POST /api/v1/onboarding/bootstrap
  // Body: { campaignName, candidateName?, party? }
  router.post('/bootstrap', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const email = (req as any).user?.email;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { campaignName, candidateName, party } = req.body as {
      campaignName: string;
      candidateName?: string;
      party?: string;
    };

    if (!campaignName?.trim()) {
      return res.status(400).json({ error: 'campaignName obrigatório' });
    }

    // Idempotency — if user already has a campaign, return it
    const { data: existing } = await supabase
      .from('users')
      .select('id, campaign_id')
      .eq('id', userId)
      .maybeSingle();

    if (existing?.campaign_id) {
      return res.json({
        alreadyBootstrapped: true,
        campaignId: existing.campaign_id,
      });
    }

    // 1. Create the campaign
    const campaignId = crypto.randomUUID();
    const { error: campaignErr } = await supabase
      .from('campaigns')
      .insert({
        id: campaignId,
        name: campaignName.trim(),
        candidate_name: candidateName?.trim() ?? null,
        party: party?.trim() ?? null,
        created_by: userId,
      });

    if (campaignErr) {
      console.error('[onboarding] campaign insert failed:', campaignErr);
      return res.status(500).json({ error: 'campaign_insert_failed', detail: campaignErr.message });
    }

    // 2. Create / upsert the user row with Admin role tied to this campaign
    const { error: userErr } = await supabase
      .from('users')
      .upsert(
        {
          id: userId,
          email,
          name: (req.body.name as string | undefined) ?? email?.split('@')[0] ?? 'Novo Usuário',
          type: 'Admin',
          plan: 'Básico',
          role: 'active',
          campaign_id: campaignId,
          is_supreme_admin: false,
        },
        { onConflict: 'id' },
      );

    if (userErr) {
      console.error('[onboarding] user upsert failed:', userErr);
      // Clean up the campaign we just created to avoid orphans
      await supabase.from('campaigns').delete().eq('id', campaignId);
      return res.status(500).json({ error: 'user_upsert_failed', detail: userErr.message });
    }

    // 3. Activate the free subscription
    try {
      await subscribeCampaign(supabase, campaignId, 'free', {
        provider: 'stub',
      });
    } catch (err: any) {
      // Free plan failure is non-fatal — user can pick a plan later from Billing tab
      console.warn('[onboarding] free subscription failed (non-fatal):', err.message);
    }

    // 4. Audit
    await audit(supabase, {
      ...actorFromRequest(req),
      campaignId,
      action: 'onboarding.bootstrap',
      resourceType: 'campaign',
      resourceId: campaignId,
      severity: 'info',
      metadata: { campaignName, candidateName, party },
    });

    res.status(201).json({
      bootstrapped: true,
      campaignId,
      plan: 'free',
    });
  });

  return router;
}
