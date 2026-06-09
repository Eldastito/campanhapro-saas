/**
 * Base de Conhecimento de Conversão ("Argumentário").
 *
 * Onde a campanha cadastra: propostas/realizações do candidato (com fonte),
 * comparativos por tema (onde levamos vantagem sobre cada opositor), respostas a
 * objeções, FAQ e LIMITES (o que pode/não pode). É a fonte da verdade que mantém
 * os agentes — e o futuro atendimento ao eleitor — ancorados (anti-alucinação) e
 * focados em conversão de voto.
 *
 * Toda escrita é indexada no RAG, então os agentes encontram esse conteúdo.
 *
 *   GET    /api/v1/playbook            (?type=comparativo)
 *   POST   /api/v1/playbook
 *   PATCH  /api/v1/playbook/:id
 *   DELETE /api/v1/playbook/:id
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ingestArtifact } from '../rag/knowledgeIngest';

const TYPES = ['proposta', 'comparativo', 'objecao', 'faq', 'limite'];

function entryToText(e: any): string {
  const partes = [
    `[${e.type}]${e.tema ? ` (${e.tema})` : ''} ${e.titulo}`,
    e.conteudo,
    e.adversario ? `Referente a: ${e.adversario}` : '',
    e.fonte ? `Fonte: ${e.fonte}` : '',
  ].filter(Boolean);
  return partes.join('\n');
}

export function createPlaybookRouter(supabase: SupabaseClient): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    let q = supabase.from('playbook_entries').select('*').eq('campaignId', campaignId).order('updatedAt', { ascending: false });
    const type = req.query.type as string | undefined;
    if (type && TYPES.includes(type)) q = q.eq('type', type);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ entries: data ?? [] });
  });

  router.post('/', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    const userId = (req as any).user?.id ?? null;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { type, tema, titulo, conteudo, fonte, adversario } = req.body || {};
    if (!titulo?.trim() || !conteudo?.trim()) return res.status(400).json({ error: 'titulo_e_conteudo_obrigatorios' });
    const row = {
      campaignId,
      type: TYPES.includes(type) ? type : 'comparativo',
      tema: tema?.trim() || null,
      titulo: String(titulo).slice(0, 300),
      conteudo: String(conteudo).slice(0, 4000),
      fonte: fonte?.trim() || null,
      adversario: adversario?.trim() || null,
      createdBy: userId,
    };
    const { data, error } = await supabase.from('playbook_entries').insert(row).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    void ingestArtifact(supabase, {
      campaignId, source: `playbook:${row.type}`, title: row.titulo,
      text: entryToText(data), metadata: { playbookId: (data as any).id, type: row.type, tema: row.tema },
    });
    return res.json({ entry: data });
  });

  router.patch('/:id', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const patch: any = {};
    for (const k of ['type', 'tema', 'titulo', 'conteudo', 'fonte', 'adversario', 'ativo']) {
      if (k in (req.body || {})) patch[k] = req.body[k];
    }
    if (patch.type && !TYPES.includes(patch.type)) delete patch.type;
    patch.updatedAt = new Date().toISOString();
    const { data, error } = await supabase.from('playbook_entries')
      .update(patch).eq('id', req.params.id).eq('campaignId', campaignId).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    void ingestArtifact(supabase, {
      campaignId, source: `playbook:${(data as any).type}`, title: (data as any).titulo,
      text: entryToText(data), metadata: { playbookId: (data as any).id, updated: true },
    });
    return res.json({ entry: data });
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { error } = await supabase.from('playbook_entries').delete().eq('id', req.params.id).eq('campaignId', campaignId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  });

  return router;
}
