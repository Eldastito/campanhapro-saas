/**
 * Public Forms router (F5b) — endpoints SEM autenticação para captação de
 * leads via formulário público (landing). Montado fora do requireAuth.
 *
 *   GET  /api/public/forms/:slug          → render (form ativo)
 *   POST /api/public/forms/:slug/submit   → cria contato + registra submissão
 *
 * Todo acesso ao banco usa supabaseAdmin (service_role). O role anon nunca
 * toca as tabelas diretamente.
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Colunas nativas de `contacts` que um campo do form pode preencher. */
const CONTACT_COLUMN_MAP = new Set(['name', 'email', 'phone', 'neighborhood', 'city']);

interface FormField {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  help?: string;
  map?: string; // se setado e ∈ CONTACT_COLUMN_MAP → vai pra coluna nativa
}

export function createPublicFormsRouter(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // ── GET /:slug — dados públicos do formulário ativo ──────────────────
  router.get('/:slug', async (req: Request, res: Response) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('public_forms')
        .select('id, title, description, target, schema, success_message, is_active')
        .eq('slug', req.params.slug)
        .maybeSingle();
      if (error) return res.status(500).json({ error: 'load_failed' });
      if (!data || !data.is_active) return res.status(404).json({ error: 'form_not_found' });
      // Não expõe ids internos sensíveis além do necessário pra renderizar.
      return res.json({
        form: {
          title: data.title,
          description: data.description,
          schema: Array.isArray(data.schema) ? data.schema : [],
          successMessage: data.success_message,
        },
      });
    } catch {
      return res.status(500).json({ error: 'load_failed' });
    }
  });

  // ── POST /:slug/submit — recebe a submissão ──────────────────────────
  router.post('/:slug/submit', async (req: Request, res: Response) => {
    try {
      const slug = req.params.slug;
      const body = req.body ?? {};
      const values: Record<string, any> = body.data && typeof body.data === 'object' ? body.data : {};

      // Honeypot: bots preenchem campos escondidos. Se vier preenchido,
      // responde sucesso mas descarta (não cria contato).
      if (typeof body._hp === 'string' && body._hp.trim() !== '') {
        return res.status(201).json({ ok: true });
      }

      const { data: form, error: formErr } = await supabaseAdmin
        .from('public_forms')
        .select('id, campaign_id, target, schema, is_active, submissions_count, success_message')
        .eq('slug', slug)
        .maybeSingle();
      if (formErr) return res.status(500).json({ error: 'submit_failed' });
      if (!form || !form.is_active) return res.status(404).json({ error: 'form_not_found' });

      const fields: FormField[] = Array.isArray(form.schema) ? form.schema : [];

      // Valida obrigatórios
      for (const f of fields) {
        if (f.required) {
          const v = values[f.id];
          if (v === undefined || v === null || String(v).trim() === '') {
            return res.status(400).json({ error: 'missing_required', field: f.id, label: f.label });
          }
        }
      }

      // Monta o contato: campos com map → coluna nativa; resto → custom_fields
      // contacts usa colunas camelCase no projeto ativo (campaignId, customFields…)
      const contactRow: Record<string, any> = {
        campaignId: form.campaign_id,
        source: 'public_form',
        tags: [`form:${slug}`],
      };
      const custom: Record<string, any> = {};
      for (const f of fields) {
        const v = values[f.id];
        if (v === undefined) continue;
        if (f.map && CONTACT_COLUMN_MAP.has(f.map)) {
          contactRow[f.map] = typeof v === 'string' ? v.trim() : v;
        } else {
          custom[f.id] = v;
        }
      }
      contactRow.customFields = custom;

      // name é NOT NULL — se o form não capturou nome, usa um placeholder
      if (!contactRow.name || String(contactRow.name).trim() === '') {
        contactRow.name = contactRow.email || contactRow.phone || 'Lead (formulário)';
      }

      const { data: contact, error: cErr } = await supabaseAdmin
        .from('contacts')
        .insert(contactRow)
        .select('id')
        .single();
      if (cErr) return res.status(500).json({ error: 'submit_failed', detail: cErr.message });

      // Registra a submissão (auditoria/analytics) — best-effort
      await supabaseAdmin.from('form_submissions').insert({
        form_id: form.id,
        campaign_id: form.campaign_id,
        data: values,
        contact_id: contact?.id ?? null,
        ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null,
        user_agent: (req.headers['user-agent'] as string)?.slice(0, 300) || null,
      }).catch(() => {});

      // Incrementa contador (não-atômico; ok pra métrica)
      await supabaseAdmin.from('public_forms')
        .update({ submissions_count: (form.submissions_count ?? 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', form.id).catch(() => {});

      return res.status(201).json({ ok: true, message: form.success_message || 'Recebemos seu cadastro. Obrigado!' });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? 'submit_failed' });
    }
  });

  return router;
}
