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
import { runLifecycleSweep } from '../billing/subscriptionLifecycle';
import { calcSimplesNacional } from './taxCalculator';

// ── Form Builder (F5) ──────────────────────────────────────────────────
// Alvos (entidades) que aceitam campos personalizáveis por campanha.
const FORM_TARGETS = ['visits', 'contacts', 'pesquisa'] as const;
const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'email', 'phone', 'select', 'boolean'] as const;

/** Normaliza/valida o schema de formulários vindo do cliente (defensivo). */
function sanitizeFormSchema(input: any): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const target of FORM_TARGETS) {
    const arr = Array.isArray(src[target]) ? src[target] : [];
    const fields: any[] = [];
    for (const f of arr) {
      if (!f || typeof f !== 'object') continue;
      const label = typeof f.label === 'string' ? f.label.trim().slice(0, 120) : '';
      if (!label) continue; // campo sem label é descartado
      const type = (FIELD_TYPES as readonly string[]).includes(f.type) ? f.type : 'text';
      const id = typeof f.id === 'string' && f.id.trim()
        ? f.id.trim().slice(0, 64)
        : `f_${Math.random().toString(36).slice(2, 10)}`;
      const field: any = { id, label, type, required: !!f.required };
      if (type === 'select') {
        field.options = Array.isArray(f.options)
          ? f.options.map((o: any) => String(o).trim()).filter(Boolean).slice(0, 50)
          : [];
      }
      if (typeof f.placeholder === 'string' && f.placeholder.trim()) field.placeholder = f.placeholder.trim().slice(0, 160);
      if (typeof f.help === 'string' && f.help.trim()) field.help = f.help.trim().slice(0, 240);
      fields.push(field);
    }
    out[target] = fields.slice(0, 50); // teto defensivo
  }
  return out;
}

// Colunas nativas de contacts que um campo de form público pode preencher.
const CONTACT_MAPS = ['name', 'email', 'phone', 'neighborhood', 'city'];

/** Sanitiza um array plano de campos (formulário público, aceita `map`). */
function sanitizePublicFields(arr: any): any[] {
  if (!Array.isArray(arr)) return [];
  const out: any[] = [];
  for (const f of arr) {
    if (!f || typeof f !== 'object') continue;
    const label = typeof f.label === 'string' ? f.label.trim().slice(0, 120) : '';
    if (!label) continue;
    const type = (FIELD_TYPES as readonly string[]).includes(f.type) ? f.type : 'text';
    const id = typeof f.id === 'string' && f.id.trim() ? f.id.trim().slice(0, 64) : `f_${Math.random().toString(36).slice(2, 10)}`;
    const field: any = { id, label, type, required: !!f.required };
    if (type === 'select') field.options = Array.isArray(f.options) ? f.options.map((o: any) => String(o).trim()).filter(Boolean).slice(0, 50) : [];
    if (typeof f.placeholder === 'string' && f.placeholder.trim()) field.placeholder = f.placeholder.trim().slice(0, 160);
    if (typeof f.help === 'string' && f.help.trim()) field.help = f.help.trim().slice(0, 240);
    if (typeof f.map === 'string' && CONTACT_MAPS.includes(f.map)) field.map = f.map;
    out.push(field);
  }
  return out.slice(0, 50);
}

/** slug seguro a partir de um título (acentos removidos via NFD, sem char combinante no fonte). */
function slugify(s: string): string {
  const norm = (s || 'form').toString().normalize('NFD');
  let stripped = '';
  for (const ch of norm) {
    const code = ch.charCodeAt(0);
    if (code >= 0x300 && code <= 0x36f) continue; // pula diacríticos combinantes
    stripped += ch;
  }
  const base = stripped.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return base || 'form';
}

/**
 * System prompt for the campaign-consultant agent. Persona: a senior
 * political-campaign strategist specialised in converting voters into
 * supporters and likely voters. It receives a data snapshot and must
 * return strict JSON (no prose outside the object).
 */
const CONSULTANT_SYSTEM = `Você é um consultor sênior de campanhas políticas brasileiras, especialista em CONVERSÃO de eleitores em apoiadores e prováveis votantes. Você analisa dados reais de uma campanha e produz um diagnóstico acionável, honesto e específico — sem floreios genéricos.

Receberá um JSON com métricas da campanha (equipe, contatos/CRM, visitas de campo, reportes de rua, pesquisas, jornada do eleitor/funil, engajamento, metas, uso de IA, WhatsApp).

Analise CADA fase do funil (captura → relacionamento → conversão → mobilização) e identifique o que está funcionando e o que está travando. Quando um dado estiver zerado ou ausente, trate como sinal (ex.: "sem pesquisas = cego sobre intenção de voto"), não ignore.

Se for fornecido um RELATÓRIO ANTERIOR, COMPARE os dados atuais com ele e identifique avanços e retrocessos concretos (com números quando possível). Se não houver anterior, marque evolucao.comparavel = false.

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
  ],
  "evolucao": {
    "comparavel": <true se havia relatório anterior, senão false>,
    "scoreAnterior": <número 0-100 do relatório anterior, ou null>,
    "tendencia": "<avanco|estavel|retrocesso>",
    "avancos": ["<o que melhorou desde a última análise, com números>"],
    "retrocessos": ["<o que piorou ou estagnou>"],
    "resumoComparativo": "<1-3 frases comparando com a análise anterior>"
  }
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

  // Lê a config fiscal (singleton). Fallback seguro se a linha não existir.
  async function loadTaxSettings() {
    const { data } = await supabaseAdmin
      .from('tax_settings')
      .select('regime, anexo_override, cnae, usdBrlRate')
      .eq('id', 'global')
      .maybeSingle();
    return {
      regime: data?.regime ?? 'simples',
      anexoOverride: (data?.anexo_override ?? 'auto') as 'auto' | 'III' | 'V',
      cnae: data?.cnae ?? null,
      usdBrlRate: Number(data?.usdBrlRate ?? 5.40) || 5.40,
    };
  }

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

  // ── GET /audit-logs ─────────────────────────────────────────────────
  // Enriched audit feed (who did what), filterable by action substring and
  // severity. Resolves actorId → user name/email.
  router.get('/audit-logs', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10) || 100, 500);
      const action = req.query.action ? String(req.query.action) : null;
      const severity = req.query.severity ? String(req.query.severity) : null;
      const { data, error } = await supabaseAdmin.rpc('supreme_audit_logs', {
        p_limit: limit, p_action: action, p_severity: severity,
      });
      if (error) return res.status(500).json({ error: 'audit_failed', detail: error.message });
      return res.json({ logs: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'audit_failed' });
    }
  });

  // ── GET /access-log ─────────────────────────────────────────────────
  // Per-user access view: last sign-in, registration, action count.
  router.get('/access-log', async (_req: Request, res: Response) => {
    try {
      const { data, error } = await supabaseAdmin.rpc('supreme_access_log');
      if (error) return res.status(500).json({ error: 'access_failed', detail: error.message });
      return res.json({ access: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'access_failed' });
    }
  });

  // ── GET /financial ──────────────────────────────────────────────────
  // SaaS financial dashboard: MRR/ARR, subscriptions by status, per-plan
  // distribution, overdue (past_due) campaigns, confirmed revenue, AI cost.
  router.get('/financial', async (_req: Request, res: Response) => {
    try {
      const cfg = await loadTaxSettings();
      const { data, error } = await supabaseAdmin.rpc('supreme_financial_metrics', { p_usd_brl: cfg.usdBrlRate });
      if (error) return res.status(500).json({ error: 'financial_failed', detail: error.message });
      return res.json({ financial: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'financial_failed' });
    }
  });

  // ── Notas Fiscais (rastreador manual de NFS-e) ──────────────────────
  router.get('/invoices', async (_req: Request, res: Response) => {
    try {
      const { data, error } = await supabaseAdmin.rpc('supreme_nf_summary');
      if (error) return res.status(500).json({ error: 'nf_failed', detail: error.message });
      return res.json({ nf: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'nf_failed' });
    }
  });

  router.post('/invoices', async (req: Request, res: Response) => {
    try {
      const { number, amountCents, customerName, customerDoc, description, campaignId, issuedAt, status } = req.body ?? {};
      const cents = Number(amountCents);
      if (!Number.isFinite(cents) || cents < 0) return res.status(400).json({ error: 'invalid_amount' });
      const { data, error } = await supabaseAdmin.from('nf_invoices').insert({
        number: number ?? null,
        amountCents: Math.round(cents),
        customerName: customerName ?? null,
        customerDoc: customerDoc ?? null,
        description: description ?? null,
        campaignId: campaignId ?? null,
        issuedAt: issuedAt || new Date().toISOString().slice(0, 10),
        status: ['rascunho', 'emitida', 'cancelada', 'substituida'].includes(status) ? status : 'emitida',
        provider: 'manual',
        createdBy: (req as any).user?.id ?? null,
      }).select('id').single();
      if (error) return res.status(500).json({ error: 'nf_create_failed', detail: error.message });
      await audit(supabaseAdmin, {
        ...actorFromRequest(req), action: 'supreme.invoice.create', severity: 'info',
        metadata: { number, amountCents: Math.round(cents), customerName },
      }).catch(() => {});
      return res.status(201).json({ id: data?.id });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'nf_create_failed' });
    }
  });

  router.patch('/invoices/:id', async (req: Request, res: Response) => {
    try {
      const updates: Record<string, unknown> = {};
      if (['rascunho', 'emitida', 'cancelada', 'substituida'].includes(req.body?.status)) updates.status = req.body.status;
      if (typeof req.body?.pdfUrl === 'string') updates.pdfUrl = req.body.pdfUrl;
      if (typeof req.body?.number === 'string') updates.number = req.body.number;
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'no_fields' });
      const { error } = await supabaseAdmin.from('nf_invoices').update(updates).eq('id', req.params.id);
      if (error) return res.status(500).json({ error: 'nf_update_failed', detail: error.message });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'nf_update_failed' });
    }
  });

  router.delete('/invoices/:id', async (req: Request, res: Response) => {
    try {
      const { error } = await supabaseAdmin.from('nf_invoices').delete().eq('id', req.params.id);
      if (error) return res.status(500).json({ error: 'nf_delete_failed', detail: error.message });
      return res.status(204).end();
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'nf_delete_failed' });
    }
  });

  // ── GET/PUT /tax-config ─────────────────────────────────────────────
  // Configuração fiscal manual (regime, anexo override, CNAE, taxa USD).
  router.get('/tax-config', async (_req: Request, res: Response) => {
    try {
      const cfg = await loadTaxSettings();
      return res.json({ config: cfg });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'tax_config_failed' });
    }
  });

  router.put('/tax-config', async (req: Request, res: Response) => {
    try {
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (['simples', 'presumido'].includes(req.body?.regime)) updates.regime = req.body.regime;
      if (['auto', 'III', 'V'].includes(req.body?.anexoOverride)) updates.anexo_override = req.body.anexoOverride;
      if (typeof req.body?.cnae === 'string') updates.cnae = req.body.cnae.trim() || null;
      if (req.body?.usdBrlRate !== undefined) {
        const r = Number(req.body.usdBrlRate);
        if (!Number.isFinite(r) || r <= 0) return res.status(400).json({ error: 'invalid_rate' });
        updates.usdBrlRate = r;
      }
      const { error } = await supabaseAdmin.from('tax_settings').update(updates).eq('id', 'global');
      if (error) return res.status(500).json({ error: 'tax_config_update_failed', detail: error.message });
      await audit(supabaseAdmin, {
        ...actorFromRequest(req), action: 'supreme.tax_config.update', severity: 'info', metadata: updates,
      }).catch(() => {});
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'tax_config_update_failed' });
    }
  });

  // ── Form Builder (F5): campos personalizáveis por campanha ──────────
  // Schema vive em campaign_configs.custom_fields (jsonb), chaveado por alvo.
  router.get('/forms/:campaignId', async (req: Request, res: Response) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('campaign_configs')
        .select('customFields')
        .eq('id', req.params.campaignId)
        .maybeSingle();
      if (error) return res.status(500).json({ error: 'forms_load_failed', detail: error.message });
      return res.json({ schema: sanitizeFormSchema(data?.customFields) });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'forms_load_failed' });
    }
  });

  router.put('/forms/:campaignId', async (req: Request, res: Response) => {
    try {
      const campaignId = req.params.campaignId;
      if (!campaignId) return res.status(400).json({ error: 'missing_campaign' });
      const schema = sanitizeFormSchema(req.body?.schema);
      // upsert preserva limits/features existentes; cria a linha se não existir.
      const { error } = await supabaseAdmin
        .from('campaign_configs')
        .upsert({ id: campaignId, customFields: schema }, { onConflict: 'id' });
      if (error) return res.status(500).json({ error: 'forms_save_failed', detail: error.message });
      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'supreme.forms.update',
        severity: 'info',
        metadata: { campaignId, counts: Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, (v as any[]).length])) },
      }).catch(() => {});
      return res.json({ ok: true, schema });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'forms_save_failed' });
    }
  });

  // ── Formulários públicos (F5b) — gestão pelo Supreme Admin ──────────
  router.get('/forms/:campaignId/public', async (req: Request, res: Response) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('public_forms')
        .select('id, slug, title, description, target, schema, success_message, is_active, submissions_count, created_at')
        .eq('campaign_id', req.params.campaignId)
        .order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: 'public_forms_load_failed', detail: error.message });
      const forms = (data ?? []).map((f: any) => ({
        id: f.id, slug: f.slug, title: f.title, description: f.description, target: f.target,
        schema: f.schema, successMessage: f.success_message, isActive: f.is_active,
        submissionsCount: f.submissions_count, createdAt: f.created_at,
      }));
      return res.json({ forms });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'public_forms_load_failed' });
    }
  });

  router.post('/forms/:campaignId/public', async (req: Request, res: Response) => {
    try {
      const campaignId = req.params.campaignId;
      const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
      if (!title) return res.status(400).json({ error: 'missing_title' });
      const target = ['contacts', 'visits', 'pesquisa'].includes(req.body?.target) ? req.body.target : 'contacts';

      // schema: usa o enviado, ou monta um default (nome/telefone/email + campos internos do alvo)
      let schema = sanitizePublicFields(req.body?.schema);
      if (schema.length === 0) {
        const { data: cfg } = await supabaseAdmin
          .from('campaign_configs').select('customFields').eq('id', campaignId).maybeSingle();
        const internal = sanitizePublicFields((cfg?.customFields?.[target]) || []);
        schema = [
          { id: 'name', label: 'Nome completo', type: 'text', required: true, map: 'name' },
          { id: 'phone', label: 'WhatsApp / Telefone', type: 'phone', required: false, map: 'phone' },
          { id: 'email', label: 'E-mail', type: 'email', required: false, map: 'email' },
          ...internal,
        ];
      }

      const slug = `${slugify(title)}-${Math.random().toString(36).slice(2, 6)}`;
      const { data, error } = await supabaseAdmin.from('public_forms').insert({
        campaign_id: campaignId,
        slug,
        title,
        description: typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 500) : null,
        target,
        schema,
        success_message: typeof req.body?.successMessage === 'string' ? req.body.successMessage.trim().slice(0, 300) : null,
      }).select('id, slug').single();
      if (error) return res.status(500).json({ error: 'public_form_create_failed', detail: error.message });
      await audit(supabaseAdmin, { ...actorFromRequest(req), action: 'supreme.public_form.create', severity: 'info', metadata: { campaignId, slug, title } }).catch(() => {});
      return res.status(201).json({ id: data?.id, slug: data?.slug });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'public_form_create_failed' });
    }
  });

  router.patch('/public-forms/:id', async (req: Request, res: Response) => {
    try {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof req.body?.title === 'string') updates.title = req.body.title.trim().slice(0, 120);
      if (typeof req.body?.description === 'string') updates.description = req.body.description.trim().slice(0, 500) || null;
      if (typeof req.body?.successMessage === 'string') updates.success_message = req.body.successMessage.trim().slice(0, 300) || null;
      if (typeof req.body?.isActive === 'boolean') updates.is_active = req.body.isActive;
      if (Array.isArray(req.body?.schema)) updates.schema = sanitizePublicFields(req.body.schema);
      const { error } = await supabaseAdmin.from('public_forms').update(updates).eq('id', req.params.id);
      if (error) return res.status(500).json({ error: 'public_form_update_failed', detail: error.message });
      await audit(supabaseAdmin, { ...actorFromRequest(req), action: 'supreme.public_form.update', severity: 'info', metadata: { id: req.params.id } }).catch(() => {});
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'public_form_update_failed' });
    }
  });

  router.delete('/public-forms/:id', async (req: Request, res: Response) => {
    try {
      const { error } = await supabaseAdmin.from('public_forms').delete().eq('id', req.params.id);
      if (error) return res.status(500).json({ error: 'public_form_delete_failed', detail: error.message });
      await audit(supabaseAdmin, { ...actorFromRequest(req), action: 'supreme.public_form.delete', severity: 'warning', metadata: { id: req.params.id } }).catch(() => {});
      return res.status(204).end();
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'public_form_delete_failed' });
    }
  });

  router.get('/public-forms/:id/submissions', async (req: Request, res: Response) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('form_submissions')
        .select('id, data, contact_id, created_at')
        .eq('form_id', req.params.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) return res.status(500).json({ error: 'submissions_load_failed', detail: error.message });
      return res.json({ submissions: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'submissions_load_failed' });
    }
  });

  // ── Planos comerciais (#36) ─────────────────────────────────────────
  router.get('/plans', async (_req: Request, res: Response) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('plans')
        .select('*')
        .order('monthlyCents', { ascending: true });
      if (error) return res.status(500).json({ error: 'plans_load_failed', detail: error.message });
      return res.json({ plans: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'plans_load_failed' });
    }
  });

  // ── GET /taxes ──────────────────────────────────────────────────────
  // Estima a DAS do Simples Nacional (SaaS, sede RJ). RBT12 = MRR×12,
  // receita do mês = MRR, folha (Fator R) = custos de salários/pessoal ×12.
  router.get('/taxes', async (_req: Request, res: Response) => {
    try {
      const cfg = await loadTaxSettings();
      const usdBrl = cfg.usdBrlRate;

      // MRR (assinaturas ativas pagas) em reais
      const { data: subs } = await supabaseAdmin
        .from('subscriptions')
        .select('planId, status, plans!inner(monthlyCents)')
        .eq('status', 'active');
      let mrrReais = 0;
      for (const s of (subs as any[]) ?? []) {
        const cents = s.plans?.monthlyCents ?? 0;
        if (cents > 0) mrrReais += cents / 100;
      }

      // Folha mensal: custos de salários/pessoal (converte USD→BRL se houver)
      const { data: costs } = await supabaseAdmin
        .from('platform_costs')
        .select('amountCents, currency, category, recurrence, active')
        .eq('active', true).eq('recurrence', 'monthly')
        .in('category', ['salarios', 'pessoal']);
      let folhaMensalReais = 0;
      for (const c of (costs as any[]) ?? []) {
        const reais = (c.amountCents ?? 0) / 100 * (c.currency === 'USD' ? usdBrl : 1);
        folhaMensalReais += reais;
      }

      const result = calcSimplesNacional({
        rbt12: mrrReais * 12,
        receitaMes: mrrReais,
        folha12: folhaMensalReais * 12,
        anexoOverride: cfg.anexoOverride,
      });

      return res.json({ taxes: { ...result, regime: cfg.regime, cnae: cfg.cnae, anexoOverride: cfg.anexoOverride } });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'taxes_failed' });
    }
  });

  // ── Custos operacionais (infra, IA, impostos…) ──────────────────────
  router.get('/costs', async (_req: Request, res: Response) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('platform_costs')
        .select('id, category, description, amountCents, recurrence, active, createdAt')
        .order('amountCents', { ascending: false });
      if (error) return res.status(500).json({ error: 'costs_list_failed', detail: error.message });
      return res.json({ costs: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'costs_list_failed' });
    }
  });

  router.post('/costs', async (req: Request, res: Response) => {
    try {
      const { category, description, amountCents, recurrence, currency } = req.body ?? {};
      const validCats = ['infraestrutura', 'ia', 'impostos', 'pessoal', 'salarios', 'prestadores', 'dominio', 'marketing', 'outros'];
      if (!validCats.includes(category)) return res.status(400).json({ error: 'invalid_category' });
      if (typeof description !== 'string' || !description.trim()) return res.status(400).json({ error: 'invalid_description' });
      const cents = Number(amountCents);
      if (!Number.isFinite(cents) || cents < 0) return res.status(400).json({ error: 'invalid_amount' });

      const { data, error } = await supabaseAdmin.from('platform_costs').insert({
        category,
        description: description.trim(),
        amountCents: Math.round(cents),
        currency: currency === 'USD' ? 'USD' : 'BRL',
        recurrence: recurrence === 'once' ? 'once' : 'monthly',
        createdBy: (req as any).user?.id ?? null,
      }).select('id').single();
      if (error) return res.status(500).json({ error: 'cost_create_failed', detail: error.message });

      await audit(supabaseAdmin, {
        ...actorFromRequest(req), action: 'supreme.cost.create', severity: 'info',
        metadata: { category, description, amountCents: Math.round(cents) },
      }).catch(() => {});
      return res.status(201).json({ id: data?.id });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'cost_create_failed' });
    }
  });

  router.patch('/costs/:id', async (req: Request, res: Response) => {
    try {
      const updates: Record<string, unknown> = {};
      if (req.body?.amountCents !== undefined) {
        const c = Number(req.body.amountCents);
        if (!Number.isFinite(c) || c < 0) return res.status(400).json({ error: 'invalid_amount' });
        updates.amountCents = Math.round(c);
      }
      if (typeof req.body?.active === 'boolean') updates.active = req.body.active;
      if (typeof req.body?.description === 'string') updates.description = req.body.description.trim();
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'no_fields' });
      const { error } = await supabaseAdmin.from('platform_costs').update(updates).eq('id', req.params.id);
      if (error) return res.status(500).json({ error: 'cost_update_failed', detail: error.message });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'cost_update_failed' });
    }
  });

  router.delete('/costs/:id', async (req: Request, res: Response) => {
    try {
      const { error } = await supabaseAdmin.from('platform_costs').delete().eq('id', req.params.id);
      if (error) return res.status(500).json({ error: 'cost_delete_failed', detail: error.message });
      return res.status(204).end();
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'cost_delete_failed' });
    }
  });

  // ── POST /financial/run-lifecycle ───────────────────────────────────
  // Manually trigger the billing lifecycle sweep (reminders, auto-downgrade
  // of stale past_due, expire canceled). Normally runs every 6h on its own
  // (startLifecycleSweeper in server.ts) — this lets the operator force it.
  router.post('/financial/run-lifecycle', async (req: Request, res: Response) => {
    try {
      const result = await runLifecycleSweep(supabaseAdmin);
      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'supreme.financial.run_lifecycle',
        severity: 'info',
        metadata: result as any,
      }).catch(() => {});
      return res.json({ result });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'lifecycle_failed' });
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

      // 1b. Fetch the most recent previous report so the AI can compare
      // (advances/regressions). Only a compact slice is sent to keep tokens low.
      const { data: prev } = await supabaseAdmin
        .from('consultant_reports')
        .select('analysis, snapshot, createdAt')
        .eq('campaignId', campaignId)
        .order('createdAt', { ascending: false })
        .limit(1)
        .maybeSingle();

      let previousBlock = '';
      if (prev?.analysis) {
        const prevCompact = {
          data: prev.createdAt,
          scoreConversao: prev.analysis.scoreConversao,
          resumoExecutivo: prev.analysis.resumoExecutivo,
          maiorGargalo: prev.analysis.funilConversao?.maiorGargalo,
          // key metrics from the prior snapshot for numeric comparison
          metricas: prev.snapshot ? {
            contatos: prev.snapshot.contacts?.total,
            visitas: prev.snapshot.visits?.total,
            reportes: prev.snapshot.streetReports?.total,
            whatsappMsgs: prev.snapshot.whatsapp?.messages,
            funil: prev.snapshot.voterJourney,
          } : null,
        };
        previousBlock =
          `\n\nRELATÓRIO ANTERIOR (gerado em ${prev.createdAt}) — compare com os dados atuais:\n` +
          `${JSON.stringify(prevCompact, null, 2)}`;
      }

      // 2. Ask the consultant agent (multi-provider chain inside callAgent)
      const prompt =
        `Analise esta campanha e devolva o JSON conforme instruído.\n\n` +
        `DADOS DA CAMPANHA (atuais):\n${JSON.stringify(snapshot, null, 2)}` +
        previousBlock;

      let result;
      try {
        result = await callAgent(supabaseAdmin, 'campaign_consultant', prompt, {
          campaignId,
          userId: (req as any).user?.id ?? null,
          systemInstruction: CONSULTANT_SYSTEM,
          // Análise estratégica = entrega em primeiro lugar: usa o provider mais
          // capaz disponível (entre os que têm API key configurada).
          complexity: 'premium',
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

  // ── GET /campaigns/:id/snapshot ─────────────────────────────────────
  // Per-campaign analytics snapshot (no AI). Powers the dashboard's
  // per-campaign filter — same data the consultant analyzes, but cheap.
  router.get('/campaigns/:id/snapshot', async (req: Request, res: Response) => {
    try {
      const { data, error } = await supabaseAdmin.rpc('supreme_campaign_analytics', {
        p_campaign_id: req.params.id,
      });
      if (error) return res.status(500).json({ error: 'snapshot_failed', detail: error.message });
      return res.json({ snapshot: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'snapshot_failed' });
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
