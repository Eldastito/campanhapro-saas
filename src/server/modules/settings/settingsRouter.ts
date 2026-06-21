/**
 * Settings Router — configurações da campanha. Os identificadores do candidato
 * (CPF, CNPJ, RG/identidade) vivem aninhados no JSON `settings.campaignDetails`
 * e passam a ser cifrados em repouso (AES-256-GCM).
 *
 *   GET  /api/v1/settings                  campaignDetails (decifrado) + logos
 *   PUT  /api/v1/settings/campaign-details grava campaignDetails (cifra CPF/CNPJ/RG)
 *   POST /api/v1/settings/migrate-encrypt  (Admin) cifra legado em texto puro
 *
 * POR QUE backend: a chave de criptografia vive só no servidor. A leitura/escrita
 * desses 3 campos sai do browser e passa por aqui. Os demais leitores de
 * campaignDetails (relatórios, telão, página pública) usam outros campos
 * (nomeUrna, numero, electionDate…) e seguem lendo direto — carregam as 3 chaves
 * cifradas sem usá-las. O único leitor de `cnpj` (painel de inteligência) também
 * passou a usar o GET daqui.
 *
 * Logos (headerLogo/footerLogo) continuam gravando direto no cliente — não são
 * sensíveis e o upsert delas não toca a coluna campaignDetails.
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptFields, decryptFields } from '../../lib/fieldCrypto';
import { CANDIDATE_DETAIL_FIELDS } from '../../lib/encryptedFields';

const FIELDS = CANDIDATE_DETAIL_FIELDS; // cpf, cnpj, identidade

function isAdmin(req: Request): boolean {
  const t = (req as any).user?.userType;
  return t === 'Admin' || t === 'Coordenador' || t === 'Candidato' || (req as any).user?.isSupremeAdmin === true;
}

export function createSettingsRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // ── Lê config + logos (campaignDetails decifrado) ─────────────────────────
  router.get('/', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

    const { data, error } = await supabase
      .from('settings')
      .select('*')
      .eq('campaignId', campaignId)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message });

    const cd = data?.campaignDetails ? decryptFields(data.campaignDetails as any, FIELDS) : null;
    return res.json({
      campaignDetails: cd,
      headerLogo: data?.headerLogo ?? null,
      footerLogo: data?.footerLogo ?? null,
    });
  });

  // ── Grava campaignDetails (cifra CPF/CNPJ/RG antes do upsert) ──────────────
  router.put('/campaign-details', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

    const details = req.body?.campaignDetails ?? req.body;
    if (!details || typeof details !== 'object') return res.status(400).json({ error: 'campaignDetails_required' });

    const encrypted = encryptFields(details, FIELDS);
    const { error } = await supabase
      .from('settings')
      .upsert({ campaignId, campaignDetails: encrypted, updatedAt: new Date().toISOString() }, { onConflict: 'campaignId' });
    if (error) return res.status(500).json({ error: error.message });

    // devolve decifrado (= o que o cliente mandou) para o estado local
    return res.json({ campaignDetails: decryptFields(encrypted as any, FIELDS) });
  });

  // ── Migração: cifra legado em texto puro (idempotente) ────────────────────
  router.post('/migrate-encrypt', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

    const { data, error } = await supabase
      .from('settings')
      .select('campaignDetails')
      .eq('campaignId', campaignId)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message });

    const details = data?.campaignDetails as Record<string, any> | undefined;
    if (!details) return res.json({ ok: true, migrated: 0 });

    const encrypted = encryptFields(details, FIELDS); // idempotente: pula null/já-cifrado
    const changed = FIELDS.some((f) => encrypted[f] !== details[f]);
    if (!changed) return res.json({ ok: true, migrated: 0 });

    const { error: upErr } = await supabase
      .from('settings')
      .update({ campaignDetails: encrypted })
      .eq('campaignId', campaignId);
    if (upErr) return res.status(500).json({ error: upErr.message });
    return res.json({ ok: true, migrated: 1 });
  });

  return router;
}
