/**
 * Legal Base Router — curadoria da base jurídica compartilhada (Supreme).
 *
 *   GET  /api/v1/supreme/legal-base/queue        fila de revisão (pending)
 *   GET  /api/v1/supreme/legal-base/documents    docs ativos
 *   GET  /api/v1/supreme/legal-base/updates       changelog (rodadas de atualização)
 *   POST /api/v1/supreme/legal-base/import        sobe um doc (texto OU pdfBase64) → pending
 *   POST /api/v1/supreme/legal-base/:id/approve   aprova → ativa chunks
 *   POST /api/v1/supreme/legal-base/:id/reject    rejeita → remove chunks
 *
 * Upload manual + curadoria (sem scraping). Crawler automático fica pra depois.
 * Montado atrás de requireSupremeAdmin: a base é compartilhada por todas as campanhas.
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractPdfText } from './pdfExtract';
import {
  importLegalSource,
  approveSource,
  rejectSource,
  listReviewQueue,
  listActiveDocuments,
  listUpdates,
  type ImportLegalInput,
} from './legalBaseAdmin';
import type { LegalSourceOrg } from './legalKnowledge';

const VALID_ORGS: LegalSourceOrg[] = ['TSE', 'TRE', 'CNJ', 'DJe', 'SPCE', 'OAB', 'OUTRO'];
const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_TEXT_CHARS = 2_000_000;

// Broadcast fire-and-forget: avisa a UI que a base mudou. No-op sem env.
const RT_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const RT_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
function broadcastLegalBase(event: string) {
  if (!RT_URL || !RT_KEY) return;
  fetch(`${RT_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: RT_KEY, Authorization: `Bearer ${RT_KEY}` },
    body: JSON.stringify({ messages: [{ topic: 'legal-base', event, payload: {} }] }),
  }).catch(() => {});
}

export function createLegalBaseRouter(supabase: SupabaseClient): Router {
  const router = Router();

  router.get('/queue', async (_req: Request, res: Response) => {
    try {
      return res.json({ documents: await listReviewQueue(supabase) });
    } catch (err: any) {
      console.error('[LegalBase] queue:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  router.get('/documents', async (_req: Request, res: Response) => {
    try {
      return res.json({ documents: await listActiveDocuments(supabase) });
    } catch (err: any) {
      console.error('[LegalBase] documents:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  router.get('/updates', async (_req: Request, res: Response) => {
    try {
      return res.json({ updates: await listUpdates(supabase) });
    } catch (err: any) {
      console.error('[LegalBase] updates:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/import', async (req: Request, res: Response) => {
    try {
      const { title, content, pdfBase64, sourceOrg, sourceUrl, docNumber, electionYear, publishedAt } =
        req.body || {};

      if (!title || typeof title !== 'string') return res.status(400).json({ error: 'title_required' });
      if (!sourceOrg || !VALID_ORGS.includes(sourceOrg)) {
        return res.status(400).json({ error: 'invalid_sourceOrg', allowed: VALID_ORGS });
      }

      // Texto: ou vem direto, ou é extraído do PDF (base64).
      let text: string | undefined = typeof content === 'string' ? content : undefined;
      if (!text && typeof pdfBase64 === 'string' && pdfBase64.length > 0) {
        const buf = Buffer.from(pdfBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64');
        if (buf.length > MAX_PDF_BYTES) return res.status(400).json({ error: 'pdf_too_large' });
        const extracted = await extractPdfText(buf);
        text = extracted.text;
      }
      if (!text || !text.trim()) return res.status(400).json({ error: 'content_or_pdf_required' });
      if (text.length > MAX_TEXT_CHARS) return res.status(400).json({ error: 'content_too_large' });

      const input: ImportLegalInput = {
        title,
        content: text,
        sourceOrg,
        sourceUrl: typeof sourceUrl === 'string' ? sourceUrl : undefined,
        docNumber: typeof docNumber === 'string' ? docNumber : undefined,
        electionYear: Number.isInteger(electionYear) ? electionYear : undefined,
        publishedAt: typeof publishedAt === 'string' ? publishedAt : undefined,
        userId: (req as any).user?.id ?? null,
      };

      const result = await importLegalSource(supabase, input);
      if (result.status === 'imported') broadcastLegalBase('queue-updated');
      return res.status(201).json(result);
    } catch (err: any) {
      console.error('[LegalBase] import:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/approve', async (req: Request, res: Response) => {
    try {
      const r = await approveSource(supabase, req.params.id, (req as any).user?.id);
      if (!r.ok) return res.status(404).json({ error: r.error });
      broadcastLegalBase('base-updated');
      return res.json({ ok: true, document: r.document });
    } catch (err: any) {
      console.error('[LegalBase] approve:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/reject', async (req: Request, res: Response) => {
    try {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : undefined;
      const r = await rejectSource(supabase, req.params.id, (req as any).user?.id, reason);
      if (!r.ok) return res.status(404).json({ error: r.error });
      broadcastLegalBase('base-updated');
      return res.json({ ok: true, document: r.document });
    } catch (err: any) {
      console.error('[LegalBase] reject:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
