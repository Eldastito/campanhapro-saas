import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { audit, actorFromRequest } from '../observability/auditLogger';
import { sendWelcomeEmail } from '../email/emailService';

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
      .select('id, "campaignId", type, name, email')
      .eq('id', userId)
      .maybeSingle();

    res.json({
      bootstrapped: !!user?.campaignId,
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
      .select('id, "campaignId"')
      .eq('id', userId)
      .maybeSingle();

    if (existing?.campaignId) {
      return res.json({
        alreadyBootstrapped: true,
        campaignId: existing.campaignId,
      });
    }

    // 1. Create the campaign
    const campaignId = crypto.randomUUID();
    const { error: campaignErr } = await supabase
      .from('campaigns')
      .insert({
        id: campaignId,
        name: campaignName.trim(),
        candidateName: candidateName?.trim() ?? null,
        party: party?.trim() ?? null,
        createdBy: userId,
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
          campaignId: campaignId,
          isSupremeAdmin: false,
        },
        { onConflict: 'id' },
      );

    if (userErr) {
      console.error('[onboarding] user upsert failed:', userErr);
      // Clean up the campaign we just created to avoid orphans
      await supabase.from('campaigns').delete().eq('id', campaignId);
      return res.status(500).json({ error: 'user_upsert_failed', detail: userErr.message });
    }

    // 3. Cria a config da campanha em estado PENDENTE DE PAGAMENTO.
    //    Sem assinatura grátis automática — o acesso só libera após o pagamento
    //    do plano escolhido (webhook do Asaas seta status='active').
    try {
      await supabase.from('campaign_configs').upsert({
        id: campaignId,
        status: 'pending_payment',
        planTier: 'limitado',
        features: [],
      }, { onConflict: 'id' });
    } catch (err: any) {
      console.warn('[onboarding] campaign_configs pending falhou (não-fatal):', err.message);
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

    // 5. Welcome email (non-blocking, never throws)
    if (email) {
      const userName = (req.body.name as string | undefined)
        ?? email.split('@')[0]
        ?? 'Novo usuário';
      sendWelcomeEmail(supabase, {
        campaignId,
        userId,
        email,
        name: userName,
        campaignName: campaignName.trim(),
      }).catch(err => console.warn('[onboarding] welcome email failed:', err.message));
    }

    res.status(201).json({
      bootstrapped: true,
      campaignId,
      plan: 'free',
    });
  });

  return router;
}
