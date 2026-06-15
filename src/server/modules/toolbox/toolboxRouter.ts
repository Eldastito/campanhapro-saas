/**
 * Toolbox Router (#140) — ferramentas administrativas:
 *
 *   FAQ (Banco de Respostas Aprovadas):
 *     GET    /api/v1/toolbox/faq
 *     POST   /api/v1/toolbox/faq                    → cria (draft)
 *     PATCH  /api/v1/toolbox/faq/:id                → edita
 *     DELETE /api/v1/toolbox/faq/:id
 *     POST   /api/v1/toolbox/faq/:id/approve        → aprova + indexa no RAG
 *     POST   /api/v1/toolbox/faq/:id/unapprove      → desfaz
 *
 *   Import CSV (cliente já parseou as linhas):
 *     POST   /api/v1/toolbox/import/contacts        → batch insert
 *     POST   /api/v1/toolbox/import/team            → batch insert
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ingestArtifact } from '../rag/knowledgeIngest';

const MAX_IMPORT_ROWS = 5000;

export function createToolboxRouter(supabase: SupabaseClient): Router {
  const router = Router();

  function isAdmin(req: Request): boolean {
    const t = (req as any).user?.userType;
    return t === 'Admin' || t === 'Coordenador' || t === 'Candidato' || t === 'Líder' || (req as any).user?.isSupremeAdmin === true;
  }

  // ── FAQ: lista ────────────────────────────────────────────────────────
  router.get('/faq', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    const status = String(req.query.status || 'all');
    let q = supabase.from('faq_entries')
      .select('*').eq('campaignId', campaignId)
      .order('updatedAt', { ascending: false }).limit(500);
    if (status !== 'all') q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ entries: data || [] });
  });

  // ── FAQ: cria ─────────────────────────────────────────────────────────
  router.post('/faq', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    const userId = (req as any).user?.id;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });
    const b = req.body || {};
    if (!b.question?.trim() || !b.answer?.trim()) {
      return res.status(400).json({ error: 'question e answer obrigatórios' });
    }
    const { data, error } = await supabase.from('faq_entries').insert({
      campaignId,
      question: String(b.question).trim().slice(0, 500),
      answer: String(b.answer).trim().slice(0, 4000),
      category: b.category ? String(b.category).trim().slice(0, 60) : null,
      tags: Array.isArray(b.tags) ? b.tags.map((t: any) => String(t).trim()).slice(0, 10) : null,
      status: 'draft',
      createdBy: userId || null,
    }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ entry: data });
  });

  // ── FAQ: edita ────────────────────────────────────────────────────────
  router.patch('/faq/:id', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });
    const b = req.body || {};
    const update: any = { updatedAt: new Date().toISOString() };
    if (b.question) update.question = String(b.question).trim().slice(0, 500);
    if (b.answer) update.answer = String(b.answer).trim().slice(0, 4000);
    if (b.category !== undefined) update.category = b.category ? String(b.category).trim().slice(0, 60) : null;
    if (Array.isArray(b.tags)) update.tags = b.tags.map((t: any) => String(t).trim()).slice(0, 10);
    // Editar reseta pra draft (re-aprovação obrigatória)
    if (b.question || b.answer) {
      update.status = 'draft';
      update.approvedBy = null;
      update.approvedAt = null;
      update.lastIndexedAt = null;
    }
    const { error } = await supabase.from('faq_entries')
      .update(update).eq('id', req.params.id).eq('campaignId', campaignId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  });

  // ── FAQ: deleta ───────────────────────────────────────────────────────
  router.delete('/faq/:id', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });
    await supabase.from('faq_entries').delete()
      .eq('id', req.params.id).eq('campaignId', campaignId);
    return res.json({ ok: true });
  });

  // ── FAQ: aprova + indexa no RAG ───────────────────────────────────────
  router.post('/faq/:id/approve', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      const userId = (req as any).user?.id;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
      if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

      const { data: entry, error } = await supabase.from('faq_entries')
        .select('*').eq('id', req.params.id).eq('campaignId', campaignId)
        .maybeSingle();
      if (error || !entry) return res.status(404).json({ error: 'not_found' });

      const e = entry as any;
      const text = `PERGUNTA: ${e.question}\n\nRESPOSTA OFICIAL DA CAMPANHA:\n${e.answer}\n\nCategoria: ${e.category || 'geral'}\nTags: ${(e.tags || []).join(', ')}`;
      const title = `FAQ: ${e.question.slice(0, 80)}`;

      // Indexa no RAG. Aurora vai consultar via retrieveContext.
      await ingestArtifact(supabase, {
        campaignId,
        source: 'faq:approved',
        title,
        text,
        metadata: {
          faqId: e.id,
          category: e.category,
          tags: e.tags,
          hasPrimarySources: true,
          primarySources: [{ url: null, title: 'Banco de Respostas Aprovado' }],
        },
      });

      await supabase.from('faq_entries').update({
        status: 'approved',
        approvedBy: userId || null,
        approvedAt: new Date().toISOString(),
        lastIndexedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).eq('id', req.params.id);

      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[toolbox] faq approve:', err);
      return res.status(500).json({ error: err?.message });
    }
  });

  router.post('/faq/:id/unapprove', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });
    await supabase.from('faq_entries').update({
      status: 'draft',
      approvedBy: null, approvedAt: null,
      updatedAt: new Date().toISOString(),
    }).eq('id', req.params.id).eq('campaignId', campaignId);
    return res.json({ ok: true });
  });

  // ── IMPORT: contacts ─────────────────────────────────────────────────
  router.post('/import/contacts', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
      if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

      const rows = Array.isArray((req.body || {}).rows) ? (req.body || {}).rows : [];
      if (rows.length === 0) return res.status(400).json({ error: 'sem_linhas' });
      if (rows.length > MAX_IMPORT_ROWS) {
        return res.status(400).json({ error: 'muitas_linhas', max: MAX_IMPORT_ROWS, recebido: rows.length });
      }

      // Normaliza + dedupe pelo phone (mantém o último)
      const now = new Date().toISOString();
      const seen = new Map<string, any>();
      let skippedNoName = 0;
      for (const r of rows) {
        const name = String(r.name ?? r.nome ?? '').trim();
        if (!name) { skippedNoName++; continue; }
        const phone = String(r.phone ?? r.telefone ?? r.tel ?? '').replace(/\D+/g, '') || null;
        const key = phone || `noname:${name}:${Math.random()}`;
        seen.set(key, {
          campaignId, name,
          phone, email: r.email ? String(r.email).trim() : null,
          neighborhood: r.neighborhood ?? r.bairro ? String(r.neighborhood ?? r.bairro).trim() : null,
          city: r.city ?? r.cidade ? String(r.city ?? r.cidade).trim() : null,
          source: 'csv_import',
          tags: ['csv'],
          supportLevel: 'indeciso',
          createdAt: now,
        });
      }
      const toInsert = [...seen.values()];

      // Filtra duplicatas no banco (por phone)
      const phones = toInsert.map((r: any) => r.phone).filter(Boolean);
      let existingPhones = new Set<string>();
      if (phones.length > 0) {
        const { data: existing } = await supabase
          .from('contacts').select('phone')
          .eq('campaignId', campaignId).in('phone', phones);
        existingPhones = new Set((existing || []).map((c: any) => c.phone));
      }

      const finalRows = toInsert.filter((r: any) => !r.phone || !existingPhones.has(r.phone));
      const skipped = toInsert.length - finalRows.length;

      if (finalRows.length === 0) {
        return res.json({ ok: true, inserted: 0, skipped, skippedNoName, message: 'Todos os contatos já existem no CRM.' });
      }

      // Insert em chunks de 500
      let inserted = 0;
      for (let i = 0; i < finalRows.length; i += 500) {
        const chunk = finalRows.slice(i, i + 500);
        const { error } = await supabase.from('contacts').insert(chunk);
        if (error) return res.status(500).json({ error: error.message, inseridos_ate_falha: inserted });
        inserted += chunk.length;
      }

      return res.json({ ok: true, inserted, skipped, skippedNoName });
    } catch (err: any) {
      console.error('[toolbox] import contacts:', err);
      return res.status(500).json({ error: err?.message });
    }
  });

  // ── IMPORT: team ─────────────────────────────────────────────────────
  router.post('/import/team', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
      if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

      const rows = Array.isArray((req.body || {}).rows) ? (req.body || {}).rows : [];
      if (rows.length === 0) return res.status(400).json({ error: 'sem_linhas' });
      if (rows.length > 500) return res.status(400).json({ error: 'muitas_linhas', max: 500 });

      const validRoles = new Set(['Apoiador', 'Líder', 'Colaborador', 'Pesquisador', 'Fiscal']);
      const now = new Date().toISOString();
      let skippedNoName = 0;
      const toInsert: any[] = [];
      for (const r of rows) {
        const name = String(r.name ?? r.nome ?? '').trim();
        if (!name) { skippedNoName++; continue; }
        const roleRaw = String(r.role ?? r.funcao ?? r.função ?? 'Apoiador').trim();
        const role = validRoles.has(roleRaw) ? roleRaw : 'Apoiador';
        toInsert.push({
          campaignId, name,
          email: r.email ? String(r.email).trim() : null,
          phone: r.phone ?? r.telefone ? String(r.phone ?? r.telefone).replace(/\D+/g, '') : null,
          role,
          cost: r.cost ?? r.custo ? Number(r.cost ?? r.custo) || 0 : 0,
          neighborhood: r.neighborhood ?? r.bairro ? String(r.neighborhood ?? r.bairro).trim() : null,
          city: r.city ?? r.cidade ? String(r.city ?? r.cidade).trim() : null,
          createdAt: now,
        });
      }

      if (toInsert.length === 0) return res.json({ ok: true, inserted: 0, skippedNoName });
      const { error } = await supabase.from('team_members').insert(toInsert);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true, inserted: toInsert.length, skippedNoName });
    } catch (err: any) {
      console.error('[toolbox] import team:', err);
      return res.status(500).json({ error: err?.message });
    }
  });

  return router;
}
