/**
 * Team Public Router — auto-cadastro de apoiador via link público (anônimo).
 *
 *   POST /api/public/team/register
 *
 * POR QUE backend: a página de cadastro público (PublicTeamRegistrationPage)
 * gravava direto em team_members via RLS anon, em TEXTO PURO — vazando CPF/RG/
 * título/banco/PIX do apoiador no banco. Aqui o backend cifra esses campos
 * (AES-256-GCM) antes do insert, igual ao fluxo autenticado (teamMembersRouter).
 *
 * Sem auth (montado com webhookLimiter). Valida que a campanha existe antes de
 * inserir, espelhando o verifyCampaign da página (campaign_configs ou users).
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptFields } from '../../lib/fieldCrypto';
import { ENCRYPTED_FIELDS } from '../../lib/encryptedFields';

const FIELDS = ENCRYPTED_FIELDS.team_members;

// Campos aceitos no auto-cadastro (sem role/cost/userId — role é forçada).
const PUBLIC_WRITABLE = [
  'name', 'email', 'phone', 'cpf', 'rg', 'voterId',
  'zipcode', 'address', 'neighborhood', 'city', 'state',
  'bankName', 'bankAgency', 'bankAccount', 'pixKey',
] as const;

export function createTeamPublicRouter(supabase: SupabaseClient): Router {
  const router = Router();

  router.post('/register', async (req: Request, res: Response) => {
    const body = req.body || {};
    const campaignId = String(body.campaignId || '').trim();
    if (!campaignId) return res.status(400).json({ error: 'campaignId_required' });

    // Valida a campanha (mesma lógica do verifyCampaign da página).
    const { data: cfg } = await supabase
      .from('campaign_configs').select('id').eq('id', campaignId).maybeSingle();
    if (!cfg) {
      const { data: usr } = await supabase
        .from('users').select('id').eq('id', campaignId).maybeSingle();
      if (!usr) return res.status(404).json({ error: 'campaign_not_found' });
    }

    const row: Record<string, any> = {};
    for (const k of PUBLIC_WRITABLE) {
      if (k in body && body[k] !== '' && body[k] != null) row[k] = body[k];
    }
    if (!row.name) return res.status(400).json({ error: 'name_required' });

    const payload = encryptFields(
      { ...row, campaignId, role: 'Apoiador', createdAt: new Date().toISOString() },
      FIELDS,
    );
    const { error } = await supabase.from('team_members').insert(payload);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ ok: true });
  });

  return router;
}
