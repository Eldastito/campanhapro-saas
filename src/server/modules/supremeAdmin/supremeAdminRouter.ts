/**
 * Supreme Admin router — SaaS-operator-only actions.
 *
 * Mounted in server.ts as:
 *   app.use('/api/v1/supreme', requireAuth, requireSupremeAdmin(), createSupremeAdminRouter(supabaseAdmin))
 *
 * Why these live on the server (not the client like the old SupremeAdminPage):
 *   - User creation must use supabaseAdmin.auth.admin.createUser, NOT
 *     supabase.auth.signUp. signUp logs the NEW user into the caller's
 *     browser session — every time the operator created a campaign/user
 *     they got booted to that account. admin.createUser never touches the
 *     caller's session.
 *   - Setting another user's password requires the service_role key, which
 *     must never reach the browser. The old page invoked a `set-password`
 *     edge function that was never deployed → always failed.
 *   - Blocking must be enforced at the AUTH layer (ban), not by flipping a
 *     `role` text column the app routing never actually checked.
 *
 * Every route here assumes requireSupremeAdmin() already gated the request.
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPlanConfig } from '../../../utils/planUtils';
import { Plan } from '../../../types/user';
import { audit, actorFromRequest } from '../observability/auditLogger';

// 100 years — Supabase has no "permanent" ban literal, so we use a long span.
const BAN_FOREVER = '876000h';

function isValidEmail(s: unknown): s is string {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Maps a Plan enum value passed as string back to the enum, or null. */
function parsePlan(raw: unknown): Plan | null {
  if (typeof raw !== 'string') return null;
  const match = Object.values(Plan).find((p) => p === raw);
  return (match as Plan) ?? null;
}

export function createSupremeAdminRouter(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // ── POST /users ─────────────────────────────────────────────────────
  // Create an internal/platform user (Suporte, Manutenção) or any user
  // without disturbing the operator's session.
  router.post('/users', async (req: Request, res: Response) => {
    try {
      const { name, email, password, type, campaignId, plan } = req.body ?? {};
      if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
      if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'invalid_name' });
      const pwd = typeof password === 'string' && password.length >= 6
        ? password
        : null;
      if (!pwd) return res.status(400).json({ error: 'password_min_6' });

      // 1. Create the auth identity (email pre-confirmed so they can log in now)
      const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: pwd,
        email_confirm: true,
        user_metadata: { name },
      });
      if (authErr || !created?.user) {
        return res.status(400).json({ error: 'auth_create_failed', detail: authErr?.message });
      }

      // 2. Create the profile row
      const profile = {
        id: created.user.id,
        name: name.trim(),
        email,
        type: typeof type === 'string' ? type : 'Suporte',
        plan: parsePlan(plan) ?? Plan.TOTAL,
        campaignId: campaignId ?? null,
        role: 'active',
      };
      const { error: profErr } = await supabaseAdmin.from('users').insert(profile);
      if (profErr) {
        // Roll back the orphaned auth user so a retry with the same email works
        await supabaseAdmin.auth.admin.deleteUser(created.user.id).catch(() => {});
        return res.status(400).json({ error: 'profile_insert_failed', detail: profErr.message });
      }

      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'supreme.user.create',
        severity: 'info',
        metadata: { createdUserId: created.user.id, email, type: profile.type },
      }).catch(() => {});

      return res.status(201).json({ user: { ...profile } });
    } catch (err: any) {
      console.error('[supreme] create user error:', err);
      return res.status(500).json({ error: err.message ?? 'create_failed' });
    }
  });

  // ── POST /users/:id/password ────────────────────────────────────────
  // Set a user's password directly (operator override).
  router.post('/users/:id/password', async (req: Request, res: Response) => {
    try {
      const { password } = req.body ?? {};
      if (typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ error: 'password_min_6' });
      }
      const { error } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, { password });
      if (error) return res.status(400).json({ error: 'set_password_failed', detail: error.message });

      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'supreme.user.set_password',
        severity: 'warn',
        metadata: { targetUserId: req.params.id },
      }).catch(() => {});

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'set_password_failed' });
    }
  });

  // ── POST /users/:id/promote ─────────────────────────────────────────
  // Change a user's type and/or supreme-admin flag.
  router.post('/users/:id/promote', async (req: Request, res: Response) => {
    try {
      const { type, isSupremeAdmin } = req.body ?? {};
      const updates: Record<string, unknown> = {};
      if (typeof type === 'string') updates.type = type;
      if (typeof isSupremeAdmin === 'boolean') updates.isSupremeAdmin = isSupremeAdmin;
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'no_fields' });
      }
      const { data, error } = await supabaseAdmin
        .from('users')
        .update(updates)
        .eq('id', req.params.id)
        .select('id, email, type, isSupremeAdmin')
        .single();
      if (error) return res.status(400).json({ error: 'promote_failed', detail: error.message });

      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'supreme.user.promote',
        severity: 'warn',
        metadata: { targetUserId: req.params.id, updates },
      }).catch(() => {});

      return res.json({ user: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'promote_failed' });
    }
  });

  // ── POST /users/:id/block  &  /unblock ──────────────────────────────
  // Real enforcement: ban at the auth layer (prevents login + invalidates
  // refresh) AND flip the profile flags the UI reads. The old client-side
  // version only set role='blocked', which the app routing never checked —
  // so blocked users could still log in.
  router.post('/users/:id/block', async (req: Request, res: Response) => {
    try {
      const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, {
        ban_duration: BAN_FOREVER,
      });
      if (banErr) return res.status(400).json({ error: 'ban_failed', detail: banErr.message });

      // Mirror state on the profile so the dashboard badge is accurate.
      await supabaseAdmin.from('users')
        .update({ role: 'blocked' })
        .eq('id', req.params.id);

      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'supreme.user.block',
        severity: 'warn',
        metadata: { targetUserId: req.params.id },
      }).catch(() => {});

      return res.json({ ok: true, blocked: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'block_failed' });
    }
  });

  router.post('/users/:id/unblock', async (req: Request, res: Response) => {
    try {
      const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, {
        ban_duration: 'none',
      });
      if (banErr) return res.status(400).json({ error: 'unban_failed', detail: banErr.message });

      await supabaseAdmin.from('users')
        .update({ role: 'active' })
        .eq('id', req.params.id);

      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'supreme.user.unblock',
        severity: 'info',
        metadata: { targetUserId: req.params.id },
      }).catch(() => {});

      return res.json({ ok: true, blocked: false });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'unblock_failed' });
    }
  });

  // ── DELETE /users/:id ───────────────────────────────────────────────
  // Hard delete: removes the auth identity (cascade drops the profile row
  // via the FK ON DELETE CASCADE in the users table).
  router.delete('/users/:id', async (req: Request, res: Response) => {
    try {
      // Guard: never let the operator delete themselves.
      if (req.params.id === (req as any).user?.id) {
        return res.status(400).json({ error: 'cannot_delete_self' });
      }
      const { error } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);
      if (error) return res.status(400).json({ error: 'delete_failed', detail: error.message });

      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'supreme.user.delete',
        severity: 'critical',
        metadata: { targetUserId: req.params.id },
      }).catch(() => {});

      return res.status(204).end();
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'delete_failed' });
    }
  });

  // ── POST /campaigns ─────────────────────────────────────────────────
  // Provision a new campaign: create the admin user + campaign_configs in
  // one server-side transaction-ish flow (no session hijack).
  router.post('/campaigns', async (req: Request, res: Response) => {
    try {
      const { name, email, password, plan } = req.body ?? {};
      if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
      if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'invalid_name' });
      if (typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ error: 'password_min_6' });
      }
      const planEnum = parsePlan(plan) ?? Plan.ESSENCIAL;

      // 1. Auth identity
      const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      });
      if (authErr || !created?.user) {
        return res.status(400).json({ error: 'auth_create_failed', detail: authErr?.message });
      }

      // 2. A campaign id. We use a UUID to match the production schema where
      // users.campaignId is uuid (the old client used `camp_${Date.now()}`
      // which is a TEXT id — incompatible with the uuid column in prod).
      const campaignId = (globalThis.crypto?.randomUUID?.() ?? created.user.id);

      const config = getPlanConfig(planEnum);

      // 3. Profile row (campaign admin)
      const { error: profErr } = await supabaseAdmin.from('users').insert({
        id: created.user.id,
        name: name.trim(),
        email,
        type: 'Admin',
        plan: planEnum,
        campaignId,
        role: 'active',
      });
      if (profErr) {
        await supabaseAdmin.auth.admin.deleteUser(created.user.id).catch(() => {});
        return res.status(400).json({ error: 'profile_insert_failed', detail: profErr.message });
      }

      // 4. campaign_configs
      const { error: cfgErr } = await supabaseAdmin.from('campaign_configs').insert({
        id: campaignId,
        features: config.features,
        limits: config.limits,
        status: 'active',
      });
      if (cfgErr) {
        // Best-effort cleanup; surface the error
        await supabaseAdmin.auth.admin.deleteUser(created.user.id).catch(() => {});
        return res.status(400).json({ error: 'config_insert_failed', detail: cfgErr.message });
      }

      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'supreme.campaign.create',
        severity: 'info',
        metadata: { campaignId, adminUserId: created.user.id, email, plan: planEnum },
      }).catch(() => {});

      return res.status(201).json({
        campaign: { id: campaignId, adminUserId: created.user.id, email, name, plan: planEnum },
      });
    } catch (err: any) {
      console.error('[supreme] create campaign error:', err);
      return res.status(500).json({ error: err.message ?? 'create_campaign_failed' });
    }
  });

  return router;
}
