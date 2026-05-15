import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { ingestChunks, search } from './vectorStore';

export function createRagRouter(supabaseAdmin: SupabaseClient) {
  const router = Router();

  /**
   * POST /api/v1/rag/ingest
   * Body: { chunks: [{ source, content, metadata? }] }
   */
  router.post('/ingest', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId ?? req.body.campaignId;
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      const incoming = (req.body.chunks ?? []) as Array<{
        source: string;
        content: string;
        metadata?: Record<string, unknown>;
      }>;

      if (!incoming.length) return res.status(400).json({ error: 'chunks vazio' });

      const count = await ingestChunks(
        supabaseAdmin,
        incoming.map(c => ({ ...c, campaignId }))
      );

      return res.json({ ok: true, ingested: count });
    } catch (err: any) {
      console.error('[RAG] ingest:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/v1/rag/search?q=...&limit=5
   */
  router.get('/search', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId ?? (req.query.campaignId as string);
      const q = (req.query.q as string)?.trim();
      const limit = Math.min(Number(req.query.limit) || 5, 20);

      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });
      if (!q) return res.status(400).json({ error: 'parâmetro q obrigatório' });

      const results = await search(supabaseAdmin, campaignId, q, limit);
      return res.json({ results });
    } catch (err: any) {
      console.error('[RAG] search:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
