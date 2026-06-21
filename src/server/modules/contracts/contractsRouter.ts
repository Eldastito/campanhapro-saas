/**
 * Contracts Router — contratos de prestação de serviço / licenciamento (Supreme).
 *
 *   GET    /api/v1/supreme/contracts          lista (resumo)
 *   POST   /api/v1/supreme/contracts          cria
 *   GET    /api/v1/supreme/contracts/:id      detalhe completo
 *   PUT    /api/v1/supreme/contracts/:id      edita
 *   DELETE /api/v1/supreme/contracts/:id      remove
 *
 * Montado atrás de requireSupremeAdmin (só o operador da plataforma). Geração de
 * PDF e assinatura desenhada na tela entram numa etapa seguinte (campo
 * `signatures` já existe na tabela).
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptFields } from '../../lib/fieldCrypto';
import { CANDIDATE_DETAIL_FIELDS } from '../../lib/encryptedFields';

// Campos graváveis pelo cliente (createdAt/updatedAt/createdBy/signatures são do servidor).
const WRITABLE = ['title', 'status', 'campaignId', 'provider', 'client', 'people', 'clauses', 'fields'] as const;

function pick(body: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of WRITABLE) if (k in (body || {})) out[k] = body[k];
  return out;
}

export function createContractsRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // Lista (campos de resumo, sem o corpo pesado).
  router.get('/', async (_req: Request, res: Response) => {
    const { data, error } = await supabase
      .from('contracts')
      .select('id, title, status, "campaignId", provider, client, "createdAt", "updatedAt"')
      .order('createdAt', { ascending: false })
      .limit(500);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ contracts: data ?? [] });
  });

  // Campanhas + cadastro (decifrado) para o seletor e o pré-preenchimento do
  // contratante. Registrado ANTES de /:id pra Express não casar "campaigns" como id.
  router.get('/campaigns', async (_req: Request, res: Response) => {
    const { data: camps, error } = await supabase
      .from('campaigns').select('id, name').order('name', { ascending: true }).limit(1000);
    if (error) return res.status(500).json({ error: error.message });

    const ids = (camps ?? []).map((c: any) => c.id);
    const { data: settings } = ids.length
      ? await supabase.from('settings').select('campaignId, campaignDetails').in('campaignId', ids)
      : { data: [] as any[] };
    const byId = new Map((settings ?? []).map((s: any) => [s.campaignId, s.campaignDetails]));

    const out = (camps ?? []).map((c: any) => {
      const cd = byId.get(c.id) ? decryptFields(byId.get(c.id), CANDIDATE_DETAIL_FIELDS) : null;
      // Mapeia o cadastro da campanha para os campos do contratante (Party).
      const client = cd ? {
        razaoSocial: cd.nomeCompleto || c.name || '',
        cnpj: cd.cnpj || cd.cpf || '',
        endereco: cd.endereco || '',
        cidade: cd.cidade || '',
        estado: cd.estado || '',
        cep: cd.cep || '',
        representante: cd.nomeCompleto || '',
        email: cd.email || '',
        telefone: cd.telefone || '',
      } : { razaoSocial: c.name || '' };
      return { campaignId: c.id, name: c.name || c.id, client };
    });
    return res.json({ campaigns: out });
  });

  // Detalhe completo.
  router.get('/:id', async (req: Request, res: Response) => {
    const { data, error } = await supabase
      .from('contracts').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'not_found' });
    return res.json({ contract: data });
  });

  // Cria.
  router.post('/', async (req: Request, res: Response) => {
    const row = pick(req.body);
    if (!row.title || typeof row.title !== 'string') return res.status(400).json({ error: 'title_required' });
    const { data, error } = await supabase
      .from('contracts')
      .insert({ ...row, createdBy: (req as any).user?.id ?? null })
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ contract: data });
  });

  // Edita.
  router.put('/:id', async (req: Request, res: Response) => {
    const row = pick(req.body);
    if ('title' in row && !row.title) return res.status(400).json({ error: 'title_required' });
    const { data, error } = await supabase
      .from('contracts')
      .update({ ...row, updatedAt: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ contract: data });
  });

  // Coleta uma assinatura desenhada na tela (imagem PNG dataURL). Anexa ao
  // array signatures e marca o contrato como 'signed'.
  router.post('/:id/sign', async (req: Request, res: Response) => {
    const { nome, papel, imageDataUrl } = req.body || {};
    if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'invalid_signature' });
    }
    if (imageDataUrl.length > 3_000_000) return res.status(400).json({ error: 'signature_too_large' });

    const { data: cur, error: getErr } = await supabase
      .from('contracts').select('signatures').eq('id', req.params.id).maybeSingle();
    if (getErr) return res.status(500).json({ error: getErr.message });
    if (!cur) return res.status(404).json({ error: 'not_found' });

    const signatures = Array.isArray((cur as any).signatures) ? (cur as any).signatures : [];
    signatures.push({
      nome: typeof nome === 'string' ? nome.slice(0, 200) : null,
      papel: typeof papel === 'string' ? papel.slice(0, 120) : null,
      imageDataUrl,
      signedAt: new Date().toISOString(),
    });

    const { data, error } = await supabase
      .from('contracts')
      .update({ signatures, status: 'signed', updatedAt: new Date().toISOString() })
      .eq('id', req.params.id).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ contract: data });
  });

  // Remove.
  router.delete('/:id', async (req: Request, res: Response) => {
    const { error } = await supabase.from('contracts').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  });

  return router;
}
