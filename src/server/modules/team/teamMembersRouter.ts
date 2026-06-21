/**
 * Team Members Router — CRUD da linha de equipe com identificadores sensíveis
 * (CPF, RG, banco/agência/conta, PIX) criptografados em repouso (AES-256-GCM).
 *
 *   GET    /api/v1/team-members              lista (escopo por papel + decifrado)
 *   POST   /api/v1/team-members              cria a linha (cifra antes do insert)
 *   PATCH  /api/v1/team-members/:id          edita (cifra antes do update)
 *   POST   /api/v1/team-members/migrate-encrypt   (Admin) cifra legado texto puro
 *
 * POR QUE backend: a chave de criptografia vive só no servidor. O escopo por
 * papel (Líder vê seus liderados; demais não-admin veem só a própria linha)
 * antes ficava no TeamContext via select() — agora é replicado aqui, porque a
 * leitura precisa passar pelo backend pra decifrar.
 *
 * A criação da IDENTIDADE DE LOGIN (auth.users) continua em teamInvitesRouter
 * (POST /api/v1/team/members) — aqui é só a linha de dados em team_members.
 * Deleção segue direta no cliente (não toca campo cifrado).
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptFields, decryptRows } from '../../lib/fieldCrypto';
import { ENCRYPTED_FIELDS } from '../../lib/encryptedFields';

const FIELDS = ENCRYPTED_FIELDS.team_members; // cpf, rg, bank*, pixKey

// Colunas graváveis pelo cliente (whitelist — campaignId/addedBy são do servidor).
const WRITABLE = [
  'name', 'role', 'email', 'phone', 'assignedLeaderId', 'cost',
  'cpf', 'rg', 'voterId', 'address', 'neighborhood', 'city', 'state', 'zipcode',
  'bankName', 'bankAgency', 'bankAccount', 'pixKey', 'userId',
] as const;

function isAdmin(req: Request): boolean {
  const t = (req as any).user?.userType;
  return t === 'Admin' || t === 'Coordenador' || t === 'Candidato' || (req as any).user?.isSupremeAdmin === true;
}

function pickWritable(body: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of WRITABLE) if (k in (body || {})) out[k] = body[k];
  return out;
}

export function createTeamMembersRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // ── Lista (escopo por papel idêntico ao antigo TeamContext) ───────────────
  router.get('/', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const campaignId = user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

    let q = supabase.from('team_members').select('*').eq('campaignId', campaignId);
    if (user.userType === 'Líder') {
      q = q.eq('assignedLeaderId', user.id);
    } else if (user.userType !== 'Admin' && user.userType !== 'Candidato') {
      q = q.eq('email', user.email);
    }

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ members: decryptRows((data ?? []) as any[], FIELDS) });
  });

  // ── Cria a linha ──────────────────────────────────────────────────────────
  router.post('/', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const campaignId = user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

    const row = pickWritable(req.body);
    if (!row.name) return res.status(400).json({ error: 'name_required' });

    // Líder só cadastra liderado dele; demais usam o que veio (ou null).
    const assignedLeaderId = user.userType === 'Líder' ? user.id : (row.assignedLeaderId ?? null);

    const payload = encryptFields(
      { ...row, campaignId, addedBy: user.id, assignedLeaderId },
      FIELDS,
    );

    const { data, error } = await supabase.from('team_members').insert(payload).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ member: decryptRows([data as any], FIELDS)[0] });
  });

  // ── Edita ───────────────────────────────────────────────────────────────
  router.patch('/:id', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

    const row = pickWritable(req.body);
    const payload = encryptFields(row, FIELDS);

    const { data, error } = await supabase
      .from('team_members')
      .update(payload)
      .eq('id', String(req.params.id))
      .eq('campaignId', campaignId) // escopo: não edita linha de outra campanha
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ member: decryptRows([data as any], FIELDS)[0] });
  });

  // ── Migração: cifra linhas legadas em texto puro (idempotente) ────────────
  router.post('/migrate-encrypt', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

    const cols = ['id', ...FIELDS].join(', ');
    const { data, error } = await supabase
      .from('team_members')
      .select(cols)
      .eq('campaignId', campaignId);
    if (error) return res.status(500).json({ error: error.message });

    let migrated = 0;
    for (const r of (data ?? []) as any[]) {
      const before: Record<string, any> = {};
      for (const f of FIELDS) before[f] = r[f];
      const after = encryptFields(before, FIELDS); // idempotente: pula null/já-cifrado
      const changed: Record<string, any> = {};
      for (const f of FIELDS) if (after[f] !== before[f]) changed[f] = after[f];
      if (Object.keys(changed).length > 0) {
        const { error: upErr } = await supabase
          .from('team_members')
          .update(changed)
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
