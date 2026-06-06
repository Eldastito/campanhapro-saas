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
import { callAgent, BudgetExceededError } from '../../../lib/aiCallAgent';

/**
 * System prompt for the campaign-consultant agent. Persona: a senior
 * political-campaign strategist specialised in converting voters into
 * supporters and likely voters. It receives a data snapshot and must
 * return strict JSON (no prose outside the object).
 */
const CONSULTANT_SYSTEM = `Você é um consultor sênior de campanhas políticas brasileiras, especialista em CONVERSÃO de eleitores em apoiadores e prováveis votantes. Você analisa dados reais de uma campanha e produz um diagnóstico acionável, honesto e específico — sem floreios genéricos.

Receberá um JSON com métricas da campanha (equipe, contatos/CRM, visitas de campo, reportes de rua, pesquisas, jornada do eleitor/funil, engajamento, metas, uso de IA, WhatsApp).

Analise CADA fase do funil (captura → relacionamento → conversão → mobilização) e identifique o que está funcionando e o que está travando. Quando um dado estiver zerado ou ausente, trate como sinal (ex.: "sem pesquisas = cego sobre intenção de voto"), não ignore.

Responda APENAS com um objeto JSON válido, sem markdown, neste formato exato:
{
  "scoreConversao": <0-100, nota geral da saúde de conversão da campanha>,
  "resumoExecutivo": "<2-4 frases diretas pro gestor>",
  "funilConversao": {
    "diagnostico": "<análise do funil eleitor→apoiador→votante>",
    "maiorGargalo": "<o ponto que mais trava conversão>"
  },
  "swot": {
    "forcas": ["<...>"],
    "fraquezas": ["<...>"],
    "oportunidades": ["<...>"],
    "ameacas": ["<...>"]
  },
  "diagnosticoPorFase": [
    { "fase": "<nome>", "status": "<bom|atencao|critico>", "observacao": "<...>" }
  ],
  "recomendacoes": [
    { "prioridade": "<alta|media|baixa>", "acao": "<ação concreta>", "impactoEsperado": "<...>" }
  ]
}`;

/** Strips ```json fences and parses; returns null on failure. */
function parseJsonLoose(text: string): any | null {
  if (!text) return null;
  let t = text.trim();
  // Remove leading/trailing markdown fences if present
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  // Grab the outermost {...} if there's surrounding prose
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  try { return JSON.parse(t); } catch { return null; }
}

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

  // ── GET /metrics ────────────────────────────────────────────────────
  // One round-trip dashboard: campaigns, users (total/active/blocked),
  // users-by-type, users-by-campaign, DB size + top tables, user &
  // campaign growth, token usage, peak hours. All computed server-side by
  // the supreme_platform_metrics() SQL function (SECURITY DEFINER so it can
  // read auth.users + pg_catalog). Empty sections mean no data yet — not
  // a failure (e.g. ai_usage may be unpopulated).
  router.get('/metrics', async (_req: Request, res: Response) => {
    try {
      const { data, error } = await supabaseAdmin.rpc('supreme_platform_metrics');
      if (error) return res.status(500).json({ error: 'metrics_failed', detail: error.message });
      return res.json({ metrics: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'metrics_failed' });
    }
  });

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

  // ── POST /campaigns/:id/analyze ─────────────────────────────────────
  // Runs the AI campaign consultant: gathers a real data snapshot via
  // supreme_campaign_analytics(), feeds it to callAgent (OpenAI → Anthropic
  // → Gemini chain), parses the structured SWOT/diagnosis, persists it in
  // consultant_reports, and returns it.
  router.post('/campaigns/:id/analyze', async (req: Request, res: Response) => {
    try {
      const campaignId = req.params.id;

      // 1. Gather the data snapshot
      const { data: snapshot, error: snapErr } = await supabaseAdmin.rpc(
        'supreme_campaign_analytics',
        { p_campaign_id: campaignId },
      );
      if (snapErr) return res.status(500).json({ error: 'snapshot_failed', detail: snapErr.message });

      // 2. Ask the consultant agent (multi-provider chain inside callAgent)
      const prompt =
        `Analise esta campanha e devolva o JSON conforme instruído.\n\n` +
        `DADOS DA CAMPANHA:\n${JSON.stringify(snapshot, null, 2)}`;

      let result;
      try {
        result = await callAgent(supabaseAdmin, 'campaign_consultant', prompt, {
          campaignId,
          userId: (req as any).user?.id ?? null,
          systemInstruction: CONSULTANT_SYSTEM,
        });
      } catch (aiErr: any) {
        if (aiErr instanceof BudgetExceededError) {
          return res.status(402).json({ error: 'ai_budget_exceeded', detail: aiErr.message });
        }
        return res.status(502).json({ error: 'ai_call_failed', detail: aiErr?.message });
      }

      const analysis = parseJsonLoose(result.text);

      // 3. Persist the report (best-effort)
      const { data: saved } = await supabaseAdmin
        .from('consultant_reports')
        .insert({
          campaignId,
          generatedBy: (req as any).user?.id ?? null,
          provider: result.provider,
          model: result.model,
          snapshot,
          analysis: analysis ?? null,
          narrative: analysis ? null : result.text, // fallback: keep raw text if JSON parse failed
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
        })
        .select('id, createdAt')
        .single();

      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'supreme.campaign.analyze',
        severity: 'info',
        metadata: { campaignId, provider: result.provider, model: result.model, reportId: saved?.id },
      }).catch(() => {});

      return res.json({
        reportId: saved?.id,
        provider: result.provider,
        model: result.model,
        snapshot,
        analysis,
        rawText: analysis ? undefined : result.text,
      });
    } catch (err: any) {
      console.error('[supreme] analyze error:', err);
      return res.status(500).json({ error: err.message ?? 'analyze_failed' });
    }
  });

  // ── GET /campaigns/:id/reports ──────────────────────────────────────
  // List past consultant reports for a campaign (most recent first).
  router.get('/campaigns/:id/reports', async (req: Request, res: Response) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('consultant_reports')
        .select('id, provider, model, analysis, createdAt')
        .eq('campaignId', req.params.id)
        .order('createdAt', { ascending: false })
        .limit(20);
      if (error) return res.status(500).json({ error: 'list_reports_failed', detail: error.message });
      return res.json({ reports: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'list_reports_failed' });
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
