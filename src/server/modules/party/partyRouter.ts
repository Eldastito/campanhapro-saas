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
import { computeScore } from './score';
import { callAgent } from '../../../lib/aiCallAgent';
import { ingestArtifact, retrieveContext } from '../rag/knowledgeIngest';
import { fireOrchestration } from '../../../lib/orchestrationTriggers';

const newToken = () => `pc_${randomBytes(9).toString('hex')}`;

// Normaliza o estado/UF: sigla de 2 letras vira maiúscula (rj→RJ); nome completo
// fica como veio (capado). Vazio → null. Preparação pra uso em todo o Brasil.
const normalizeUF = (v: any): string | null => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.length <= 3 ? s.toUpperCase().slice(0, 3) : s.slice(0, 40);
};

// Chaves de deduplicação (#147e): nome normalizado (sem acento/caixa/espaços
// extras) e telefone só com dígitos.
const normName = (v: any): string => String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
const normPhone = (v: any): string => String(v ?? '').replace(/\D/g, '');

// Cargos eletivos (lista fixa). normalizeCargo mapeia variações (inclusive
// femininas) pro valor canônico da lista; vazio se não reconhecer.
const CARGOS = ['Presidente', 'Senador', 'Deputado Federal', 'Deputado Estadual', 'Prefeito', 'Vereador'];
const normalizeCargo = (v: any): string => {
  const s = normName(v);
  if (!s) return '';
  const direct = CARGOS.find((c) => normName(c) === s);
  if (direct) return direct;
  if (s.includes('vereador') || s.includes('vereadora')) return 'Vereador';
  if (s.includes('prefeit')) return 'Prefeito';
  if (s.includes('senador')) return 'Senador';
  if (s.includes('deputad') && s.includes('federal')) return 'Deputado Federal';
  if (s.includes('deputad') && s.includes('estadual')) return 'Deputado Estadual';
  if (s.includes('presidente')) return 'Presidente';
  return ''; // não reconhecido → tratado como faltando
};

// Broadcast (pub/sub) p/ o telão público atualizar no INSTANTE do evento, sem
// expor tabela nenhuma a RLS. Envia só um "ping" vazio; o telão re-busca os dados
// pelo endpoint seguro. Fire-and-forget (nunca bloqueia a resposta).
const RT_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const RT_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
function broadcastTelao(partyId?: string | null) {
  if (!RT_URL || !RT_KEY || !partyId) return;
  fetch(`${RT_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: RT_KEY, Authorization: `Bearer ${RT_KEY}` },
    body: JSON.stringify({ messages: [{ topic: `party-telao-${partyId}`, event: 'update', payload: {} }] }),
  }).catch(() => { /* best-effort */ });
}

const PROOF_BUCKET = 'party-proofs';
const SIGNED_TTL = 60 * 60; // 1h
const MAX_COMMITTEE_PHOTOS = 4;     // fachada · interior · placa/material · equipe
const PHOTO_QUOTA_PER_CANDIDATE = 80; // ~6,5 MB/candidato → teto ~1 GB por partido (130)

export function createPartyRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // Sobe a foto (data URL base64) pro object storage e devolve o PATH guardado no
  // banco (não mais o base64). Mantém o banco leve. Retorna null em falha (não quebra o fluxo).
  async function uploadPhoto(path: string, dataUrl: unknown): Promise<string | null> {
    if (typeof dataUrl !== 'string') return null;
    const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
    if (!m) return typeof dataUrl === 'string' && !dataUrl.startsWith('data:') ? dataUrl : null; // já é path
    try {
      const buffer = Buffer.from(m[2], 'base64');
      const { error } = await supabase.storage.from(PROOF_BUCKET).upload(path, buffer, { contentType: m[1], upsert: true });
      if (error) { console.warn('[party] upload foto falhou:', error.message); return null; }
      return path;
    } catch (e: any) { console.warn('[party] upload exceção:', e?.message); return null; }
  }

  // Converte o que está no banco em algo exibível: PATH → URL assinada; base64 legado → passa direto.
  async function signPhoto(stored: string | null | undefined): Promise<string | null> {
    if (!stored) return null;
    if (stored.startsWith('data:')) return stored; // legado inline
    const { data } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(stored, SIGNED_TTL);
    return data?.signedUrl || null;
  }

  // Quantas fotos o candidato já tem (comitê + check-ins) — para a cota anti-abuso/disco.
  async function countCandidatePhotos(candidateId: string): Promise<number> {
    const { data: com } = await supabase.from('party_committees').select('photos').eq('candidateId', candidateId).maybeSingle();
    const comN = Array.isArray((com as any)?.photos) ? (com as any).photos.length : 0;
    const { count } = await supabase.from('party_checkins').select('id', { count: 'exact', head: true })
      .eq('candidateId', candidateId).not('photo', 'is', null);
    return comN + (count || 0);
  }

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
    // Garante o token do telão público (gera 1x, idempotente).
    if (!party.telaoToken) {
      const tk = `tl_${randomBytes(9).toString('hex')}`;
      await supabase.from('parties').update({ telaoToken: tk }).eq('id', party.id);
      party.telaoToken = tk;
    }
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

    // Comitês + contagem de check-ins por candidato (comprovação).
    const candidateIds = candidates.map((c: any) => c.id);
    const committees: Record<string, any> = {};
    const checkinCount: Record<string, number> = {};
    const lastCheckinAt: Record<string, string> = {};
    if (candidateIds.length) {
      const { data: coms } = await supabase.from('party_committees')
        .select('candidateId, address, lat, lng, photo, "geoSource"').in('candidateId', candidateIds);
      for (const cm of coms || []) committees[(cm as any).candidateId] = cm;
      const { data: cks } = await supabase.from('party_checkins').select('candidateId, "createdAt"').in('candidateId', candidateIds);
      for (const ck of cks || []) {
        const k = (ck as any).candidateId;
        checkinCount[k] = (checkinCount[k] || 0) + 1;
        const at = (ck as any).createdAt;
        if (at && (!lastCheckinAt[k] || at > lastCheckinAt[k])) lastCheckinAt[k] = at;
      }
    }

    const enriched = candidates.map((c: any) => {
      const t = (c.campaignId && team[c.campaignId]) || { coord: 0, lider: 0 };
      const com = committees[c.id];
      const metas = [
        { label: 'Candidato cadastrado', done: c.status === 'active' },
        { label: 'Comitê com foto/GPS', done: !!(com && com.photo && com.lat) },
        { label: 'Coordenador na equipe', done: t.coord >= 1 },
        { label: '5 líderes ativos', done: t.lider >= 5 },
      ];
      const score = computeScore({
        status: c.status,
        committee: com ? { hasPhoto: !!com.photo, geoSource: com.geoSource } : null,
        checkinCount: checkinCount[c.id] || 0,
        lastCheckinAt: lastCheckinAt[c.id] || null,
        coordCount: t.coord, leaderCount: t.lider,
        valorRecebido: Number(c.valorRecebido) || 0, valorAlocado: Number(c.valorAlocado) || 0,
      });
      return {
        ...c, coordCount: t.coord, leaderCount: t.lider,
        committee: com ? { address: com.address, lat: com.lat, lng: com.lng, hasPhoto: !!com.photo, geoSource: com.geoSource } : null,
        checkinCount: checkinCount[c.id] || 0, lastCheckinAt: lastCheckinAt[c.id] || null,
        metas, metasDone: metas.filter((m) => m.done).length, metasTotal: metas.length,
        score,
        repasseStatus: c.repasseStatus || 'liberado', valveNote: c.valveNote || null,
      };
    });
    // Não vaza dados de cobrança pro presidente (valor só no Supreme Admin).
    const { billingNote, ...partySafe } = party as any;
    return res.json({ party: partySafe, candidates: enriched });
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

  // Edita nome e número eleitoral do partido (só o presidente dono).
  router.patch('/profile', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const party = await partyOf(userId);
    if (!party) return res.status(404).json({ error: 'partido_nao_encontrado' });
    const { name, numero } = req.body || {};
    const patch: any = { updatedAt: new Date().toISOString() };
    if (typeof name === 'string' && name.trim()) patch.name = name.trim().slice(0, 120);
    if (numero !== undefined) patch.numero = String(numero ?? '').replace(/\D/g, '').slice(0, 5) || null;
    const { data, error } = await supabase.from('parties')
      .update(patch).eq('id', party.id).eq('presidentId', userId).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    const { billingNote, ...safe } = data as any;
    return res.json({ party: safe });
  });

  // Adiciona um candidato (pending) ao partido + gera token de convite.
  router.post('/candidates', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const party = await partyOf(userId);
    if (!party) return res.status(409).json({ error: 'party_not_provisioned' });
    const { displayName, cargo, regiao, estado, phone } = req.body || {};
    if (!displayName?.trim()) return res.status(400).json({ error: 'displayName_obrigatorio' });
    const { data, error } = await supabase.from('party_candidates').insert({
      partyId: party.id,
      displayName: String(displayName).slice(0, 160),
      cargo: cargo?.trim() || null,
      regiao: regiao?.trim() || null,
      estado: normalizeUF(estado),
      phone: phone?.trim() || null,
      status: 'pending',
      inviteToken: newToken(),
    }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ candidate: data });
  });

  // Import em lote (planilha do presidente). Body: { rows: [{displayName,cargo,regiao,estado,phone}] }
  router.post('/candidates/import', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const party = await partyOf(userId);
    if (!party) return res.status(409).json({ error: 'party_not_provisioned' });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    // Dedup (#147e): não recria quem já existe no partido (por nome OU telefone),
    // nem repete dentro do próprio lote. Re-colar a planilha vira no-op seguro.
    const { data: existing } = await supabase.from('party_candidates')
      .select('displayName, phone').eq('partyId', party.id);
    const existNames = new Set((existing || []).map((e: any) => normName(e.displayName)));
    const existPhones = new Set((existing || []).map((e: any) => normPhone(e.phone)).filter((p: string) => p.length >= 8));
    const seenNames = new Set<string>();
    const seenPhones = new Set<string>();

    let duplicates = 0, invalid = 0;
    const toInsert: any[] = [];
    for (const r of rows.slice(0, 500)) {
      const displayName = String(r.displayName || r.nome || '').trim().slice(0, 160);
      if (!displayName) { invalid++; continue; }
      const nk = normName(displayName);
      const pk = normPhone(r.phone || r.telefone);
      const isDup = existNames.has(nk) || seenNames.has(nk) || (pk.length >= 8 && (existPhones.has(pk) || seenPhones.has(pk)));
      if (isDup) { duplicates++; continue; }
      seenNames.add(nk); if (pk.length >= 8) seenPhones.add(pk);
      toInsert.push({
        partyId: party.id,
        displayName,
        cargo: (r.cargo || '').toString().trim() || null,
        regiao: (r.regiao || r.cidade || '').toString().trim() || null,
        estado: normalizeUF(r.estado || r.uf),
        phone: (r.phone || r.telefone || '').toString().trim() || null,
        status: 'pending',
        inviteToken: newToken(),
      });
    }
    if (!toInsert.length) return res.json({ created: 0, duplicates, invalid });
    const { data, error } = await supabase.from('party_candidates').insert(toInsert).select('id');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ created: (data || []).length, duplicates, invalid });
  });

  // Import assistido por IA (#147d): recebe uma planilha colada "suja" (com
  // cabeçalho, colunas extras tipo CPF/e-mail/observações, ordem qualquer) e
  // devolve SÓ os campos do candidato, pra PREVIEW. NÃO salva nada — o presidente
  // confere e confirma via /candidates/import (regra de ouro: IA não grava direto).
  router.post('/candidates/parse-ai', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const userType = (req as any).user?.userType;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (userType !== 'Presidente de Partido' && !(req as any).user?.isSupremeAdmin) {
      return res.status(403).json({ error: 'apenas_presidente' });
    }
    const party = await partyOf(userId);
    if (!party) return res.status(404).json({ error: 'partido_nao_encontrado' });

    const text = String((req.body || {}).text || '').slice(0, 16000);
    if (!text.trim()) return res.status(400).json({ error: 'texto_vazio' });

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return res.status(503).json({ error: 'ia_indisponivel', message: 'A IA está indisponível agora. Use o modo "Colar simples".' });

    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0, maxOutputTokens: 8192 } });
      const prompt = `Você recebe o conteúdo BRUTO de uma planilha/tabela de candidatos colada por um usuário. Pode ter cabeçalho, colunas a mais (CPF, e-mail, partido, observações, etc.), ordem qualquer, separadores variados (vírgula, ponto-e-vírgula, tab) e linhas vazias.

Sua tarefa: extrair a lista de candidatos pegando APENAS estes campos:
- displayName: nome da pessoa (obrigatório)
- cargo: cargo pretendido (Vereador, Prefeito, Deputado...) se houver
- regiao: a CIDADE/município se houver
- estado: a UF/estado (sigla de 2 letras quando der: RJ, SP...) se houver
- phone: telefone/WhatsApp — só os dígitos

Responda SOMENTE em JSON válido (nada fora do JSON):
{
  "candidatos": [ { "displayName": "", "cargo": "", "regiao": "", "estado": "", "phone": "" } ],
  "colunasIgnoradas": ["nome das colunas extras que você descartou"]
}

REGRAS:
- IGNORE a linha de cabeçalho e linhas vazias — não vire candidato.
- Não invente dados: se um campo não existe na planilha, deixe "".
- NÃO inclua CPF, e-mail, RG, nem qualquer dado sensível no resultado — só os 5 campos acima.
- phone só com dígitos (remova (), -, espaços).
- Liste TODOS os candidatos encontrados.

CONTEÚDO COLADO:
"""
${text}
"""

JSON:`;
      const result = await model.generateContent(prompt);
      const raw = result.response.text().trim();

      let parsed: any = null;
      try { parsed = JSON.parse(raw); } catch { /* */ }
      if (!parsed) { try { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch { /* */ } }
      const listRaw = Array.isArray(parsed) ? parsed : (parsed?.candidatos || parsed?.candidates || []);
      const ignored = (parsed?.colunasIgnoradas || parsed?.ignored || []).filter((x: any) => typeof x === 'string').slice(0, 20);

      const candidates = (Array.isArray(listRaw) ? listRaw : []).map((r: any) => ({
        displayName: String(r?.displayName || r?.nome || '').trim().slice(0, 160),
        cargo: String(r?.cargo || '').trim().slice(0, 80),
        regiao: String(r?.regiao || r?.cidade || '').trim().slice(0, 80),
        estado: normalizeUF(r?.estado || r?.uf) || '',
        phone: String(r?.phone || r?.telefone || '').replace(/\D/g, '').slice(0, 20),
      })).filter((r: any) => r.displayName).slice(0, 500);

      // Log leve pra observabilidade (não bloqueia, custo escondido do usuário).
      supabase.from('party_ai_command_logs').insert({
        partyId: party.id, userId, inputType: 'import_parse',
        userCommand: `import IA: ${text.length} chars`, detectedIntent: 'import_parse',
        actionStatus: candidates.length ? 'preview' : 'vazio',
      }).then(() => {}, () => {});

      return res.json({ candidates, ignored, total: candidates.length });
    } catch (err: any) {
      console.error('[party] candidates/parse-ai:', err);
      return res.status(500).json({ error: 'parse_failed', message: 'Não consegui organizar a planilha. Tente colar de novo ou use o modo "Colar simples".' });
    }
  });

  // Garante que o candidato é do partido do presidente logado.
  async function candidateOfPresident(userId: string, candidateId: string) {
    const party = await partyOf(userId);
    if (!party) return null;
    const { data } = await supabase.from('party_candidates')
      .select('id').eq('id', candidateId).eq('partyId', party.id).maybeSingle();
    return data ? party : null;
  }

  // Editar um candidato (nome/cargo/região/telefone).
  router.patch('/candidates/:id', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await candidateOfPresident(userId, req.params.id))) return res.status(404).json({ error: 'not_found' });
    const { displayName, cargo, regiao, estado, phone } = req.body || {};
    const patch: any = { updatedAt: new Date().toISOString() };
    if (typeof displayName === 'string' && displayName.trim()) patch.displayName = displayName.trim().slice(0, 160);
    if (cargo !== undefined) patch.cargo = cargo?.toString().trim() || null;
    if (regiao !== undefined) patch.regiao = regiao?.toString().trim() || null;
    if (estado !== undefined) patch.estado = normalizeUF(estado);
    if (phone !== undefined) patch.phone = phone?.toString().trim() || null;
    const { data, error } = await supabase.from('party_candidates').update(patch).eq('id', req.params.id).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ candidate: data });
  });

  // Excluir um candidato. Remove os dados do partido; se já tinha conta (ativo),
  // remove também o usuário/campanha (limpeza completa).
  router.delete('/candidates/:id', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await candidateOfPresident(userId, req.params.id))) return res.status(404).json({ error: 'not_found' });
    const { data: cand } = await supabase.from('party_candidates').select('userId, campaignId').eq('id', req.params.id).maybeSingle();
    const id = req.params.id;
    await supabase.from('party_checkins').delete().eq('candidateId', id);
    await supabase.from('party_committees').delete().eq('candidateId', id);
    await supabase.from('party_repasses').delete().eq('candidateId', id);
    await supabase.from('party_valve_log').delete().eq('candidateId', id);
    const { error } = await supabase.from('party_candidates').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    // candidato ativo: limpa conta + campanha
    const uid = (cand as any)?.userId; const cid = (cand as any)?.campaignId;
    if (uid) { try { await (supabase as any).auth.admin.deleteUser(uid); } catch { /* */ } }
    if (cid) { await supabase.from('campaigns').delete().eq('id', cid).then(() => {}, () => {}); }
    return res.json({ ok: true });
  });

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
    broadcastTelao((party as any).id);

    // Gatilho antifraude: se valor do repasse for "alto" OU candidato já tem
    // score vermelho/amarelo, dispara orquestrador pro Auditor + Estrategista
    // analisar o padrão. Threshold conservador (R$ 5k) — ajustável depois.
    try {
      const { data: cand } = await supabase.from('party_candidates')
        .select('displayName, status').eq('id', req.params.id).maybeSingle();
      const isHighValue = v >= 5000;
      const isPending = (cand as any)?.status === 'pending';
      if (isHighValue || isPending) {
        fireOrchestration(supabase, {
          campaignId: 'party:' + (party as any).id,
          source: 'party_repasse_inserted',
          intent: `Novo repasse de R$ ${v.toFixed(2)} para "${(cand as any)?.displayName || req.params.id}" ` +
            `(status=${(cand as any)?.status}, total recebido=R$ ${totalRecebido.toFixed(2)}, alocado=R$ ${totalAlocado.toFixed(2)}). ` +
            `Auditor de Fraudes avalia se há sinal de absorção/desvio; Estrategista revisa válvula de repasse atual e recomenda decisão (liberar/segurar/cortar).`,
        });
      }
    } catch { /* gatilho é best-effort */ }

    return res.json({ repasse: ins, total: totalRecebido, alocado: totalAlocado });
  });

  // Prova visual de um candidato (presidente): comitê + check-ins COM as fotos.
  router.get('/candidates/:id/proof', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await candidateOfPresident(userId, req.params.id))) return res.status(404).json({ error: 'not_found' });
    const { data: committee } = await supabase.from('party_committees')
      .select('address, lat, lng, photo, photos, "geoSource", "updatedAt"').eq('candidateId', req.params.id).maybeSingle();
    const { data: checkins } = await supabase.from('party_checkins')
      .select('id, tipo, lat, lng, photo, nota, "createdAt"').eq('candidateId', req.params.id)
      .order('createdAt', { ascending: false }).limit(30);
    const { data: valveLog } = await supabase.from('party_valve_log')
      .select('decision, note, "createdAt"').eq('candidateId', req.params.id)
      .order('createdAt', { ascending: false }).limit(10);
    // Assina as fotos (PATH no banco → URL temporária).
    const comPhotos: string[] = Array.isArray((committee as any)?.photos) && (committee as any).photos.length
      ? (committee as any).photos : ((committee as any)?.photo ? [(committee as any).photo] : []);
    const committeeSigned = committee ? {
      ...committee,
      photo: await signPhoto((committee as any).photo),
      photos: (await Promise.all(comPhotos.map((p) => signPhoto(p)))).filter(Boolean),
    } : null;
    const checkinsSigned = await Promise.all((checkins || []).map(async (c: any) => ({ ...c, photo: await signPhoto(c.photo) })));
    return res.json({ committee: committeeSigned, checkins: checkinsSigned, valveLog: valveLog || [] });
  });

  // Válvula de repasse: presidente libera / segura / corta + registra no log.
  router.post('/candidates/:id/valve', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const party = await candidateOfPresident(userId, req.params.id);
    if (!party) return res.status(404).json({ error: 'not_found' });
    const decision = String(req.body?.decision || '');
    if (!['liberado', 'retido', 'cortado'].includes(decision)) return res.status(400).json({ error: 'decision_invalida' });
    const note = req.body?.note ? String(req.body.note).slice(0, 300) : null;
    const now = new Date().toISOString();
    await supabase.from('party_candidates').update({
      repasseStatus: decision, valveNote: note, valveUpdatedAt: now, updatedAt: now,
    }).eq('id', req.params.id);
    await supabase.from('party_valve_log').insert({
      partyId: (party as any).id, candidateId: req.params.id, decision, note, createdBy: userId,
    });
    return res.json({ ok: true, repasseStatus: decision });
  });

  /**
   * IA-Antifraude do Partido (#57). Cruza repasse + atividade + score de
   * TODOS os candidatos do partido pra detectar padrões suspeitos:
   *   • absorvendo recurso sem entregar (recebeu muito, score baixo, sem comitê)
   *   • disparidade de produtividade (R$ / visita)
   *   • inatividade prolongada apesar de repasses recentes
   * Saída: lista de alertas priorizada (alta/média/baixa) com justificativa
   * e ação sugerida ao presidente (segurar, reduzir, manter).
   */
  router.post('/antifraud-analysis', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Só presidente do partido pode rodar
    const { data: party } = await supabase.from('parties').select('id, name').eq('presidentId', userId).maybeSingle();
    if (!party) return res.status(403).json({ error: 'not_president' });

    // Snapshot de cada candidato (dados QUE JÁ EXISTEM — sem precisar acumular)
    const { data: candidates, error } = await supabase
      .from('party_candidates')
      .select('id, displayName, cargo, regiao, status, "valorRecebido", "valorAlocado", "repasseStatus", "valveNote"')
      .eq('partyId', (party as any).id);
    if (error) return res.status(500).json({ error: error.message });
    if (!candidates || candidates.length === 0) {
      return res.json({ party: party.name, alerts: [], note: 'Sem candidatos pra analisar.' });
    }

    // Sinais reais de ESTRUTURA (comitê) e ATIVIDADE (check-ins) — agora
    // alimentam o score e o contexto da IA, pra pegar "recebeu mas não produz".
    const candIds = candidates.map((c: any) => c.id);
    const committees: Record<string, any> = {};
    const checkinCount: Record<string, number> = {};
    const lastCheckinAt: Record<string, string> = {};
    if (candIds.length) {
      const { data: coms } = await supabase.from('party_committees').select('candidateId, photo, lat, "geoSource"').in('candidateId', candIds);
      for (const cm of coms || []) committees[(cm as any).candidateId] = cm;
      const { data: cks } = await supabase.from('party_checkins').select('candidateId, "createdAt"').in('candidateId', candIds);
      for (const ck of cks || []) {
        const k = (ck as any).candidateId;
        checkinCount[k] = (checkinCount[k] || 0) + 1;
        const at = (ck as any).createdAt;
        if (at && (!lastCheckinAt[k] || at > lastCheckinAt[k])) lastCheckinAt[k] = at;
      }
    }

    const now = Date.now();
    const enriched = candidates.map((c: any) => {
      const com = committees[c.id];
      const score = computeScore({
        status: c.status || 'pending',
        committee: com ? { hasPhoto: !!com.photo, geoSource: com.geoSource } : null,
        checkinCount: checkinCount[c.id] || 0, lastCheckinAt: lastCheckinAt[c.id] || null,
        coordCount: 0, leaderCount: 0,
        valorRecebido: Number(c.valorRecebido || 0),
        valorAlocado: Number(c.valorAlocado || 0),
      }, now);
      const lastCk = lastCheckinAt[c.id];
      const diasSemCheckin = lastCk ? Math.floor((now - new Date(lastCk).getTime()) / 86400000) : null;
      return {
        ...c, score: score.score, scoreLevel: score.level, scoreReasons: score.reasons,
        temComite: !!(com && com.lat), comiteFoto: !!(com && com.photo),
        checkins: checkinCount[c.id] || 0, diasSemCheckin,
      };
    });

    const linhas = enriched.map((c, i) =>
      `${i+1}. ${c.displayName} | cargo=${c.cargo || '?'} | regiao=${c.regiao || '?'} | recebido=R$${Number(c.valorRecebido||0).toFixed(0)} | alocado=R$${Number(c.valorAlocado||0).toFixed(0)} | comite=${c.temComite ? (c.comiteFoto ? 'sim+foto' : 'sim') : 'NÃO'} | checkins=${c.checkins}${c.diasSemCheckin != null ? ` (último há ${c.diasSemCheckin}d)` : ' (nunca)'} | score=${c.score} (${c.scoreLevel}) | status=${c.status} | valve=${c.repasseStatus||'liberado'}`
    ).join('\n');

    const system = `Você é o Auditor Antifraude do Partido. Analise a lista de candidatos e detecte padrões SUSPEITOS:
- "absorção": recebeu R$ mas tem comite=NÃO e/ou alocado bem abaixo do recebido (dinheiro entrando sem estrutura/justificativa).
- "disparidade": R$ muito acima dos pares do MESMO cargo sem atividade (check-ins) proporcional.
- "inatividade": muitos dias sem check-in (ou nunca) apesar de ter recebido repasses.

NÃO acuse sem evidência — cite os NÚMEROS (recebido, alocado, comitê, check-ins, dias). Sinais fortes:
- comite=NÃO E recebido > 0 → absorção provável.
- score vermelho E recebido > 0 E alocado < 30% do recebido → absorção.
- recebido > 0 E (checkins=0 ou último há >30d) → inatividade.

Retorne JSON estrito (sem markdown):
{"alerts":[{"candidateId":"uuid","priority":"alta|media|baixa","pattern":"absorção|disparidade|inatividade|ok","justification":"≤200 chars com NÚMEROS","suggested_action":"segurar|reduzir|manter|investigar + frase ≤120 chars"}]}

Inclua TODOS os candidatos (mesmo "ok"). Ordem decrescente por priority.`;

    try {
      const ai = await callAgent(supabase, 'crm', `Audite estes ${enriched.length} candidatos do partido "${party.name}":\n\n${linhas}`, {
        campaignId: 'party:' + party.id, // namespace pra agent_runs
        systemInstruction: system, complexity: 'balanced', maxTokens: 2000,
      });
      let cleaned = ai.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
      const parsed = JSON.parse(cleaned);
      return res.json({
        party: party.name,
        analyzedAt: new Date().toISOString(),
        candidatesAnalyzed: enriched.length,
        alerts: Array.isArray(parsed?.alerts) ? parsed.alerts : [],
      });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || 'ai_failed' });
    }
  });

  /**
   * Digest Semanal IA (#85). Sumário curto pro presidente com destaques
   * da semana: movimentos do score, alertas de antifraude, sugestões. Tudo
   * num único output JSON estruturado pra cards no painel.
   *
   * Pra simplificar: snapshot atual + comparativo com 7 dias atrás (via
   * valveUpdatedAt). NÃO é histórico real — apenas usa o que está no banco
   * hoje. Funciona bem porque o presidente vai gerar 1× por semana e ver os
   * movimentos desde a última vez que ele aprovou/segurou repasses.
   */
  router.post('/digest-weekly', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { data: party } = await supabase.from('parties').select('id, name').eq('presidentId', userId).maybeSingle();
    if (!party) return res.status(403).json({ error: 'not_president' });

    try {
      const { data: candidates, error } = await supabase
        .from('party_candidates')
        .select('id, displayName, cargo, regiao, status, "valorRecebido", "valorAlocado", "repasseStatus", "valveNote", "valveUpdatedAt"')
        .eq('partyId', (party as any).id);
      if (error) throw error;
      if (!candidates || candidates.length === 0) {
        return res.json({ party: party.name, summary: 'Ainda sem candidatos pra resumir.', highlights: [], actions: [] });
      }

      const now = Date.now();
      const sevenDaysAgo = now - 7 * 86400000;

      // Snapshot rule-based de cada candidato
      const snap = candidates.map((c: any) => {
        const score = computeScore({
          status: c.status || 'pending',
          committee: null, checkinCount: 0, lastCheckinAt: null,
          coordCount: 0, leaderCount: 0,
          valorRecebido: Number(c.valorRecebido || 0),
          valorAlocado: Number(c.valorAlocado || 0),
        }, now);
        const valveMexidaEstaSemana = c.valveUpdatedAt && new Date(c.valveUpdatedAt).getTime() > sevenDaysAgo;
        return {
          id: c.id, nome: c.displayName, cargo: c.cargo, regiao: c.regiao,
          status: c.status, score: score.score, level: score.level,
          recebido: Number(c.valorRecebido || 0), alocado: Number(c.valorAlocado || 0),
          repasse: c.repasseStatus || 'liberado',
          valveSemanal: valveMexidaEstaSemana,
        };
      });

      // Estatísticas pra contexto da IA (não joga snapshot bruto)
      const totalReceived = snap.reduce((s, c) => s + c.recebido, 0);
      const totalAllocated = snap.reduce((s, c) => s + c.alocado, 0);
      const greens = snap.filter((c) => c.level === 'green').length;
      const reds = snap.filter((c) => c.level === 'red').length;
      const retidos = snap.filter((c) => c.repasse === 'retido').length;
      const cortados = snap.filter((c) => c.repasse === 'cortado').length;

      const linhas = snap.map((c, i) =>
        `${i+1}. ${c.nome} (${c.cargo || '?'} | ${c.regiao || '?'}) | score=${c.score}/${c.level} | recebido=R$${c.recebido.toFixed(0)} | alocado=R$${c.alocado.toFixed(0)} | repasse=${c.repasse}${c.valveSemanal ? ' [decidido esta semana]' : ''}`
      ).join('\n');

      const system = `Você é o Estrategista do Partido. Faça um DIGEST SEMANAL CURTO pro presidente.

CONTEXTO DA SEMANA:
- ${snap.length} candidatos · ${greens} 🟢 · ${reds} 🔴 · ${retidos} retidos · ${cortados} cortados
- R$ recebido total: R$${totalReceived.toFixed(0)} · alocado: R$${totalAllocated.toFixed(0)}

REGRAS:
- summary: 2-3 frases. Tom executivo, direto. Diga o que mudou e o que importa.
- highlights: 3-6 cards de destaque (positivo OU negativo). Verbo no início, ≤140 chars. Tipos:
  * 'subiu': candidato com score positivo notável
  * 'caiu': candidato com problema (score vermelho, retido recente)
  * 'risco': padrão de fraude potencial (recebeu muito, alocou pouco)
  * 'destaque': multiplicador, marco superado, etc.
- actions: 2-4 ações concretas pro presidente FAZER essa semana. Verbo + objeto, ≤140 chars.

Saída JSON estrito (sem markdown):
{"summary":"...","highlights":[{"type":"subiu|caiu|risco|destaque","candidateId":"uuid","title":"≤80","body":"≤140"}],"actions":["..."]}`;

      // Busca o digest anterior no RAG pra IA poder COMPARAR (subiu/caiu desde
      // a última semana) em vez de gerar do zero. Namespace 'party:<id>'.
      const partyNs = 'party:' + (party as any).id;
      const memoria = await retrieveContext(supabase, partyNs, 'digest semanal anterior estatísticas highlights');

      const ai = await callAgent(supabase, 'strategist',
        `Candidatos do partido "${party.name}" (snapshot atual):\n\n${linhas}` +
        (memoria ? `\n\n--- Digest anterior (RAG) ---\n${memoria}\n--- fim ---\n\nCompare com o atual e destaque o que MUDOU.` : '') +
        `\n\nFaça o digest semanal.`, {
        campaignId: partyNs,
        systemInstruction: system, complexity: 'balanced', maxTokens: 2000,
      });

      let cleaned = ai.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const sIdx = cleaned.indexOf('{'); const eIdx = cleaned.lastIndexOf('}');
      if (sIdx >= 0 && eIdx > sIdx) cleaned = cleaned.slice(sIdx, eIdx + 1);
      const parsed = JSON.parse(cleaned);

      const result = {
        party: party.name,
        analyzedAt: new Date().toISOString(),
        stats: { total: snap.length, greens, reds, retidos, cortados,
                 totalReceived, totalAllocated },
        summary: typeof parsed?.summary === 'string' ? parsed.summary.slice(0, 500) : '',
        highlights: Array.isArray(parsed?.highlights) ? parsed.highlights.slice(0, 6) : [],
        actions: Array.isArray(parsed?.actions) ? parsed.actions.slice(0, 4) : [],
      };

      // Persiste no RAG pra próxima execução comparar. Fire-and-forget.
      const digestText = `Digest ${result.analyzedAt}\n${result.summary}\n` +
        `Stats: ${result.stats.greens} verdes, ${result.stats.reds} vermelhos, ${result.stats.retidos} retidos, ${result.stats.cortados} cortados.\n` +
        `Highlights:\n${result.highlights.map((h: any) => `- [${h.type}] ${h.title}: ${h.body}`).join('\n')}\n` +
        `Ações sugeridas:\n${result.actions.map((a: any) => `- ${a}`).join('\n')}`;
      ingestArtifact(supabase, {
        campaignId: partyNs,
        source: 'party:digest:weekly',
        title: `Digest semanal — ${result.analyzedAt.slice(0, 10)}`,
        text: digestText,
        metadata: { stats: result.stats, generatedAt: result.analyzedAt },
      }).catch((e) => console.warn('[party] digest ingest RAG falhou (não-fatal):', e?.message));

      return res.json(result);
    } catch (err: any) {
      console.error('[party] digest-weekly:', err);
      return res.status(500).json({ error: err?.message || 'ai_failed' });
    }
  });

  // ---- Lado do CANDIDATO de partido (comprovação) ----
  async function myCandidate(userId: string) {
    const { data } = await supabase.from('party_candidates').select('*').eq('userId', userId).maybeSingle();
    return data as any | null;
  }

  router.get('/candidate/me', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const cand = await myCandidate(userId);
    if (!cand) return res.status(404).json({ error: 'not_found' });
    const { data: party } = await supabase.from('parties').select('name').eq('id', cand.partyId).maybeSingle();
    const { data: committee } = await supabase.from('party_committees').select('*').eq('candidateId', cand.id).maybeSingle();
    const { data: checkins } = await supabase.from('party_checkins')
      .select('id, tipo, lat, lng, nota, "createdAt"').eq('candidateId', cand.id).order('createdAt', { ascending: false }).limit(20);
    // metas do candidato (mesma lógica)
    const t = { coord: 0, lider: 0 };
    if (cand.campaignId) {
      const { data: members } = await supabase.from('users').select('type').eq('campaignId', cand.campaignId).in('type', ['Coordenador', 'Líder']);
      for (const m of members || []) { if ((m as any).type === 'Coordenador') t.coord++; else t.lider++; }
    }
    const com = committee as any;
    const metas = [
      { label: 'Concluir seu cadastro', done: cand.status === 'active' },
      { label: 'Cadastrar o comitê (foto + GPS)', done: !!(com && com.photo && com.lat) },
      { label: 'Cadastrar 1 coordenador', done: t.coord >= 1 },
      { label: 'Cadastrar 5 líderes', done: t.lider >= 5 },
    ];
    const score = computeScore({
      status: cand.status,
      committee: com ? { hasPhoto: !!com.photo, geoSource: com.geoSource } : null,
      checkinCount: (checkins || []).length,
      lastCheckinAt: (checkins || [])[0]?.createdAt || null,
      coordCount: t.coord, leaderCount: t.lider,
      valorRecebido: Number(cand.valorRecebido) || 0, valorAlocado: Number(cand.valorAlocado) || 0,
    });
    const cPhotos: string[] = Array.isArray((committee as any)?.photos) && (committee as any).photos.length
      ? (committee as any).photos : ((committee as any)?.photo ? [(committee as any).photo] : []);
    const committeeSigned = committee ? {
      ...committee,
      photo: await signPhoto((committee as any).photo),
      photos: (await Promise.all(cPhotos.map((p) => signPhoto(p)))).filter(Boolean),
    } : null;
    return res.json({ candidate: cand, partyName: (party as any)?.name, committee: committeeSigned, checkins: checkins || [], metas, score });
  });

  router.post('/candidate/committee', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const cand = await myCandidate(userId);
    if (!cand) return res.status(404).json({ error: 'not_found' });
    const { address, lat, lng, photos, geoSource } = req.body || {};
    const hasGeo = Number(lat) && Number(lng);
    const existing = (await supabase.from('party_committees').select('photos, photo').eq('candidateId', cand.id).maybeSingle()).data as any;
    const existingPhotos: string[] = Array.isArray(existing?.photos) ? existing.photos
      : (existing?.photo ? [existing.photo] : []); // migra legado (1 foto) p/ lista

    // photos = array de até 4 slots; cada um: data URL (nova), "KEEP" (mantém atual) ou vazio.
    const slots: any[] = Array.isArray(photos) ? photos.slice(0, MAX_COMMITTEE_PHOTOS) : [];
    const finalPaths: string[] = [];
    for (let i = 0; i < slots.length; i++) {
      const v = slots[i];
      if (typeof v === 'string' && v.startsWith('data:')) {
        const p = await uploadPhoto(`party/${cand.partyId}/committee/${cand.id}/${i}.jpg`, v);
        if (p) finalPaths.push(p);
      } else if (v === 'KEEP' && existingPhotos[i]) {
        finalPaths.push(existingPhotos[i]);
      }
    }
    const { data, error } = await supabase.from('party_committees').upsert({
      candidateId: cand.id, partyId: cand.partyId,
      address: address ? String(address).slice(0, 300) : null,
      lat: Number(lat) || null, lng: Number(lng) || null,
      geoSource: hasGeo ? (geoSource === 'address' ? 'address' : 'gps') : null,
      photos: finalPaths, photo: finalPaths[0] || null, // photo = capa (compat)
      updatedAt: new Date().toISOString(),
    }, { onConflict: 'candidateId' }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    broadcastTelao(cand.partyId);
    const signed = await Promise.all(finalPaths.map((p) => signPhoto(p)));
    return res.json({ committee: { ...data, photos: signed.filter(Boolean), photo: signed[0] || null } });
  });

  router.post('/candidate/checkin', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const cand = await myCandidate(userId);
    if (!cand) return res.status(404).json({ error: 'not_found' });
    const { tipo, lat, lng, photo, nota } = req.body || {};
    // Cota anti-abuso/disco: barra acima do teto por candidato.
    if (typeof photo === 'string' && photo.startsWith('data:')) {
      const used = await countCandidatePhotos(cand.id);
      if (used >= PHOTO_QUOTA_PER_CANDIDATE) {
        return res.status(409).json({ error: 'cota_fotos_atingida', detail: `Limite de ${PHOTO_QUOTA_PER_CANDIDATE} fotos por candidato atingido.` });
      }
    }
    const photoPath = (typeof photo === 'string' && photo.startsWith('data:'))
      ? await uploadPhoto(`party/${cand.partyId}/checkin/${cand.id}-${randomBytes(6).toString('hex')}.jpg`, photo)
      : null;
    const { data, error } = await supabase.from('party_checkins').insert({
      candidateId: cand.id, partyId: cand.partyId, userId,
      tipo: ['comite', 'evento', 'visita', 'reuniao'].includes(tipo) ? tipo : 'comite',
      lat: Number(lat) || null, lng: Number(lng) || null,
      photo: photoPath,
      nota: nota ? String(nota).slice(0, 300) : null,
    }).select('id, "createdAt"').single();
    if (error) return res.status(500).json({ error: error.message });
    broadcastTelao(cand.partyId);
    return res.json({ checkin: data });
  });

  // ---- Lado do COORDENADOR / LÍDER (ferramentas leves de campo, #83) ----
  // O membro vê o candidato que ele serve, registra visita/reunião com GPS+foto.
  // O check-in vai pra mesma tabela e engorda o checkinCount → score do candidato.
  async function myCandidateAsMember(userId: string): Promise<{ cand: any; user: any } | null> {
    const { data: u } = await supabase.from('users').select('id, name, type, "campaignId"').eq('id', userId).maybeSingle();
    if (!u || !(u as any).campaignId) return null;
    if (!['Coordenador', 'Líder', 'Lider'].includes((u as any).type)) return null;
    const { data: cand } = await supabase.from('party_candidates').select('*').eq('campaignId', (u as any).campaignId).maybeSingle();
    if (!cand) return null;
    return { cand, user: u };
  }

  router.get('/member/me', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const ctx = await myCandidateAsMember(userId);
    // Não-membro de partido NÃO é erro — Admin/Coord de campanha normal recebe
    // 200 com isMember:false, pra não encher o console com 404 (#10).
    if (!ctx) return res.json({ isMember: false });
    const { cand, user } = ctx;
    const { data: party } = await supabase.from('parties').select('name').eq('id', cand.partyId).maybeSingle();
    const { data: minhas } = await supabase.from('party_checkins')
      .select('id, tipo, lat, lng, nota, "createdAt"')
      .eq('candidateId', cand.id).eq('userId', userId)
      .order('createdAt', { ascending: false }).limit(10);
    return res.json({
      isMember: true,
      role: (user as any).type,
      candidate: { id: cand.id, name: cand.displayName, cargo: cand.cargo || null, regiao: cand.regiao || null },
      party: { id: cand.partyId, name: (party as any)?.name || '' },
      mine: minhas || [],
      mineCount: (minhas || []).length,
    });
  });

  router.post('/member/checkin', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const ctx = await myCandidateAsMember(userId);
    if (!ctx) return res.status(403).json({ error: 'not_member' });
    const { cand } = ctx;
    const { tipo, lat, lng, photo, nota } = req.body || {};
    // Membros usam só visita/reunião — comitê/evento é do candidato (impede confusão).
    const t = ['visita', 'reuniao'].includes(tipo) ? tipo : 'visita';
    // Cota anti-abuso reaproveitada (compartilhada com candidato — defende disco).
    if (typeof photo === 'string' && photo.startsWith('data:')) {
      const used = await countCandidatePhotos(cand.id);
      if (used >= PHOTO_QUOTA_PER_CANDIDATE) {
        return res.status(409).json({ error: 'cota_fotos_atingida', detail: `Limite de ${PHOTO_QUOTA_PER_CANDIDATE} fotos por candidato atingido.` });
      }
    }
    const photoPath = (typeof photo === 'string' && photo.startsWith('data:'))
      ? await uploadPhoto(`party/${cand.partyId}/checkin/${cand.id}-${randomBytes(6).toString('hex')}.jpg`, photo)
      : null;
    const { data, error } = await supabase.from('party_checkins').insert({
      candidateId: cand.id, partyId: cand.partyId, userId,
      tipo: t,
      lat: Number(lat) || null, lng: Number(lng) || null,
      photo: photoPath,
      nota: nota ? String(nota).slice(0, 300) : null,
    }).select('id, tipo, "createdAt"').single();
    if (error) return res.status(500).json({ error: error.message });
    broadcastTelao(cand.partyId);
    return res.json({ checkin: data });
  });

  // Recalcula os caches de total recebido/alocado de um candidato (#145).
  async function recalcCandidateTotals(candidateId: string) {
    const { data: all } = await supabase.from('party_repasses').select('valor, itens').eq('candidateId', candidateId);
    const totalRecebido = (all || []).reduce((s: number, r: any) => s + Number(r.valor || 0), 0);
    const totalAlocado = (all || []).reduce((s: number, r: any) =>
      s + (Array.isArray(r.itens) ? r.itens.reduce((a: number, it: any) => a + Number(it.valor || 0), 0) : 0), 0);
    await supabase.from('party_candidates').update({
      valorRecebido: totalRecebido, valorAlocado: totalAlocado, updatedAt: new Date().toISOString(),
    }).eq('id', candidateId);
  }

  // Valida que um repasse pertence a um candidato do partido do presidente.
  async function repasseOfPresident(userId: string, repasseId: string) {
    const party = await partyOf(userId);
    if (!party) return null;
    const { data: rep } = await supabase.from('party_repasses')
      .select('*').eq('id', repasseId).eq('partyId', party.id).maybeSingle();
    return rep ? { party, repasse: rep as any } : null;
  }

  // ── EDITAR repasse (#145) ──────────────────────────────────────────────
  router.patch('/repasses/:id', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const found = await repasseOfPresident(userId, req.params.id);
    if (!found) return res.status(404).json({ error: 'not_found' });

    const { valor, descricao, data } = req.body || {};
    const patch: any = { updatedAt: new Date().toISOString() };
    if (valor !== undefined) {
      const v = Number(valor);
      if (!(v > 0)) return res.status(400).json({ error: 'valor_invalido' });
      patch.valor = v;
    }
    if (descricao !== undefined) patch.descricao = descricao?.toString().trim() || null;
    if (data !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(data)) patch.data = data;

    const { error } = await supabase.from('party_repasses').update(patch).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    await recalcCandidateTotals(found.repasse.candidateId);
    broadcastTelao(found.party.id);
    return res.json({ ok: true });
  });

  // ── EXCLUIR repasse (#145) ─────────────────────────────────────────────
  router.delete('/repasses/:id', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const found = await repasseOfPresident(userId, req.params.id);
    if (!found) return res.status(404).json({ error: 'not_found' });
    const { error } = await supabase.from('party_repasses').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    await recalcCandidateTotals(found.repasse.candidateId);
    broadcastTelao(found.party.id);
    return res.json({ ok: true });
  });

  // ── REPASSE RECORRENTE (#147) ──────────────────────────────────────────
  // POST cria um modelo recorrente (em vez de lançar 1 repasse só).
  router.post('/candidates/:id/recurring-repasses', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const party = await candidateOfPresident(userId, req.params.id);
    if (!party) return res.status(404).json({ error: 'not_found' });

    const { valor, descricao, frequencia, proximaData, dataFim } = req.body || {};
    const v = Number(valor);
    if (!(v > 0)) return res.status(400).json({ error: 'valor_invalido' });
    const freq = ['mensal', 'quinzenal', 'semanal'].includes(frequencia) ? frequencia : 'mensal';
    const prox = /^\d{4}-\d{2}-\d{2}$/.test(proximaData || '') ? proximaData : new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase.from('party_recurring_repasses').insert({
      partyId: (party as any).id, candidateId: req.params.id, valor: v,
      descricao: descricao?.trim() || null, frequencia: freq,
      proximaData: prox, dataFim: /^\d{4}-\d{2}-\d{2}$/.test(dataFim || '') ? dataFim : null,
      ativo: true, createdBy: userId,
    }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ recurring: data });
  });

  // GET lista os recorrentes do partido (com nome do candidato).
  router.get('/recurring-repasses', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const party = await partyOf(userId);
    if (!party) return res.json({ recurring: [] });
    const { data: recs } = await supabase.from('party_recurring_repasses')
      .select('*').eq('partyId', party.id).order('createdAt', { ascending: false });
    const { data: cands } = await supabase.from('party_candidates')
      .select('id, displayName').eq('partyId', party.id);
    const nameById: Record<string, string> = {};
    (cands || []).forEach((c: any) => { nameById[c.id] = c.displayName; });
    const recurring = (recs || []).map((r: any) => ({ ...r, candidateName: nameById[r.candidateId] || '—' }));
    return res.json({ recurring });
  });

  // PATCH pausar/reativar; DELETE cancelar.
  router.patch('/recurring-repasses/:id', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const party = await partyOf(userId);
    if (!party) return res.status(404).json({ error: 'not_found' });
    const patch: any = { updatedAt: new Date().toISOString() };
    if (typeof (req.body || {}).ativo === 'boolean') patch.ativo = (req.body as any).ativo;
    if ((req.body || {}).valor !== undefined) { const v = Number((req.body as any).valor); if (v > 0) patch.valor = v; }
    const { error } = await supabase.from('party_recurring_repasses')
      .update(patch).eq('id', req.params.id).eq('partyId', party.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  });

  router.delete('/recurring-repasses/:id', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const party = await partyOf(userId);
    if (!party) return res.status(404).json({ error: 'not_found' });
    await supabase.from('party_recurring_repasses').delete().eq('id', req.params.id).eq('partyId', party.id);
    return res.json({ ok: true });
  });

  // ── RELATÓRIO DE REPASSES (#144) — agregado do partido pra impressão ──
  router.get('/repasses-report', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const userType = (req as any).user?.userType;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (userType !== 'Presidente de Partido' && !(req as any).user?.isSupremeAdmin) {
      return res.status(403).json({ error: 'apenas_presidente' });
    }
    const party = await partyOf(userId);
    if (!party) return res.status(404).json({ error: 'partido_nao_encontrado' });

    const { data: cands } = await supabase.from('party_candidates')
      .select('id, displayName, cargo, regiao, estado').eq('partyId', party.id);
    const candMap: Record<string, any> = {};
    (cands || []).forEach((c: any) => { candMap[c.id] = c; });

    const { data: reps } = await supabase.from('party_repasses')
      .select('valor, data, descricao, candidateId, itens')
      .eq('partyId', party.id).order('data', { ascending: false, nullsFirst: false });

    const items = (reps || []).map((r: any) => {
      const c = candMap[r.candidateId] || {};
      return {
        candidato: c.displayName || '—',
        cargo: c.cargo || '',
        regiao: [c.regiao, c.estado].filter(Boolean).join('/'),
        valor: Number(r.valor) || 0,
        data: r.data || null,
        descricao: r.descricao || '',
      };
    });
    const totalGeral = items.reduce((s: number, i: any) => s + i.valor, 0);

    return res.json({
      partyName: party.name,
      geradoEm: new Date().toISOString(),
      totalGeral,
      totalRepasses: items.length,
      items,
    });
  });

  // ── BACKUP EM UNIDADE EXTERNA (#147c) ──────────────────────────────────
  // Exporta TODOS os dados do partido do presidente logado, em JSON.
  // ISOLAMENTO: escopado por partyId — cada presidente baixa só o que é dele,
  // nunca os dados de outro partido. O navegador (File System Access API) é quem
  // grava o arquivo no pendrive/pasta escolhida pelo usuário; o servidor (nuvem)
  // não tem acesso a unidade física, então só devolve o payload completo.
  router.get('/backup', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const userType = (req as any).user?.userType;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (userType !== 'Presidente de Partido' && !(req as any).user?.isSupremeAdmin) {
      return res.status(403).json({ error: 'apenas_presidente' });
    }
    const party = await partyOf(userId);
    if (!party) return res.status(404).json({ error: 'partido_nao_encontrado' });

    const { data: candidates } = await supabase.from('party_candidates').select('*').eq('partyId', party.id);
    const candIds = (candidates || []).map((c: any) => c.id);
    const inIds = candIds.length ? candIds : ['00000000-0000-0000-0000-000000000000'];

    const [repassesQ, recurringQ, committeesQ, checkinsQ, valveLogQ] = await Promise.all([
      supabase.from('party_repasses').select('*').eq('partyId', party.id),
      supabase.from('party_recurring_repasses').select('*').eq('partyId', party.id),
      supabase.from('party_committees').select('*').in('candidateId', inIds),
      supabase.from('party_checkins').select('*').in('candidateId', inIds),
      supabase.from('party_valve_log').select('*').in('candidateId', inIds),
    ]);

    const payload = {
      schema: 'campanhapro.party-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      party: { id: party.id, name: party.name },
      counts: {
        candidatos: (candidates || []).length,
        repasses: (repassesQ.data || []).length,
        recorrentes: (recurringQ.data || []).length,
        comites: (committeesQ.data || []).length,
        checkins: (checkinsQ.data || []).length,
        valvula: (valveLogQ.data || []).length,
      },
      data: {
        candidatos: candidates || [],
        repasses: repassesQ.data || [],
        repassesRecorrentes: recurringQ.data || [],
        comites: committeesQ.data || [],
        checkins: checkinsQ.data || [],
        valvulaLog: valveLogQ.data || [],
      },
    };
    return res.json(payload);
  });

  // ── RESTAURAR BACKUP (#147f) ───────────────────────────────────────────
  // Recebe o JSON gerado pelo /backup e repõe os dados no partido do presidente.
  // Aditivo e idempotente: usa upsert ON CONFLICT(id) DO NOTHING — restaurar de
  // novo não duplica. Candidatos voltam como 'pending' (sem vínculo de conta) com
  // novo token de convite, pra re-cadastro limpo. Tudo escopado ao partido atual.
  router.post('/restore', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const userType = (req as any).user?.userType;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (userType !== 'Presidente de Partido' && !(req as any).user?.isSupremeAdmin) {
      return res.status(403).json({ error: 'apenas_presidente' });
    }
    const party = await partyOf(userId);
    if (!party) return res.status(404).json({ error: 'partido_nao_encontrado' });

    const body = req.body || {};
    if (body.schema !== 'campanhapro.party-backup') {
      return res.status(400).json({ error: 'arquivo_invalido', message: 'Este arquivo não é um backup de partido do CampanhaPro.' });
    }
    const d = body.data || {};
    const cap = (a: any) => (Array.isArray(a) ? a.slice(0, 5000) : []);
    const restored = { candidatos: 0, repasses: 0, recorrentes: 0, comites: 0, checkins: 0, valvula: 0 };

    try {
      // Candidatos — remapeia pro partido atual, restaura como pendente (sem conta).
      const candidatos = cap(d.candidatos).map((c: any) => ({
        ...c, partyId: party.id, status: 'pending', userId: null, campaignId: null,
        inviteToken: newToken(), updatedAt: new Date().toISOString(),
      }));
      if (candidatos.length) {
        const { data } = await supabase.from('party_candidates').upsert(candidatos, { onConflict: 'id', ignoreDuplicates: true }).select('id');
        restored.candidatos = (data || []).length;
      }
      const repasses = cap(d.repasses).map((r: any) => ({ ...r, partyId: party.id }));
      if (repasses.length) {
        const { data } = await supabase.from('party_repasses').upsert(repasses, { onConflict: 'id', ignoreDuplicates: true }).select('id');
        restored.repasses = (data || []).length;
      }
      const recorrentes = cap(d.repassesRecorrentes).map((r: any) => ({ ...r, partyId: party.id }));
      if (recorrentes.length) {
        const { data } = await supabase.from('party_recurring_repasses').upsert(recorrentes, { onConflict: 'id', ignoreDuplicates: true }).select('id');
        restored.recorrentes = (data || []).length;
      }
      const comites = cap(d.comites);
      if (comites.length) {
        const { data } = await supabase.from('party_committees').upsert(comites, { onConflict: 'id', ignoreDuplicates: true }).select('id');
        restored.comites = (data || []).length;
      }
      const checkins = cap(d.checkins);
      if (checkins.length) {
        const { data } = await supabase.from('party_checkins').upsert(checkins, { onConflict: 'id', ignoreDuplicates: true }).select('id');
        restored.checkins = (data || []).length;
      }
      const valvula = cap(d.valvulaLog);
      if (valvula.length) {
        const { data } = await supabase.from('party_valve_log').upsert(valvula, { onConflict: 'id', ignoreDuplicates: true }).select('id');
        restored.valvula = (data || []).length;
      }
      return res.json({ ok: true, restored });
    } catch (err: any) {
      console.error('[party] restore:', err);
      return res.status(500).json({ error: 'restore_failed', message: err?.message || 'Falha ao restaurar.' });
    }
  });

  // ── ORB CONVERSACIONAL (#142) — IA consultiva (só LEITURA nesta fase) ──
  //
  // Segurança: a IA NUNCA toca o banco direto. O backend monta um snapshot
  // determinístico (SQL controlado, escopado ao partido do presidente) e injeta
  // no prompt. O Gemini só interpreta/formata — não inventa (dados no contexto)
  // e não escreve nada. Compliance: identifica-se como assistente.
  router.post('/ai/command', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const userType = (req as any).user?.userType;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (userType !== 'Presidente de Partido' && !(req as any).user?.isSupremeAdmin) {
      return res.status(403).json({ error: 'apenas_presidente' });
    }
    const party = await partyOf(userId);
    if (!party) return res.status(404).json({ error: 'partido_nao_encontrado' });

    const text = String((req.body || {}).text || '').trim().slice(0, 800);
    if (!text) return res.status(400).json({ error: 'texto_vazio' });

    try {
      // 1. Snapshot determinístico do partido (escopado por partyId)
      const { data: cands } = await supabase.from('party_candidates')
        .select('displayName, cargo, regiao, estado, status, valorRecebido, repasseStatus')
        .eq('partyId', party.id).order('valorRecebido', { ascending: false });
      const candidates = cands || [];
      const totalRepassado = candidates.reduce((s: number, c: any) => s + (Number(c.valorRecebido) || 0), 0);
      const cadastrados = candidates.filter((c: any) => c.status === 'active').length;
      const pendentes = candidates.filter((c: any) => c.status === 'pending').length;

      const { data: repasses } = await supabase.from('party_repasses')
        .select('valor, data, descricao, candidateId')
        .eq('partyId', party.id).order('data', { ascending: false }).limit(15);

      const candById: Record<string, string> = {};
      candidates.forEach((c: any, i: number) => { candById[i] = c.displayName; });
      const candNameByRepasse = async () => {
        // mapeia candidateId → nome (1 query extra leve)
        const ids = [...new Set((repasses || []).map((r: any) => r.candidateId).filter(Boolean))];
        if (!ids.length) return {} as Record<string, string>;
        const { data } = await supabase.from('party_candidates').select('id, displayName').in('id', ids);
        const m: Record<string, string> = {};
        (data || []).forEach((c: any) => { m[c.id] = c.displayName; });
        return m;
      };
      const repMap = await candNameByRepasse();

      const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const statusLabel = (s: string) => s === 'active' ? 'cadastro concluído' : s === 'pending' ? 'cadastro pendente' : (s || '—');
      const local = (c: any) => [c.regiao, c.estado].filter(Boolean).join('/') || 's/local';
      const snapshot = [
        `PARTIDO: ${party.name}`,
        `Candidatos: ${candidates.length} (${cadastrados} com cadastro concluído, ${pendentes} com cadastro pendente)`,
        `Total repassado: ${brl(totalRepassado)}`,
        ``,
        `LEGENDA DE STATUS: "active" = cadastro concluído (já criou acesso/senha); "pending" = cadastro pendente (ainda não concluiu — o convite foi enviado mas ele não criou o acesso).`,
        ``,
        `CANDIDATOS (nome | cargo | cidade/UF | status | valor recebido):`,
        ...candidates.slice(0, 120).map((c: any) =>
          `- ${c.displayName} | ${c.cargo || 's/cargo'} | ${local(c)} | ${statusLabel(c.status)} | ${brl(Number(c.valorRecebido) || 0)}`),
        ``,
        `REPASSES RECENTES (data · valor · candidato · descrição):`,
        ...(repasses || []).map((r: any) =>
          `- ${r.data} · ${brl(Number(r.valor) || 0)} · ${repMap[r.candidateId] || '?'} · ${r.descricao || 's/descrição'}`),
      ].join('\n');

      // 2. Gemini interpreta — retorna JSON estruturado (consulta OU intenção de lançar repasse)
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        return res.json({ intent: 'consulta', message: 'A IA está temporariamente indisponível. Total repassado: ' + brl(totalRepassado) + ' entre ' + candidates.length + ' candidatos.', draft: null });
      }
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(geminiKey);
      // maxOutputTokens alto pra caber listas longas (ex: "todos os candidatos em
      // ordem alfabética") sem truncar o JSON — truncamento era a causa do JSON
      // cru vazar pro presidente. (SDK 0.1.3 não tem responseMimeType; o parse
      // abaixo já lida com cercas markdown e o fallback nunca exibe JSON cru.)
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      });
      const hojeIso = new Date().toISOString().slice(0, 10);
      const prompt = `Você é o assistente do Centro de Comando do partido, falando com o PRESIDENTE.

Responda SEMPRE em JSON válido (nada fora do JSON):
{
  "intent": "consulta" | "lancar_repasse" | "editar_repasse" | "excluir_repasse" | "criar_candidato" | "excluir_candidato" | "gerar_relatorio" | "ajuda" | "acao_nao_suportada",
  "message": "texto curto pro presidente",
  "draft": null OU { "candidateName": "nome citado", "valor": numero_em_reais, "descricao": "finalidade", "cargo": "cargo se citado", "regiao": "cidade se citada", "estado": "UF se citada", "phone": "telefone se citado" }
}

REGRAS:
- "consulta": o presidente pergunta/pede pra ORGANIZAR, LISTAR, FILTRAR ou ORDENAR dados. Responda em "message" usando APENAS o snapshot abaixo (nunca invente valor/nome/data). draft = null.
- "lancar_repasse": LANÇAR/ADICIONAR/REPASSAR um valor a um candidato. Extraia candidateName, valor, descricao. Se faltar valor ou candidato, use "consulta" e peça o que falta.
- "editar_repasse": ALTERAR/EDITAR/MUDAR/CORRIGIR o valor de um repasse de um candidato. Extraia candidateName e o NOVO valor (campo "valor"). descricao opcional.
- "excluir_repasse": APAGAR/EXCLUIR/REMOVER/CANCELAR um repasse de um candidato. Extraia candidateName. valor/descricao = null.
- "criar_candidato": CRIAR/CADASTRAR/ADICIONAR um novo CANDIDATO/pessoa (ex: "cadastra a candidata Ana Maria Braga, vereadora, Niterói RJ"). Extraia candidateName (obrigatório) e, se citados, cargo, regiao (cidade), estado (UF), phone. Se não vier nome, use "consulta" e peça o nome.
  O campo "cargo" DEVE ser exatamente um destes: "Presidente", "Senador", "Deputado Federal", "Deputado Estadual", "Prefeito", "Vereador". Mapeie variações pro valor da lista (ex: "vereadora"→"Vereador", "prefeita"→"Prefeito", "deputada estadual"→"Deputado Estadual"). Se o cargo citado não for nenhum desses, deixe cargo vazio.
- "excluir_candidato": EXCLUIR/APAGAR/REMOVER um CANDIDATO inteiro (a pessoa, não um repasse). Extraia candidateName.
- "gerar_relatorio": GERAR/IMPRIMIR/BAIXAR RELATÓRIO de repasses. message = "Gerei o relatório, abrindo aqui." draft = null.
- "ajuda": o usuário pergunta COMO fazer algo, o que você faz, pede ajuda/instruções, ou está claramente perdido (ex: "como cadastro um candidato?", "o que você consegue fazer?", "me ajuda", "não sei como lançar repasse"). draft = null. (O texto de ajuda é montado pelo sistema.)
- "acao_nao_suportada": qualquer outra escrita (mexer em metas, comitê, válvula, etc). message explica que ainda não executa e oriente usar os botões. NUNCA finja que fez.

COACHING (seja uma GUIA, não só executora):
- Sempre que faltar um dado, o comando estiver ambíguo, ou você não encontrar o candidato, NÃO responda seco — ENSINE com um EXEMPLO de comando pronto pro usuário copiar. Ex: 'Não achei "Maria". Pra lançar, tente: "lança 5 mil pra Maria Silva, material gráfico".'
- Quando o usuário parecer não saber usar, ofereça o jeito certo de falar o comando.
- DISTINÇÃO IMPORTANTE: "repasse" = dinheiro/valor pra um candidato; "candidato" = a pessoa. "criar usuário/candidato/pessoa" = criar_candidato (NÃO é repasse).
- "valor" sempre número (ex: "8 mil"=8000).
- Compliance: se perguntarem se é IA, message = "Sim, sou o assistente automatizado do seu Centro de Comando."
- Valores sempre em R$. Tom direto, chat.

COMO RESPONDER CONSULTAS DE LISTA/ORDENAÇÃO (importante):
- Quando pedirem uma lista (ex: "todos os candidatos com cadastro pendente em ordem alfabética decrescente"), INCLUA TODOS os itens que batem com o filtro — não resuma "há 1 candidato", liste de fato cada um.
- Respeite a ordem pedida (alfabética, crescente/decrescente, por valor, etc). Se pedirem "decrescente e alfabética", ordene de Z→A.
- Use uma linha por item, com hífen ou número. Ex: "1. Carlos Dias — Vereador, São Gonçalo/RJ".
- "cadastro pendente"/"não concluiu o cadastro" = status "pending". "cadastrado"/"concluído" = status "active".
- Se nenhum candidato bate o filtro, diga isso claramente.
- NUNCA mostre nomes de coluna crus do banco (ex: "status 'pending'") — traduza pro presidente ("cadastro ainda pendente").

SNAPSHOT ATUAL DO PARTIDO (hoje: ${hojeIso}):
${snapshot}

PEDIDO DO PRESIDENTE: "${text}"

JSON:`;
      const result = await model.generateContent(prompt);
      const raw = result.response.text().trim();

      // Parse defensivo: tenta JSON puro (responseMimeType garante), senão extrai {...}.
      let parsed: any = null;
      try { parsed = JSON.parse(raw); } catch { /* tenta extrair abaixo */ }
      if (!parsed) {
        try { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch { /* */ }
      }
      if (!parsed || typeof parsed !== 'object') {
        // Nunca joga JSON cru pro presidente: tenta resgatar só o campo "message",
        // senão devolve um aviso amigável.
        let msg = '';
        const mm = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (mm) { try { msg = JSON.parse(`"${mm[1]}"`); } catch { msg = mm[1]; } }
        return res.json({ intent: 'consulta', draft: null, message: msg || 'Não consegui formatar a resposta. Pode reformular a pergunta?' });
      }

      const intent = ['consulta', 'lancar_repasse', 'editar_repasse', 'excluir_repasse', 'criar_candidato', 'excluir_candidato', 'gerar_relatorio', 'ajuda', 'acao_nao_suportada'].includes(parsed.intent) ? parsed.intent : 'consulta';
      let message = String(parsed.message || '').slice(0, 2000);
      let draft: any = null;

      // Ajuda: texto fixo (sempre preciso) ensinando os comandos com exemplos.
      if (intent === 'ajuda') {
        message = [
          'Posso te ajudar com estas tarefas — é só falar naturalmente (por texto ou voz):',
          '',
          '📊 *Consultar*: "quanto já repassei?", "lista os candidatos pendentes em ordem alfabética", "quem recebeu mais?"',
          '➕ *Cadastrar candidato*: "cadastra o João Silva, vereador, Niterói RJ, 21999990000" (preciso de nome, cidade e UF; cargo e telefone ajudam)',
          '💰 *Lançar repasse*: "lança 5 mil pro João, material gráfico"',
          '✏️ *Editar repasse*: "muda o repasse do João pra 8 mil"',
          '🗑️ *Excluir repasse*: "exclui o último repasse do João"',
          '👤 *Excluir candidato*: "exclui o candidato João Silva"',
          '📄 *Relatório*: "gera o relatório de repasses"',
          '',
          'Antes de salvar qualquer coisa eu sempre mostro um resumo e peço sua confirmação.',
        ].join('\n');
      }

      // 3. Se for lançar repasse: resolve candidato + valida (backend manda no draft)
      if (intent === 'lancar_repasse' && parsed.draft) {
        const wantName = String(parsed.draft.candidateName || '').trim().toLowerCase();
        const valor = Number(parsed.draft.valor) || 0;
        const descricao = String(parsed.draft.descricao || '').slice(0, 300);

        const { data: allCands } = await supabase.from('party_candidates')
          .select('id, displayName').eq('partyId', party.id);
        const matches = (allCands || []).filter((c: any) =>
          c.displayName.toLowerCase().includes(wantName) || wantName.includes(c.displayName.toLowerCase()));

        if (!wantName || valor <= 0) {
          message = 'Pra lançar um repasse eu preciso do nome do candidato e do valor. Pode repetir? Ex: "lance 5 mil pra Maria, material gráfico".';
        } else if (matches.length === 0) {
          message = `Não encontrei nenhum candidato chamado "${parsed.draft.candidateName}". Confira o nome na lista de candidatos.`;
        } else if (matches.length > 1) {
          message = `Há mais de um candidato parecido com "${parsed.draft.candidateName}": ${matches.map((c: any) => c.displayName).join(', ')}. Qual deles?`;
        } else {
          const cand = matches[0];
          draft = {
            type: 'create_repasse',
            candidateId: cand.id,
            candidateName: cand.displayName,
            valor, descricao, data: hojeIso,
          };
          message = `Vou lançar um repasse de ${brl(valor)} para ${cand.displayName}${descricao ? ` (${descricao})` : ''}. Confirma?`;
        }
      }

      // CRIAR candidato (a pessoa). Confirma antes de gravar (regra de ouro).
      if (intent === 'criar_candidato') {
        const nome = String(parsed.draft?.candidateName || '').trim().slice(0, 160);
        if (!nome) {
          message = 'Qual o nome do candidato que você quer cadastrar?';
        } else {
          const cargo = normalizeCargo(parsed.draft?.cargo);
          const regiao = String(parsed.draft?.regiao || parsed.draft?.cidade || '').trim().slice(0, 80);
          const estado = normalizeUF(parsed.draft?.estado || parsed.draft?.uf) || '';
          const phone = String(parsed.draft?.phone || parsed.draft?.telefone || '').replace(/\D/g, '').slice(0, 20);
          // Obrigatórios: cidade + UF (mapa/telão) + telefone (convite WhatsApp).
          // Sem eles, não monto o cadastro — ensino o formato certo com exemplo.
          const faltamObrig: string[] = [];
          if (!regiao) faltamObrig.push('cidade');
          if (!estado) faltamObrig.push('estado (UF)');
          if (!phone || phone.length < 10) faltamObrig.push('telefone (WhatsApp)');
          if (faltamObrig.length) {
            message = `Pra cadastrar ${nome} eu preciso de ${faltamObrig.join(', ')} — cidade/UF posicionam no mapa e o telefone é pra mandar o convite por WhatsApp. Me manda assim: "${nome}, vereador, Niterói RJ, 21999990000".`;
          } else {
            const { data: allCands } = await supabase.from('party_candidates').select('displayName').eq('partyId', party.id);
            const dupe = (allCands || []).some((c: any) => normName(c.displayName) === normName(nome));
            draft = { type: 'create_candidate', candidateName: nome, cargo, regiao, estado, phone };
            const loc = [regiao, estado].filter(Boolean).join('/');
            message = `${dupe ? `⚠️ Já existe um candidato chamado "${nome}". ` : ''}Vou cadastrar ${nome}${cargo ? `, ${cargo}` : ''} (${loc}) · 📱 ${phone}.`
              + (cargo ? '' : ' Sem cargo (opcional — dá pra adicionar depois).')
              + ` Confirma?`;
          }
        }
      }

      // EXCLUIR candidato inteiro (a pessoa + todos os dados). Resolve por nome.
      if (intent === 'excluir_candidato') {
        const wantName = String(parsed.draft?.candidateName || '').trim().toLowerCase();
        const { data: allCands } = await supabase.from('party_candidates').select('id, displayName').eq('partyId', party.id);
        const matches = (allCands || []).filter((c: any) =>
          c.displayName.toLowerCase().includes(wantName) || (wantName && wantName.includes(c.displayName.toLowerCase())));
        if (!wantName) message = 'Qual candidato você quer excluir? Me diga o nome.';
        else if (matches.length === 0) message = `Não encontrei candidato "${parsed.draft?.candidateName}".`;
        else if (matches.length > 1) message = `Há mais de um parecido com "${parsed.draft?.candidateName}": ${matches.map((c: any) => c.displayName).join(', ')}. Qual deles?`;
        else {
          const cand = matches[0];
          draft = { type: 'delete_candidate', candidateId: cand.id, candidateName: cand.displayName };
          message = `⚠️ Vou EXCLUIR o candidato ${cand.displayName} e TODOS os dados dele (repasses, comitê, check-ins). Não pode ser desfeito. Confirma?`;
        }
      }

      // EDITAR ou EXCLUIR repasse: resolve candidato → 1 repasse (direto) OU vários (lista pra escolher)
      let options: any = null;       // lista de repasses quando o candidato tem vários
      let pendingAction: any = null; // ação a aplicar quando o presidente escolher na lista
      if ((intent === 'editar_repasse' || intent === 'excluir_repasse') && parsed.draft) {
        const isEdit = intent === 'editar_repasse';
        const wantName = String(parsed.draft.candidateName || '').trim().toLowerCase();
        const novoValor = Number(parsed.draft.valor) || 0;
        const { data: allCands } = await supabase.from('party_candidates')
          .select('id, displayName').eq('partyId', party.id);
        const candMatches = (allCands || []).filter((c: any) =>
          c.displayName.toLowerCase().includes(wantName) || (wantName && wantName.includes(c.displayName.toLowerCase())));

        if (!wantName) {
          message = 'De qual candidato é o repasse? Me diga o nome.';
        } else if (candMatches.length === 0) {
          message = `Não encontrei candidato "${parsed.draft.candidateName}". Confira na lista.`;
        } else if (candMatches.length > 1) {
          message = `Há mais de um parecido com "${parsed.draft.candidateName}": ${candMatches.map((c: any) => c.displayName).join(', ')}. Qual deles?`;
        } else if (isEdit && novoValor <= 0) {
          message = `Qual o novo valor do repasse de ${candMatches[0].displayName}?`;
        } else {
          const cand = candMatches[0];
          const { data: reps } = await supabase.from('party_repasses')
            .select('id, valor, data, descricao').eq('candidateId', cand.id)
            .order('data', { ascending: false, nullsFirst: false });
          const list = (reps || []) as any[];

          if (list.length === 0) {
            message = `${cand.displayName} não tem repasses pra ${isEdit ? 'editar' : 'excluir'}.`;
          } else if (list.length === 1) {
            // Um só → confirmação direta
            const rep = list[0];
            if (isEdit) {
              draft = { type: 'edit_repasse', repasseId: rep.id, candidateId: cand.id, candidateName: cand.displayName,
                valorAntigo: Number(rep.valor) || 0, valor: novoValor,
                descricao: parsed.draft.descricao ? String(parsed.draft.descricao).slice(0, 300) : (rep.descricao || ''), data: rep.data };
              message = `Vou alterar o repasse de ${cand.displayName} de ${brl(Number(rep.valor) || 0)} para ${brl(novoValor)}. Confirma?`;
            } else {
              draft = { type: 'delete_repasse', repasseId: rep.id, candidateId: cand.id, candidateName: cand.displayName,
                valor: Number(rep.valor) || 0, descricao: rep.descricao || '', data: rep.data };
              message = `⚠️ Vou EXCLUIR o repasse de ${cand.displayName}: ${brl(Number(rep.valor) || 0)}${rep.descricao ? ` (${rep.descricao})` : ''}. Não pode ser desfeito. Confirma?`;
            }
          } else {
            // Vários → destaca o MAIS RECENTE como sugestão (#147) e mostra a lista.
            // A lista já vem ordenada por data desc, então list[0] é o mais recente.
            options = list.map((r: any, idx: number) => ({
              repasseId: r.id, candidateId: cand.id, candidateName: cand.displayName,
              valor: Number(r.valor) || 0, descricao: r.descricao || '', data: r.data,
              suggested: idx === 0, // o mais recente
            }));
            pendingAction = isEdit ? { type: 'edit_repasse', valor: novoValor } : { type: 'delete_repasse' };
            const recente = list[0];
            const recenteData = recente.data ? new Date(recente.data).toLocaleDateString('pt-BR') : 'sem data';
            message = `${cand.displayName} tem ${list.length} repasses. O mais recente é ${brl(Number(recente.valor) || 0)} de ${recenteData}`
              + `${recente.descricao ? ` (${recente.descricao})` : ''} — é esse que você quer ${isEdit ? `alterar para ${brl(novoValor)}` : 'excluir'}? `
              + 'Se for outro, toque na lista abaixo.';
          }
        }
      }

      // Se montou lista de escolha, o intent vira 'escolher_repasse' pro front
      const finalIntent = options ? 'escolher_repasse' : intent;

      await supabase.from('party_ai_command_logs').insert({
        partyId: party.id, userId, inputType: (req.body || {}).inputType || 'text',
        userCommand: text.slice(0, 500), detectedIntent: finalIntent, actionStatus: draft ? 'draft' : (options ? 'choosing' : 'ok'),
      }).then(() => {}, () => {});

      return res.json({ intent: finalIntent, message, draft, options, pendingAction });
    } catch (err: any) {
      console.error('[party] ai/command:', err);
      return res.status(500).json({ error: err?.message || 'ai_failed', message: 'Não consegui processar agora. Tente reformular.' });
    }
  });

  // ── BOTÃO DE EMERGÊNCIA (#141) — zera dados OPERACIONAIS do partido ────
  //
  // Apaga repasses, candidatos, comitês, check-ins e log da válvula + fotos do
  // storage. NÃO apaga: a conta `parties`, o usuário presidente, plano/assinatura.
  //
  // Segurança em camadas:
  //   1. Sessão autenticada (requireAuth já validou o JWT antes daqui)
  //   2. Role 'Presidente de Partido' + dono do partido (parties.presidentId)
  //   3. confirmationText === 'APAGAR TUDO' (digitado pelo usuário)
  //   4. Reautenticação de senha: feita NO CLIENTE via signInWithPassword antes
  //      de chamar isto — a senha NUNCA trafega pro nosso backend (LGPD/segurança).
  //      O cliente só chama este endpoint se a senha conferir.
  router.post('/emergency-wipe', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const userType = (req as any).user?.userType;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (userType !== 'Presidente de Partido' && !(req as any).user?.isSupremeAdmin) {
      return res.status(403).json({ error: 'apenas_presidente' });
    }

    const party = await partyOf(userId);
    if (!party) return res.status(404).json({ error: 'partido_nao_encontrado' });

    const confirmationText = String((req.body || {}).confirmationText || '').trim();
    if (confirmationText !== 'APAGAR TUDO') {
      return res.status(400).json({ error: 'confirmacao_invalida', detail: 'Digite exatamente APAGAR TUDO.' });
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || (req as any).ip || null;
    const userAgent = (req.headers['user-agent'] as string)?.slice(0, 300) || null;
    const summary: Record<string, number> = {};

    try {
      // IDs dos candidatos (pra apagar dependências + contar fotos)
      const { data: cands } = await supabase.from('party_candidates')
        .select('id').eq('partyId', party.id);
      const candIds = (cands || []).map((c: any) => c.id);
      summary.candidates = candIds.length;

      // 1. Fotos do storage (comitês + check-ins) — best-effort
      try {
        const { data: files } = await supabase.storage.from(PROOF_BUCKET).list(`party/${party.id}`);
        if (files?.length) {
          const paths = files.map((f: any) => `party/${party.id}/${f.name}`);
          await supabase.storage.from(PROOF_BUCKET).remove(paths);
          summary.storageFiles = paths.length;
        }
      } catch (e: any) { console.warn('[wipe] storage:', e?.message); }

      // 2. Tabelas dependentes primeiro (FK-safe), depois candidatos
      const delCount = async (table: string, col: string, val: string): Promise<number> => {
        const { count } = await supabase.from(table).delete({ count: 'exact' }).eq(col, val);
        return count || 0;
      };
      summary.repasses = await delCount('party_repasses', 'partyId', party.id);
      summary.committees = await delCount('party_committees', 'partyId', party.id);
      summary.checkins = await delCount('party_checkins', 'partyId', party.id);
      summary.valveLog = await delCount('party_valve_log', 'partyId', party.id);
      summary.candidatesDeleted = await delCount('party_candidates', 'partyId', party.id);

      // 3. Auditoria (resumo quantitativo, sem conteúdo sensível)
      await supabase.from('party_wipe_audit').insert({
        partyId: party.id, executedBy: userId,
        deletedSummary: summary, scope: 'operational', status: 'success',
        ip, userAgent,
      });

      return res.json({ success: true, message: 'Dados operacionais do partido apagados.', deletedSummary: summary });
    } catch (err: any) {
      console.error('[party] emergency-wipe:', err);
      await supabase.from('party_wipe_audit').insert({
        partyId: party.id, executedBy: userId,
        deletedSummary: summary, scope: 'operational', status: 'error',
        errorMessage: err?.message?.slice(0, 300) || 'erro', ip, userAgent,
      }).then(() => {}, () => {});
      return res.status(500).json({ error: err?.message || 'wipe_failed', partial: summary });
    }
  });

  return router;
}
