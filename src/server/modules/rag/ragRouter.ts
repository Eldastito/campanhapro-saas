import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { ingestChunks, search } from './vectorStore';

/** Split text into ~chunkSize-word segments with overlap. */
function chunkText(text: string, chunkSize = 400, overlap = 40): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
    i += chunkSize - overlap;
    if (i + overlap >= words.length && i < words.length) {
      chunks.push(words.slice(i).join(' '));
      break;
    }
  }
  return chunks.filter(c => c.trim().length > 20);
}

export function createRagRouter(supabaseAdmin: SupabaseClient) {
  const router = Router();

  /**
   * POST /api/v1/rag/ingest
   * Body: { chunks: [{ source, content, metadata? }] }
   * Low-level — prefer POST /documents for user-facing uploads.
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

  // -------------------------------------------------------------------------
  // Document management (higher-level API for the ExaForge UI)
  // -------------------------------------------------------------------------

  /**
   * GET /api/v1/rag/documents
   * Lists distinct documents (grouped by source) with chunk counts.
   */
  router.get('/documents', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId as string;
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data, error } = await supabaseAdmin
        .from('knowledge_chunks')
        .select('source, createdAt')
        .eq('campaignId', campaignId)
        .order('createdAt', { ascending: false });

      if (error) throw error;

      // Group by source in JS (documents < 200 per campaign in practice)
      const map = new Map<string, { source: string; chunkCount: number; createdAt: string }>();
      for (const row of data ?? []) {
        if (!map.has(row.source)) {
          map.set(row.source, { source: row.source, chunkCount: 0, createdAt: row.createdAt });
        }
        map.get(row.source)!.chunkCount++;
      }

      const documents = [...map.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );

      return res.json({ documents });
    } catch (err: any) {
      console.error('[RAG] list documents:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/v1/rag/documents
   * Body: { title: string; content: string }
   * Auto-chunks the content and ingests with source=title.
   */
  router.post('/documents', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId as string;
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { title, content } = req.body as { title: string; content: string };
      if (!title?.trim()) return res.status(400).json({ error: 'título obrigatório' });
      if (!content?.trim()) return res.status(400).json({ error: 'conteúdo obrigatório' });
      if (content.length > 2_000_000) return res.status(400).json({ error: 'Conteúdo muito grande (máx 2MB)' });

      const source = title.trim();
      const textChunks = chunkText(content);
      if (textChunks.length === 0) return res.status(400).json({ error: 'Conteúdo muito curto' });

      // Delete existing chunks for this source (allow re-ingestion)
      await supabaseAdmin
        .from('knowledge_chunks')
        .delete()
        .eq('campaignId', campaignId)
        .eq('source', source);

      const count = await ingestChunks(
        supabaseAdmin,
        textChunks.map((chunk, i) => ({
          campaignId,
          source,
          content: chunk,
          metadata: { chunkIndex: i, totalChunks: textChunks.length },
        }))
      );

      return res.status(201).json({ ok: true, source, ingested: count });
    } catch (err: any) {
      console.error('[RAG] upload document:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/v1/rag/documents/:source
   * Removes all chunks for the given source (URL-encoded).
   */
  router.delete('/documents/:source', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId as string;
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      const source = decodeURIComponent(req.params.source);

      const { error } = await supabaseAdmin
        .from('knowledge_chunks')
        .delete()
        .eq('campaignId', campaignId)
        .eq('source', source);

      if (error) throw error;
      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[RAG] delete document:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
