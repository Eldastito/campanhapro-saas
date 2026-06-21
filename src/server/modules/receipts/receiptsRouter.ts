/**
 * Receipts Router — fila de comprovantes enviados por QUALQUER membro da campanha.
 *
 *   POST   /api/v1/receipts            envia comprovante (foto/PDF) + roda OCR
 *   GET    /api/v1/receipts            lista (gestor vê tudo; membro vê os seus)
 *   POST   /api/v1/receipts/:id/approve  (gestor) cria a receita/despesa oficial
 *   POST   /api/v1/receipts/:id/reject   (gestor) recusa com motivo
 *
 * Envio é aberto a todos os perfis (evita perder comprovante). A aprovação —
 * que grava nas contas — é restrita a gestor (Admin/Coordenador). O OCR só
 * SUGERE: nada entra em incomes/expenses sem o revisor confirmar os campos.
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptFields } from '../../lib/fieldCrypto';
import { ENCRYPTED_FIELDS } from '../../lib/encryptedFields';
import { extractReceipt } from './receiptOcr';

const MAX_IMAGE_BYTES = 8_000_000; // ~8MB de data URL

// Campos que o revisor pode confirmar por tipo (whitelist — não confiar no corpo cru).
const INCOME_FIELDS = ['data', 'origem', 'doador', 'documentoDoador', 'descricao', 'valor', 'tipoDocumento',
  'especie', 'fonteRecurso', 'contaReceptora', 'reciboEleitoral'] as const;
const EXPENSE_FIELDS = ['data', 'categoria', 'fornecedor', 'documentoFornecedor', 'descricao', 'valor',
  'tipoDocumento', 'canal', 'regiao', 'formaPagamento', 'tipoGasto', 'dataPagamento'] as const;

function isManager(req: Request): boolean {
  const t = (req as any).user?.userType;
  return t === 'Admin' || t === 'Coordenador' || t === 'Candidato' || (req as any).user?.isSupremeAdmin === true;
}

function pick(body: any, keys: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of keys) if (k in (body || {})) out[k] = body[k];
  return out;
}

export function createReceiptsRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // ── Envia comprovante (qualquer membro) ───────────────────────────────────
  router.post('/', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const campaignId = user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

    const { kind, imageUrl, note } = req.body || {};
    if (kind !== 'income' && kind !== 'expense') return res.status(400).json({ error: 'kind_invalido' });
    if (typeof imageUrl !== 'string' || !imageUrl.startsWith('data:')) return res.status(400).json({ error: 'imagem_invalida' });
    if (imageUrl.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: 'imagem_muito_grande' });

    const isImage = imageUrl.startsWith('data:image/');

    const { data: row, error } = await supabase
      .from('receipt_submissions')
      .insert({
        campaignId, kind, imageUrl,
        note: typeof note === 'string' ? note.slice(0, 500) : null,
        submittedByUserId: user.id ?? null,
        submittedByName: user.name ?? user.email ?? null,
        ocrStatus: isImage ? 'processing' : 'error', // PDF não passa pela visão
      })
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });

    // OCR best-effort (só imagem). Falha não derruba o envio — revisor preenche manual.
    if (isImage) {
      try {
        const ocr = await extractReceipt(imageUrl, kind);
        const { data: upd } = await supabase
          .from('receipt_submissions')
          .update({ ocrData: ocr, ocrStatus: 'done', updatedAt: new Date().toISOString() })
          .eq('id', row.id).select('*').single();
        return res.status(201).json({ submission: upd ?? row });
      } catch {
        await supabase.from('receipt_submissions')
          .update({ ocrStatus: 'error', updatedAt: new Date().toISOString() }).eq('id', row.id);
        return res.status(201).json({ submission: { ...row, ocrStatus: 'error' } });
      }
    }
    return res.status(201).json({ submission: row });
  });

  // ── Lista (gestor vê tudo; membro vê só os próprios) ──────────────────────
  router.get('/', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const campaignId = user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

    let q = supabase.from('receipt_submissions').select('*')
      .eq('campaignId', campaignId).order('createdAt', { ascending: false }).limit(300);
    if (!isManager(req)) q = q.eq('submittedByUserId', user.id);
    if (typeof req.query.status === 'string') q = q.eq('status', req.query.status);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ submissions: data ?? [] });
  });

  // ── Aprova → cria a receita/despesa oficial (gestor) ──────────────────────
  router.post('/:id/approve', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const campaignId = user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    if (!isManager(req)) return res.status(403).json({ error: 'manager_required' });

    const { data: sub, error: getErr } = await supabase
      .from('receipt_submissions').select('*').eq('id', req.params.id).eq('campaignId', campaignId).maybeSingle();
    if (getErr) return res.status(500).json({ error: getErr.message });
    if (!sub) return res.status(404).json({ error: 'not_found' });
    if (sub.status !== 'pending') return res.status(409).json({ error: 'ja_revisado' });

    const base = { campaignId, createdBy: user.id ?? null, createdAt: new Date().toISOString() };
    let linkedTable: 'incomes' | 'expenses';
    let inserted: any;

    if (sub.kind === 'income') {
      const fields = pick(req.body?.fields, INCOME_FIELDS);
      if (!fields.data || !fields.origem) return res.status(400).json({ error: 'campos_obrigatorios' });
      const payload = encryptFields({ ...fields, ...base }, ENCRYPTED_FIELDS.incomes);
      const { data, error } = await supabase.from('incomes').insert(payload).select('id').single();
      if (error) return res.status(500).json({ error: error.message });
      inserted = data; linkedTable = 'incomes';
    } else {
      const fields = pick(req.body?.fields, EXPENSE_FIELDS);
      if (!fields.data) return res.status(400).json({ error: 'campos_obrigatorios' });
      // anexa a imagem do comprovante à despesa criada (expenses tem notaFiscalUrl).
      const { data, error } = await supabase.from('expenses')
        .insert({ ...fields, ...base, notaFiscalUrl: sub.imageUrl, statusDocumento: 'Validado' })
        .select('id').single();
      if (error) return res.status(500).json({ error: error.message });
      inserted = data; linkedTable = 'expenses';
    }

    const { data: updated, error: upErr } = await supabase
      .from('receipt_submissions')
      .update({
        status: 'approved', reviewedByUserId: user.id ?? null, reviewedAt: new Date().toISOString(),
        linkedTable, linkedId: inserted.id, updatedAt: new Date().toISOString(),
      })
      .eq('id', sub.id).select('*').single();
    if (upErr) return res.status(500).json({ error: upErr.message });
    return res.json({ submission: updated, linkedTable, linkedId: inserted.id });
  });

  // ── Recusa (gestor) ───────────────────────────────────────────────────────
  router.post('/:id/reject', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const campaignId = user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    if (!isManager(req)) return res.status(403).json({ error: 'manager_required' });

    const { data, error } = await supabase
      .from('receipt_submissions')
      .update({
        status: 'rejected', rejectionReason: String(req.body?.reason ?? '').slice(0, 500),
        reviewedByUserId: user.id ?? null, reviewedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      })
      .eq('id', req.params.id).eq('campaignId', campaignId).eq('status', 'pending')
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ submission: data });
  });

  return router;
}
