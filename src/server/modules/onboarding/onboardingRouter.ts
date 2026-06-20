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
      // Partido é "bootstrapped" por ter type='Presidente de Partido' (sem campaignId).
      bootstrapped: !!user?.campaignId || user?.type === 'Presidente de Partido',
      user: user ?? null,
    });
  });

  // POST /api/v1/onboarding/bootstrap
  // Body campanha: { accountType?: 'campaign', campaignName, candidateName?, party?, name? }
  // Body partido:  { accountType: 'party', partyName, name? }
  router.post('/bootstrap', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const email = (req as any).user?.email;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const accountType = (req.body?.accountType as string) === 'party' ? 'party' : 'campaign';

    // ─────────────────────────── CONTA DE PARTIDO ───────────────────────────
    // Self-serve: cria o presidente (type='Presidente de Partido') + o partido e
    // dá acesso completo ao módulo na hora. Cobrança é manual (billingNote), o
    // operador acerta depois pela aba Partidos do Supreme. NÃO cria campanha.
    if (accountType === 'party') {
      const partyName = String(req.body?.partyName ?? req.body?.campaignName ?? '').trim();
      if (!partyName) return res.status(400).json({ error: 'partyName obrigatório' });

      // Idempotência: já é presidente ou já tem partido → devolve sem duplicar.
      const [{ data: u }, { data: existingParty }] = await Promise.all([
        supabase.from('users').select('id, type').eq('id', userId).maybeSingle(),
        supabase.from('parties').select('id').eq('presidentId', userId).maybeSingle(),
      ]);
      if (existingParty || u?.type === 'Presidente de Partido') {
        if (u?.type !== 'Presidente de Partido') {
          await supabase.from('users').update({ type: 'Presidente de Partido' }).eq('id', userId);
        }
        return res.json({ alreadyBootstrapped: true, accountType: 'party', partyId: existingParty?.id ?? null });
      }

      const presidentName = (req.body?.name as string | undefined)?.trim() || email?.split('@')[0] || 'Presidente';

      const { error: userErr } = await supabase.from('users').upsert({
        id: userId,
        email,
        name: presidentName,
        type: 'Presidente de Partido',
        role: 'active',
        campaignId: null,
        isSupremeAdmin: false,
      }, { onConflict: 'id' });
      if (userErr) {
        console.error('[onboarding] party user upsert failed:', userErr);
        return res.status(500).json({ error: 'user_upsert_failed', detail: userErr.message });
      }

      // parties tem defaults plan='paid', status='active'.
      const { data: party, error: partyErr } = await supabase.from('parties')
        .insert({ name: partyName, presidentId: userId })
        .select('id, name, plan, status').single();
      if (partyErr) {
        console.error('[onboarding] party insert failed:', partyErr);
        return res.status(500).json({ error: 'party_insert_failed', detail: partyErr.message });
      }

      // Control Plane: entitlement do módulo 'partido' pro novo tenant (não-fatal).
      await supabase.from('tenant_module_entitlements').upsert({
        tenantId: party.id, tenantKind: 'party', moduleKey: 'partido', source: 'onboarding',
      }, { onConflict: 'tenantId,moduleKey' }).then(() => {}, () => {});

      await audit(supabase, {
        ...actorFromRequest(req),
        action: 'onboarding.bootstrap_party',
        resourceType: 'party',
        resourceId: party.id,
        severity: 'info',
        metadata: { partyName },
      }).catch(() => {});

      if (email) {
        sendWelcomeEmail(supabase, {
          campaignId: party.id, userId, email, name: presidentName, campaignName: partyName,
        }).catch(err => console.warn('[onboarding] welcome email (party) failed:', err.message));
      }

      return res.status(201).json({ bootstrapped: true, accountType: 'party', partyId: party.id });
    }

    // ─────────────────────────── CONTA DE CAMPANHA ──────────────────────────
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

    // Control Plane: entitlement do módulo 'campanha' pro novo tenant (não-fatal).
    await supabase.from('tenant_module_entitlements').upsert({
      tenantId: campaignId, tenantKind: 'campaign', moduleKey: 'campanha', source: 'onboarding',
    }, { onConflict: 'tenantId,moduleKey' }).then(() => {}, () => {});

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
