/**
 * Incomes Router — receitas da campanha com o documento do doador
 * (CPF/CNPJ) criptografado em repouso (AES-256-GCM via fieldCrypto).
 *
 *   GET    /api/v1/incomes              lista da campanha (documentoDoador decifrado)
 *   POST   /api/v1/incomes              cria (documentoDoador cifrado antes do insert)
 *   DELETE /api/v1/incomes/:id          remove (escopado à campanha)
 *   POST   /api/v1/incomes/migrate-encrypt   (Admin) cifra linhas legadas em texto puro
 *
 * POR QUE backend: a chave de criptografia vive só no servidor. Por isso a
 * leitura/escrita do documentoDoador deixou de ser direta do browser e passa
 * por aqui. Demais campos (valor, doador, descrição) não são sensíveis e
 * poderiam ir direto, mas centralizar o CRUD aqui mantém um caminho único.
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptFields, decryptRows } from '../../lib/fieldCrypto';
import { ENCRYPTED_FIELDS } from '../../lib/encryptedFields';

const FIELDS = ENCRYPTED_FIELDS.incomes; // ['documentoDoador']

// Colunas que o cliente pode gravar (whitelist — não confiar no corpo cru).
const WRITABLE = ['data', 'origem', 'doador', 'documentoDoador', 'descricao', 'valor', 'tipoDocumento'] as const;

function isAdmin(req: Request): boolean {
  const t = (req as any).user?.userType;
  return t === 'Admin' || t === 'Coordenador' || t === 'Candidato' || (req as any).user?.isSupremeAdmin === true;
}

export function createIncomesRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // ── Lista ───────────────────────────────────────────────────────────────
  router.get('/', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

    const { data, error } = await supabase
      .from('incomes')
      .select('*')
      .eq('campaignId', campaignId)
      .order('data', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ incomes: decryptRows((data ?? []) as any[], FIELDS) });
  });

  // ── Cria ────────────────────────────────────────────────────────────────
  router.post('/', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const campaignId = user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

    const body = req.body || {};
    const row: Record<string, any> = {};
    for (const k of WRITABLE) if (k in body) row[k] = body[k];
    if (!row.data || !row.origem) return res.status(400).json({ error: 'campos_obrigatorios' });

    const payload = encryptFields(
      { ...row, campaignId, createdBy: user.id, createdAt: new Date().toISOString() },
      FIELDS,
    );

    const { data, error } = await supabase.from('incomes').insert(payload).select('*').single();
    if (error) return res.status(500).json({ error: error.message });

    // Devolve já decifrado (o cliente injeta direto no estado).
    return res.status(201).json({ income: decryptRows([data as any], FIELDS)[0] });
  });

  // ── Remove ───────────────────────────────────────────────────────────────
  router.delete('/:id', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

    const { error } = await supabase
      .from('incomes')
      .delete()
      .eq('id', String(req.params.id))
      .eq('campaignId', campaignId); // escopo: não deixa apagar de outra campanha
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  });

  // ── Migração: cifra linhas legadas em texto puro (idempotente) ────────────
  router.post('/migrate-encrypt', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

    const { data, error } = await supabase
      .from('incomes')
      .select('id, documentoDoador')
      .eq('campaignId', campaignId);
    if (error) return res.status(500).json({ error: error.message });

    let migrated = 0;
    for (const r of (data ?? []) as any[]) {
      const val = r.documentoDoador;
      // encryptFields é idempotente: pula null/vazio e já-cifrado.
      const enc = encryptFields({ documentoDoador: val }, FIELDS).documentoDoador;
      if (enc !== val) {
        const { error: upErr } = await supabase
          .from('incomes')
          .update({ documentoDoador: enc })
          .eq('id', r.id)
          .eq('campaignId', campaignId);
        if (upErr) return res.status(500).json({ error: upErr.message, migrated });
        migrated++;
      }
    }
    return res.json({ ok: true, migrated, scanned: (data ?? []).length });
  });

  return router;
}
