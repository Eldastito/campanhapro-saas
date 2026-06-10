/**
 * Produto PARTIDO — endpoints do presidente (Centro de Comando).
 *
 * O presidente vê o AGREGADO do seu partido via service role (sem poluir as RLS
 * das campanhas dos candidatos). Cada candidato é um tenant campaignId próprio.
 *
 *   GET  /api/v1/party/me         partido do presidente + candidatos
 *   POST /api/v1/party/provision  cria o partido do presidente (uma vez)
 *   POST /api/v1/party/candidates adiciona um candidato (pending) ao partido
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

const newToken = () => `pc_${randomBytes(9).toString('hex')}`;

export function createPartyRouter(supabase: SupabaseClient): Router {
  const router = Router();

  async function partyOf(userId: string) {
    const { data } = await supabase.from('parties').select('*').eq('presidentId', userId).maybeSingle();
    return data as any | null;
  }

  // Partido do presidente logado + candidatos (com metas computadas que "acendem
  // sozinhas" conforme a equipe se cadastra).
  router.get('/me', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const party = await partyOf(userId);
    if (!party) return res.json({ party: null, candidates: [] });
    const { data: rows } = await supabase.from('party_candidates')
      .select('*').eq('partyId', party.id).order('createdAt', { ascending: false });
    const candidates = rows ?? [];

    // Headcount real (coordenadores/líderes) por campanha do candidato — 1 query.
    const campaignIds = candidates.map((c: any) => c.campaignId).filter(Boolean);
    const team: Record<string, { coord: number; lider: number }> = {};
    if (campaignIds.length) {
      const { data: members } = await supabase.from('users')
        .select('campaignId, type').in('campaignId', campaignIds).in('type', ['Coordenador', 'Líder']);
      for (const m of members || []) {
        const k = (m as any).campaignId;
        team[k] = team[k] || { coord: 0, lider: 0 };
        if ((m as any).type === 'Coordenador') team[k].coord++; else team[k].lider++;
      }
    }

    const enriched = candidates.map((c: any) => {
      const t = (c.campaignId && team[c.campaignId]) || { coord: 0, lider: 0 };
      const metas = [
        { label: 'Candidato cadastrado', done: c.status === 'active' },
        { label: 'Coordenador na equipe', done: t.coord >= 1 },
        { label: '5 líderes ativos', done: t.lider >= 5 },
      ];
      return { ...c, coordCount: t.coord, leaderCount: t.lider, metas, metasDone: metas.filter((m) => m.done).length, metasTotal: metas.length };
    });
    return res.json({ party, candidates: enriched });
  });

  // Provisiona o partido do presidente (idempotente).
  router.post('/provision', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const existing = await partyOf(userId);
    if (existing) return res.json({ party: existing, created: false });
    const name = String((req.body?.name || 'Meu Partido')).slice(0, 120);
    const { data, error } = await supabase.from('parties')
      .insert({ name, presidentId: userId }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ party: data, created: true });
  });

  // Adiciona um candidato (pending) ao partido + gera token de convite.
  router.post('/candidates', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const party = await partyOf(userId);
    if (!party) return res.status(409).json({ error: 'party_not_provisioned' });
    const { displayName, cargo, regiao, phone } = req.body || {};
    if (!displayName?.trim()) return res.status(400).json({ error: 'displayName_obrigatorio' });
    const { data, error } = await supabase.from('party_candidates').insert({
      partyId: party.id,
      displayName: String(displayName).slice(0, 160),
      cargo: cargo?.trim() || null,
      regiao: regiao?.trim() || null,
      phone: phone?.trim() || null,
      status: 'pending',
      inviteToken: newToken(),
    }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ candidate: data });
  });

  // Import em lote (planilha do presidente). Body: { rows: [{displayName,cargo,regiao,phone}] }
  router.post('/candidates/import', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const party = await partyOf(userId);
    if (!party) return res.status(409).json({ error: 'party_not_provisioned' });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const toInsert = rows.slice(0, 500).map((r: any) => ({
      partyId: party.id,
      displayName: String(r.displayName || r.nome || '').trim().slice(0, 160),
      cargo: (r.cargo || '').toString().trim() || null,
      regiao: (r.regiao || r.cidade || '').toString().trim() || null,
      phone: (r.phone || r.telefone || '').toString().trim() || null,
      status: 'pending',
      inviteToken: newToken(),
    })).filter((x: any) => x.displayName);
    if (!toInsert.length) return res.status(400).json({ error: 'nenhuma_linha_valida' });
    const { data, error } = await supabase.from('party_candidates').insert(toInsert).select('id');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ created: (data || []).length });
  });

  // Garante que o candidato é do partido do presidente logado.
  async function candidateOfPresident(userId: string, candidateId: string) {
    const party = await partyOf(userId);
    if (!party) return null;
    const { data } = await supabase.from('party_candidates')
      .select('id').eq('id', candidateId).eq('partyId', party.id).maybeSingle();
    return data ? party : null;
  }

  // Repasses de um candidato.
  router.get('/candidates/:id/repasses', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await candidateOfPresident(userId, req.params.id))) return res.status(404).json({ error: 'not_found' });
    const { data } = await supabase.from('party_repasses')
      .select('*').eq('candidateId', req.params.id).order('data', { ascending: false, nullsFirst: false });
    return res.json({ repasses: data ?? [] });
  });

  // Registra um repasse e atualiza o total do candidato.
  router.post('/candidates/:id/repasses', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const party = await candidateOfPresident(userId, req.params.id);
    if (!party) return res.status(404).json({ error: 'not_found' });
    const { valor, data, descricao, itens } = req.body || {};
    const v = Number(valor);
    if (!(v > 0)) return res.status(400).json({ error: 'valor_invalido' });
    // Rateio: cada item = { categoria, valor }. Só entram os com valor > 0.
    const cleanItens = Array.isArray(itens)
      ? itens.map((i: any) => ({ categoria: String(i.categoria || '').slice(0, 60), valor: Number(i.valor) || 0 }))
        .filter((i: any) => i.categoria && i.valor > 0)
      : [];
    const { data: ins, error } = await supabase.from('party_repasses').insert({
      partyId: (party as any).id, candidateId: req.params.id, valor: v,
      data: /^\d{4}-\d{2}-\d{2}$/.test(data || '') ? data : null,
      descricao: descricao?.trim() || null, itens: cleanItens, createdBy: userId,
    }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    // recalcula caches: total recebido e total alocado (soma dos itens de todos os repasses)
    const { data: all } = await supabase.from('party_repasses').select('valor, itens').eq('candidateId', req.params.id);
    const totalRecebido = (all || []).reduce((s: number, r: any) => s + Number(r.valor || 0), 0);
    const totalAlocado = (all || []).reduce((s: number, r: any) =>
      s + (Array.isArray(r.itens) ? r.itens.reduce((a: number, it: any) => a + Number(it.valor || 0), 0) : 0), 0);
    await supabase.from('party_candidates').update({
      valorRecebido: totalRecebido, valorAlocado: totalAlocado, updatedAt: new Date().toISOString(),
    }).eq('id', req.params.id);
    return res.json({ repasse: ins, total: totalRecebido, alocado: totalAlocado });
  });

  return router;
}
