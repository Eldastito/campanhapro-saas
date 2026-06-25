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


// Linhas de cabeçalho que NÃO podem virar candidato (ex.: "Nome", "nome na urna...").
const HEADER_TERMS = new Set([
  'nome', 'name', 'candidato', 'candidata', 'nome do candidato', 'displayname',
  'nome na urna', 'nome na urna eletronica', 'nome urna',
]);
const isHeaderName = (v: any): boolean => HEADER_TERMS.has(normName(v));

// Cargos eletivos (lista fixa). normalizeCargo mapeia variações (inclusive
// femininas) pro valor canônico da lista; vazio se não reconhecer.
const CARGOS = ['Presidente', 'Senador', 'Deputado Federal', 'Deputado Estadual', 'Prefeito', 'Vereador'];
const normalizeCargo = (v: any): string => {
  const s = normName(v);
  if (!s) return '';
  const direct = CARGOS.find((c) => normName(c) === s);
  if (direct) return direct;
  // Códigos comuns em planilhas de partido: F = Deputado Federal, E = Estadual.
  if (s === 'f' || s === 'fed') return 'Deputado Federal';
  if (s === 'e' || s === 'est') return 'Deputado Estadual';
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

// M1: nunca devolve error.message cru do PostgREST ao cliente (pode vazar
// detalhe interno do schema ou PII em violação de constraint). Loga no
// servidor, responde genérico.
function dbFail(res: Response, error: any) {
  console.error('[party] db error:', error?.message || error);
  return res.status(500).json({ error: 'erro_interno' });
}

// C1: gate de papel do Centro de Comando. Só presidente de partido (ou supremo).
// É o ponto de estrangulamento: sem partido provisionado, todos os outros
// endpoints já barram via partyOf(). Mantido explícito como defesa em camadas.
function isPresident(req: Request): boolean {
  const u = (req as any).user;
  return u?.userType === 'Presidente de Partido' || !!u?.isSupremeAdmin;
}

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

  // M2: reautenticação verificada NO SERVIDOR para ações destrutivas. O cliente
  // refaz o signInWithPassword num cliente efêmero e manda o access_token novo
  // (a senha nunca trafega pro backend — LGPD). Aqui provamos: token válido +
  // mesmo usuário + emitido há ≤10 min. O `iat` recente é o que distingue uma
  // reautenticação fresca do JWT ambiente da sessão (que um atacante com a
  // sessão sequestrada já teria). Sem isso, a "reautenticação" era só no cliente.
  async function verifyFreshReauth(token: string, expectedUserId: string): Promise<boolean> {
    if (!token || token.split('.').length !== 3) return false;
    try {
      const { data, error } = await (supabase as any).auth.getUser(token);
      if (error || data?.user?.id !== expectedUserId) return false;
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
      const ageSec = Date.now() / 1000 - (Number(payload.iat) || 0);
      return ageSec >= 0 && ageSec <= 600; // 10 min
    } catch { return false; }
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

    // Equipe REGISTRADA pelo candidato (inclui convites ainda pendentes). As
    // metas/checklist do presidente marcam assim que o candidato cadastra o
    // coordenador/líder — mesmo antes da pessoa concluir o próprio cadastro.
    // (O SCORE continua usando só usuários reais — saúde de verdade.)
    const regTeam: Record<string, { coord: number; lider: number }> = {};
    if (campaignIds.length) {
      const { data: invs } = await supabase.from('party_member_invites')
        .select('"campaignId", role').in('campaignId', campaignIds).in('role', ['Coordenador', 'Líder']);
      for (const r of invs || []) {
        const k = (r as any).campaignId;
        regTeam[k] = regTeam[k] || { coord: 0, lider: 0 };
        if ((r as any).role === 'Coordenador') regTeam[k].coord++; else regTeam[k].lider++;
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

    const enriched = await Promise.all(candidates.map(async (c: any) => {
      const t = (c.campaignId && team[c.campaignId]) || { coord: 0, lider: 0 };
      const rt = (c.campaignId && regTeam[c.campaignId]) || { coord: 0, lider: 0 };
      // Meta marca pelo registrado OU usuário real (o maior).
      const metaCoord = Math.max(t.coord, rt.coord);
      const metaLider = Math.max(t.lider, rt.lider);
      const com = committees[c.id];
      const metas = [
        { label: 'Candidato cadastrado', done: c.status === 'active' },
        { label: 'Comitê com foto/GPS', done: !!(com && com.photo && com.lat) },
        { label: 'Coordenador na equipe', done: metaCoord >= 1 },
        { label: '5 líderes ativos', done: metaLider >= 5 },
      ];
      const score = computeScore({
        status: c.status,
        committee: com ? { hasPhoto: !!com.photo, geoSource: com.geoSource } : null,
        checkinCount: checkinCount[c.id] || 0,
        lastCheckinAt: lastCheckinAt[c.id] || null,
        coordCount: metaCoord, leaderCount: metaLider,
      });
      return {
        ...c, coordCount: metaCoord, leaderCount: metaLider,
        committee: com ? { address: com.address, lat: com.lat, lng: com.lng, hasPhoto: !!com.photo, geoSource: com.geoSource } : null,
        checkinCount: checkinCount[c.id] || 0, lastCheckinAt: lastCheckinAt[c.id] || null,
        metas, metasDone: metas.filter((m) => m.done).length, metasTotal: metas.length,
        score,
        // Retrato do candidato (re-hospedado no Storage). URL assinada p/ exibição.
        photoUrl: await signPhoto(c.metadata?.photoPath),
      };
    }));
    // Não vaza dados de cobrança pro presidente (valor só no Supreme Admin).
    const { billingNote, ...partySafe } = party as any;
    return res.json({ party: partySafe, candidates: enriched });
  });

  // Provisiona o partido do presidente (idempotente).
  // C1: gate de papel. O caminho legítimo de virar presidente é o onboarding
  // (/bootstrap define type='Presidente de Partido'). Sem este gate, qualquer
  // usuário autenticado criava um partido aqui e se auto-promovia ao produto pago.
  router.post('/provision', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!isPresident(req)) return res.status(403).json({ error: 'apenas_presidente' });
    const existing = await partyOf(userId);
    if (existing) return res.json({ party: existing, created: false });
    const name = String((req.body?.name || 'Meu Partido')).slice(0, 120);
    const { data, error } = await supabase.from('parties')
      .insert({ name, presidentId: userId }).select('*').single();
    if (error) return dbFail(res, error);
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
    if (error) return dbFail(res, error);
    const { billingNote, ...safe } = data as any;
    return res.json({ party: safe });
  });

  // Adiciona um candidato (pending) ao partido + gera token de convite.
  router.post('/candidates', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const party = await partyOf(userId);
    if (!party) return res.status(409).json({ error: 'party_not_provisioned' });
    const { displayName, cargo, regiao, estado, phone, email } = req.body || {};
    if (!displayName?.trim()) return res.status(400).json({ error: 'displayName_obrigatorio' });
    const { data: cand, error } = await supabase.from('party_candidates').insert({
      partyId: party.id,
      displayName: String(displayName).slice(0, 160),
      cargo: normalizeCargo(cargo) || (cargo?.trim() || null),
      regiao: regiao?.trim() || null,
      estado: normalizeUF(estado),
      phone: phone?.trim() || null,
      email: email?.trim().toLowerCase() || null,
      status: 'pending',
      inviteToken: newToken(),
    }).select('*').single();
    if (error) return dbFail(res, error);
    return res.json({ candidate: cand });
  });

  // Import em lote (planilha do presidente). Body: { rows: [{displayName,cargo,regiao,estado,phone}] }
  router.post('/candidates/import', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const party = await partyOf(userId);
    if (!party) return res.status(409).json({ error: 'party_not_provisioned' });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    // Dedup contra registros JÁ EXISTENTES no banco. Quem decide duplicata
    // DENTRO do lote é o usuário no card de resolução (frontend).
    // REGRA ELEITORAL: cargos diferentes = pessoas diferentes (Janaína Federal
    // vs Janaína Estadual em Araruama NÃO são duplicatas). Logo, dedup só
    // considera duplicata se nome+cidade batem E cargos são compatíveis (iguais
    // ou pelo menos um vazio = desconhecido). Idem pra dedup por telefone.
    const { data: existing } = await supabase.from('party_candidates')
      .select('displayName, phone, regiao, cargo').eq('partyId', party.id);
    const existByNC = new Map<string, string[]>(); // nome+cidade → cargos
    const existByPhone = new Map<string, string[]>(); // telefone → cargos
    for (const e of existing || []) {
      const cargo = (e as any).cargo || '';
      const nk = normName((e as any).displayName) + '||' + normName((e as any).regiao);
      if (!existByNC.has(nk)) existByNC.set(nk, []);
      existByNC.get(nk)!.push(cargo);
      const pk = normPhone((e as any).phone);
      if (pk.length >= 8) {
        if (!existByPhone.has(pk)) existByPhone.set(pk, []);
        existByPhone.get(pk)!.push(cargo);
      }
    }
    const cargoCompat = (a: string, b: string) => !a || !b || a === b;

    let duplicates = 0, invalid = 0;
    const toInsert: any[] = [];
    for (const r of rows.slice(0, 5000)) {
      const displayName = String(r.displayName || r.nome || '').trim().slice(0, 160);
      if (!displayName) { invalid++; continue; }
      if (isHeaderName(displayName)) { invalid++; continue; }
      const regiao = (r.regiao || r.cidade || '').toString().trim();
      const nk = normName(displayName) + '||' + normName(regiao);
      const pk = normPhone(r.phone || r.telefone);
      const incomingCargo = normalizeCargo(r.cargo) || ((r.cargo || '').toString().trim() || '');
      const dupByNC = (existByNC.get(nk) || []).some((c: string) => cargoCompat(c, incomingCargo));
      const dupByPhone = pk.length >= 8 && (existByPhone.get(pk) || []).some((c: string) => cargoCompat(c, incomingCargo));
      const isDup = dupByNC || dupByPhone;
      if (isDup) { duplicates++; continue; }
      // Trava re-importação na MESMA chamada: adiciona aos índices pra se a mesma
      // linha vier 2x, só uma seja gravada.
      if (!existByNC.has(nk)) existByNC.set(nk, []);
      existByNC.get(nk)!.push(incomingCargo);
      if (pk.length >= 8) {
        if (!existByPhone.has(pk)) existByPhone.set(pk, []);
        existByPhone.get(pk)!.push(incomingCargo);
      }
      toInsert.push({
        partyId: party.id,
        displayName,
        cargo: normalizeCargo(r.cargo) || ((r.cargo || '').toString().trim() || null),
        regiao: (r.regiao || r.cidade || '').toString().trim() || null,
        estado: normalizeUF(r.estado || r.uf),
        phone: (r.phone || r.telefone || '').toString().trim() || null,
        email: (() => { const e = String(r.email || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null; })(),
        status: 'pending',
        inviteToken: newToken(),
      });
    }
    if (!toInsert.length) return res.json({ created: 0, duplicates, invalid });
    const cleanInsert = toInsert;
    const { data, error } = await supabase.from('party_candidates').insert(cleanInsert).select('id');
    if (error) return dbFail(res, error);
    const inserted = data || [];

    // Pré-aquece geo_cache pras cidades dos candidatos importados em background
    // (fire-and-forget). Sem isso, o telão "esconde" candidatos sem comitê na
    // primeira carga até o cache esquentar — agora chegam antes do usuário abrir.
    const uniqueCities = new Set<string>();
    for (const r of cleanInsert as any[]) {
      if (r.regiao) {
        const q = r.estado ? `${r.regiao}, ${r.estado}, Brasil` : `${r.regiao}, Brasil`;
        uniqueCities.add(q);
      }
    }
    for (const q of uniqueCities) void import('../../../lib/geocode').then((m) => m.geocode(q));

    return res.json({ created: inserted.length, duplicates, invalid });
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

    // Entrada: texto colado OU um arquivo (imagem/PDF) arrastado. CSV/Excel viram
    // texto no frontend; imagem e PDF chegam aqui em base64 pra IA ler nativamente.
    const body = (req.body || {}) as any;
    const text = String(body.text || '').slice(0, 200000);
    const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : '';
    const mimeType = String(body.mimeType || '');
    const isFile = !!fileBase64 && /^(image\/|application\/pdf)/.test(mimeType);
    // ~10MB de base64 (≈7,5MB de arquivo) — protege contra payload absurdo.
    if (isFile && fileBase64.length > 10_000_000) {
      return res.status(413).json({ error: 'arquivo_grande', message: 'Arquivo muito grande. Use um menor ou cole o texto.' });
    }
    if (!text.trim() && !isFile) return res.status(400).json({ error: 'texto_vazio' });

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return res.status(503).json({ error: 'ia_indisponivel', message: 'A IA está indisponível agora. Use o modo "Colar simples".' });

    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(geminiKey);
      // maxOutputTokens alto: listas grandes (centenas de candidatos) precisam caber
      // INTEIRAS no JSON de saída, senão a IA "corta" no meio e some com o resto.
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0, maxOutputTokens: 65536 } });
      const regras = `Você recebe uma lista de candidatos de um partido — pode vir como planilha colada (com OU SEM cabeçalho, colunas extras tipo CPF/observações, ordem qualquer, separadores variados) OU como um ARQUIVO (imagem/foto de uma lista, ou PDF).

⚠️ ATENÇÃO CRÍTICA — mapeie por SEMÂNTICA (conteúdo), NÃO por posição da coluna ⚠️
NÃO assuma que a 2ª coluna do JSON é a 2ª coluna da planilha. Identifique cada campo pelo SIGNIFICADO do conteúdo. Erros comuns que você DEVE evitar:
- ❌ Colocar VALOR (número R$) no campo "cargo" — cargo é texto (F/E/Vereador), não número
- ❌ Colocar CARGO (F/E) no campo "regiao" — regiao é cidade
- ❌ Colocar CIDADE no campo "estado" — estado é sigla UF de 2 letras (RJ, SP, MG…)

NÃO É PRECISO QUE O USUÁRIO IDENTIFIQUE/ROTULE AS COLUNAS. Se HOUVER cabeçalho, use-o. Se NÃO houver cabeçalho (ou os títulos forem confusos), IDENTIFIQUE cada campo pelo CONTEÚDO, usando estas pistas:
- e-mail → tem "@" (ex.: joao@gmail.com)
- telefone → sequência de 10-13 dígitos (com ou sem DDD/parênteses/traços)
- estado/UF → exatamente 2 letras (RJ, SP, MG…)
- valor → número/moeda (R$, "25.400", "25400,00")
- cargo → F / E / "Vereador" / "Prefeito" / "Senador" / "Deputado…"
- data → formato de data (DD/MM/AAAA, AAAA-MM-DD)
- o que sobrar, em texto, que não é nenhum dos acima → é o NOME da pessoa

Extraia estes campos:
- displayName: nome da pessoa / "nome na urna" (OBRIGATÓRIO).
- cargo: o CARGO ELEITORAL (texto, NUNCA número). "F"="Deputado Federal", "E"="Deputado Estadual"; senão "Vereador"/"Prefeito"/"Senador"/"Deputado…". Se a coluna tiver NÚMERO, NÃO é cargo — IGNORE o número.
- regiao: a CIDADE/município (texto). Ex.: "Niterói", "São Gonçalo". NUNCA coloque "F"/"E" aqui — isso é cargo!
- estado: a UF (EXATAMENTE 2 letras maiúsculas). Se não houver UF mas a cidade for conhecida, INFIRA (Niterói→RJ, São Gonçalo→RJ, Caxias→RJ, São Paulo→SP, Belo Horizonte→MG…). Bairros do Rio (Copacabana, Bangu, Pavuna, Tijuca, Jacarepaguá, Santa Cruz, Guaratiba…) → estado="RJ" e regiao="Rio de Janeiro". NUNCA ponha nome de cidade aqui — só sigla de 2 letras.
- phone: telefone/WhatsApp — só os dígitos.
- email: o E-MAIL da pessoa (tem "@"). "" se não houver. (CPF e RG continuam PROIBIDOS — não extraia.)

IGNORE colunas de VALOR/dinheiro (R$) e de DATA — o partido NÃO controla valores aqui. Liste-as em "colunasIgnoradas".

Responda SOMENTE em JSON válido (nada fora do JSON):
{
  "candidatos": [ { "displayName": "", "cargo": "", "regiao": "", "estado": "", "phone": "", "email": "" } ],
  "colunasIgnoradas": ["nome das colunas/seções extras que você descartou (inclua aqui colunas de valor/dinheiro e de data)"]
}

REGRAS:
- IGNORE a linha de cabeçalho (quando houver) e linhas/itens vazios — cabeçalho NUNCA vira candidato.
- Não invente dados: se um campo não existe, deixe "".
- NÃO inclua CPF nem RG, nem qualquer dado sensível além dos campos acima. NÃO inclua valores em R$ nem datas.
- phone só com dígitos.
- Liste TODAS as linhas/candidatos encontrados — MESMO que o nome se repita (homônimos e registros múltiplos são comuns em planilhas de partido). O backend trata unificação; você só extrai.

EXEMPLO 1 — COM cabeçalho (a coluna "$" é ignorada):
"""
nome na urna eletronica | $    | cargo | municipio
Pastora Simone           | 25400| F     | Rio
"""
→ { "candidatos": [ { "displayName": "Pastora Simone", "cargo": "Deputado Federal", "regiao": "Rio de Janeiro", "estado": "RJ", "phone": "", "email": "" } ], "colunasIgnoradas": ["$"] }

EXEMPLO 2 — SEM cabeçalho (identifique pelo conteúdo):
"""
João Silva  21999990000  joao@gmail.com  Niterói  RJ  Vereador
"""
→ { "candidatos": [ { "displayName": "João Silva", "cargo": "Vereador", "regiao": "Niterói", "estado": "RJ", "phone": "21999990000", "email": "joao@gmail.com" } ] }`;

      const result = isFile
        ? await model.generateContent([
            { inlineData: { data: fileBase64, mimeType } },
            { text: `${regras}\n\nO conteúdo acima é o ARQUIVO com a lista. Extraia os candidatos.\n\nJSON:` },
          ])
        : await model.generateContent(`${regras}\n\nCONTEÚDO COLADO:\n"""\n${text}\n"""\n\nJSON:`);
      const raw = result.response.text().trim();

      let parsed: any = null;
      try { parsed = JSON.parse(raw); } catch { /* */ }
      if (!parsed) { try { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch { /* */ } }
      const listRaw = Array.isArray(parsed) ? parsed : (parsed?.candidatos || parsed?.candidates || []);
      const ignored = (parsed?.colunasIgnoradas || parsed?.ignored || []).filter((x: any) => typeof x === 'string').slice(0, 20);

      // VALIDADOR DEFENSIVO: o Gemini às vezes desloca colunas (mapeia posição
      // em vez de semântica). Sintomas vistos em prod: cargo virou número (era
      // valor), regiao virou "F"/"E" (era cargo), estado virou nome de cidade
      // (era cidade). Aqui detectamos e desfazemos o swap ANTES de devolver o
      // preview, pra IA não gravar lixo no banco.
      const fixSwappedFields = (r: any): any => {
        const out = { ...r };
        // 1. Se cargo é puramente numérico, é um VALOR mal-rotulado — descarta
        // (o partido não controla valores; cargo é texto).
        if (typeof out.cargo === 'string' && /^\d+([.,]\d+)?$/.test(out.cargo.trim())) {
          out.cargo = '';
        }
        // 2. Se cargo está vazio mas regiao tem código de cargo (F/E/Vereador…),
        // mova regiao → cargo.
        const cargoCodes = /^(f|e|fed|est|vereador|vereadora|prefeito|prefeita|senador|senadora|presidente)$/i;
        if (!out.cargo && typeof out.regiao === 'string' && cargoCodes.test(out.regiao.trim())) {
          out.cargo = out.regiao.trim();
          out.regiao = '';
        }
        // 3. Se estado NÃO é sigla de 2 letras E regiao está vazio, estado é
        // provavelmente uma cidade que veio no lugar errado → estado → regiao.
        if (out.estado && typeof out.estado === 'string') {
          const e = out.estado.trim();
          const isUF = /^[A-Za-z]{2}$/.test(e);
          if (!isUF && !out.regiao) {
            out.regiao = e;
            out.estado = '';
          } else if (!isUF && out.regiao && out.regiao !== e) {
            // estado tem nome longo mas regiao já está preenchida com algo diferente —
            // descarta estado (provavelmente lixo) em vez de sobrescrever regiao.
            out.estado = '';
          }
        }
        return out;
      };
      // Normaliza todas as linhas (sem filtrar duplicatas ainda).
      const allRows = (Array.isArray(listRaw) ? listRaw : []).map(fixSwappedFields).map((r: any) => {
        return {
          displayName: String(r?.displayName || r?.nome || '').trim().slice(0, 160),
          cargo: (normalizeCargo(r?.cargo) || String(r?.cargo || '').trim()).slice(0, 80),
          regiao: String(r?.regiao || r?.cidade || '').trim().slice(0, 80),
          estado: normalizeUF(r?.estado || r?.uf) || '',
          phone: String(r?.phone || r?.telefone || '').replace(/\D/g, '').slice(0, 20),
          email: (() => { const e = String(r?.email || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e.slice(0, 160) : ''; })(),
        };
      }).filter((r: any) => r.displayName && !isHeaderName(r.displayName)).slice(0, 5000);

      // Detecção de grupos de duplicatas — NÃO corta, NÃO mescla. O usuário decide.
      // Quatro casos, do mais forte pro mais fraco. Cada linha entra em no máximo
      // 1 grupo (cai no mais forte que aplica).
      type Row = typeof allRows[number];
      const inGroup = new Set<number>();
      const groups: { reason: 'identical' | 'name_city_state_phone' | 'name_city' | 'phone_diff_name'; indexes: number[] }[] = [];

      // Pass 1: linhas 100% idênticas (todos os 7 campos iguais)
      const byIdentical = new Map<string, number[]>();
      allRows.forEach((r: Row, i: number) => {
        const k = [normName(r.displayName), normName(r.cargo), normName(r.regiao), r.estado, normPhone(r.phone)].join('|');
        if (!byIdentical.has(k)) byIdentical.set(k, []);
        byIdentical.get(k)!.push(i);
      });
      for (const list of byIdentical.values()) {
        if (list.length > 1) {
          groups.push({ reason: 'identical', indexes: list });
          list.forEach((i) => inGroup.add(i));
        }
      }

      // REGRA ELEITORAL: ninguém pode concorrer a DOIS cargos ao mesmo tempo.
      // Logo, se duas linhas têm o MESMO nome + cidade mas cargos diferentes
      // (ex.: Janaína F vs Janaína E em Araruama), elas são HOMÔNIMOS — pessoas
      // diferentes — e NÃO devem ser flagadas como duplicata. A IA só flagueia
      // quando os cargos batem (ou estão vazios = desconhecido, podem coincidir).
      const cargosCompativeis = (idxs: number[]): boolean => {
        const distinct = new Set(idxs.map((i) => allRows[i].cargo).filter((c: string) => c));
        return distinct.size <= 1;
      };

      // Pass 2: nome+cidade+estado+telefone iguais (telefone obrigatório, 8+ dígitos)
      const byNCSP = new Map<string, number[]>();
      allRows.forEach((r: Row, i: number) => {
        if (inGroup.has(i)) return;
        const pk = normPhone(r.phone);
        if (pk.length < 8) return;
        const k = [normName(r.displayName), normName(r.regiao), r.estado, pk].join('|');
        if (!byNCSP.has(k)) byNCSP.set(k, []);
        byNCSP.get(k)!.push(i);
      });
      for (const list of byNCSP.values()) {
        if (list.length > 1 && cargosCompativeis(list)) {
          groups.push({ reason: 'name_city_state_phone', indexes: list });
          list.forEach((i) => inGroup.add(i));
        }
      }

      // Pass 3: nome+cidade iguais (caso da Janaína). Só flagueia se cargos
      // batem — cargos diferentes = pessoas diferentes (não pode concorrer a 2).
      const byNC = new Map<string, number[]>();
      allRows.forEach((r: Row, i: number) => {
        if (inGroup.has(i)) return;
        const k = normName(r.displayName) + '|' + normName(r.regiao);
        if (!byNC.has(k)) byNC.set(k, []);
        byNC.get(k)!.push(i);
      });
      for (const list of byNC.values()) {
        if (list.length > 1 && cargosCompativeis(list)) {
          groups.push({ reason: 'name_city', indexes: list });
          list.forEach((i) => inGroup.add(i));
        }
      }

      // Pass 4: mesmo telefone, nomes diferentes (apelido vs nome completo OU
      // telefone de família/compartilhado)
      const byPhone = new Map<string, number[]>();
      allRows.forEach((r: Row, i: number) => {
        if (inGroup.has(i)) return;
        const pk = normPhone(r.phone);
        if (pk.length < 8) return;
        if (!byPhone.has(pk)) byPhone.set(pk, []);
        byPhone.get(pk)!.push(i);
      });
      for (const list of byPhone.values()) {
        if (list.length > 1) {
          const distinctNames = new Set(list.map((i: number) => normName(allRows[i].displayName)));
          if (distinctNames.size > 1) {
            groups.push({ reason: 'phone_diff_name', indexes: list });
            list.forEach((i: number) => inGroup.add(i));
          }
        }
      }

      supabase.from('party_ai_command_logs').insert({
        partyId: party.id, userId, inputType: 'import_parse',
        userCommand: isFile ? `import IA: arquivo ${mimeType}` : `import IA: ${text.length} chars`, detectedIntent: 'import_parse',
        actionStatus: allRows.length ? 'preview' : 'vazio',
      }).then(() => {}, () => {});

      return res.json({ candidates: allRows, ignored, duplicateGroups: groups, total: allRows.length });
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
    if (error) return dbFail(res, error);
    return res.json({ candidate: data });
  });

  // Excluir um candidato. Remove os dados do partido; se já tinha conta (ativo),
  // remove também o usuário/campanha (limpeza completa).
  router.delete('/candidates/:id', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const party = await candidateOfPresident(userId, req.params.id);
    if (!party) return res.status(404).json({ error: 'not_found' });
    const { data: cand } = await supabase.from('party_candidates').select('userId, campaignId, displayName').eq('id', req.params.id).maybeSingle();
    const id = req.params.id;
    await supabase.from('party_checkins').delete().eq('candidateId', id);
    await supabase.from('party_committees').delete().eq('candidateId', id);
    const { error } = await supabase.from('party_candidates').delete().eq('id', id);
    if (error) return dbFail(res, error);
    // candidato ativo: limpa conta + campanha
    const uid = (cand as any)?.userId; const cid = (cand as any)?.campaignId;
    if (uid) { try { await (supabase as any).auth.admin.deleteUser(uid); } catch { /* */ } }
    if (cid) { await supabase.from('campaigns').delete().eq('id', cid).then(() => {}, () => {}); }
    // A2: delete destrutivo (apaga conta+campanha do candidato) tem que deixar
    // trilha — espelha o que o emergency-wipe já faz. Best-effort, não bloqueia.
    await supabase.from('party_wipe_audit').insert({
      partyId: (party as any).id, executedBy: userId,
      deletedSummary: { candidateId: id, displayName: (cand as any)?.displayName ?? null, hadAccount: !!uid },
      scope: 'candidate_delete', status: 'success',
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || (req as any).ip || null,
      userAgent: (req.headers['user-agent'] as string)?.slice(0, 300) || null,
    }).then(() => {}, () => {});
    return res.json({ ok: true });
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
    // Assina as fotos (PATH no banco → URL temporária).
    const comPhotos: string[] = Array.isArray((committee as any)?.photos) && (committee as any).photos.length
      ? (committee as any).photos : ((committee as any)?.photo ? [(committee as any).photo] : []);
    const committeeSigned = committee ? {
      ...committee,
      photo: await signPhoto((committee as any).photo),
      photos: (await Promise.all(comPhotos.map((p) => signPhoto(p)))).filter(Boolean),
    } : null;
    const checkinsSigned = await Promise.all((checkins || []).map(async (c: any) => ({ ...c, photo: await signPhoto(c.photo) })));
    return res.json({ committee: committeeSigned, checkins: checkinsSigned });
  });

  /**
   * IA-Auditoria de ESTRUTURA do Partido (#57). O partido NÃO movimenta mais
   * dinheiro aqui — esta análise cruza ESTRUTURA (comitê) + ATIVIDADE (check-ins)
   * + EQUIPE (coordenador/líderes) + score de TODOS os candidatos pra detectar:
   *   • candidato sem comitê montado (recebeu o acesso mas não estruturou)
   *   • inatividade: sem check-in há muito tempo (ou nunca)
   *   • equipe vazia: sem coordenador/líderes
   * Saída: lista de alertas priorizada (alta/média/baixa) com justificativa
   * e ação sugerida ao presidente (cobrar, acompanhar, ok).
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
      .select('id, displayName, cargo, regiao, status, "campaignId"')
      .eq('partyId', (party as any).id);
    if (error) return dbFail(res, error);
    if (!candidates || candidates.length === 0) {
      return res.json({ party: party.name, alerts: [], note: 'Sem candidatos pra analisar.' });
    }

    // Sinais reais de ESTRUTURA (comitê) e ATIVIDADE (check-ins).
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

    // EQUIPE registrada (coordenador + líderes) por campanha — convites contam
    // mesmo pendentes (estrutura declarada). Sem nenhum valor financeiro.
    const campaignIds = candidates.map((c: any) => c.campaignId).filter(Boolean);
    const teamByCamp: Record<string, { coord: number; lider: number }> = {};
    if (campaignIds.length) {
      const { data: invs } = await supabase.from('party_member_invites')
        .select('"campaignId", role').in('campaignId', campaignIds).in('role', ['Coordenador', 'Líder']);
      for (const m of invs || []) {
        const k = (m as any).campaignId;
        teamByCamp[k] = teamByCamp[k] || { coord: 0, lider: 0 };
        if ((m as any).role === 'Coordenador') teamByCamp[k].coord++; else teamByCamp[k].lider++;
      }
    }

    const now = Date.now();
    const enriched = candidates.map((c: any) => {
      const com = committees[c.id];
      const tm = (c.campaignId && teamByCamp[c.campaignId]) || { coord: 0, lider: 0 };
      const score = computeScore({
        status: c.status || 'pending',
        committee: com ? { hasPhoto: !!com.photo, geoSource: com.geoSource } : null,
        checkinCount: checkinCount[c.id] || 0, lastCheckinAt: lastCheckinAt[c.id] || null,
        coordCount: tm.coord, leaderCount: tm.lider,
      }, now);
      const lastCk = lastCheckinAt[c.id];
      const diasSemCheckin = lastCk ? Math.floor((now - new Date(lastCk).getTime()) / 86400000) : null;
      return {
        ...c, score: score.score, scoreLevel: score.level, scoreReasons: score.reasons,
        temComite: !!(com && com.lat), comiteFoto: !!(com && com.photo),
        checkins: checkinCount[c.id] || 0, diasSemCheckin,
        coord: tm.coord, lider: tm.lider,
      };
    });

    const linhas = enriched.map((c, i) =>
      `${i+1}. ${c.displayName} | cargo=${c.cargo || '?'} | regiao=${c.regiao || '?'} | comite=${c.temComite ? (c.comiteFoto ? 'sim+foto' : 'sim') : 'NÃO'} | checkins=${c.checkins}${c.diasSemCheckin != null ? ` (último há ${c.diasSemCheckin}d)` : ' (nunca)'} | equipe=coord:${c.coord}/lider:${c.lider} | score=${c.score} (${c.scoreLevel}) | status=${c.status}`
    ).join('\n');

    const system = `Você é o Auditor de Estrutura do Partido. O partido NÃO movimenta dinheiro — você avalia ESTRUTURA DE CAMPO e ATIVIDADE. Analise a lista de candidatos e detecte quem está deixando a desejar:
- "sem_estrutura": candidato com cadastro concluído (status=active) mas comite=NÃO — recebeu o acesso e não montou o comitê.
- "inatividade": muitos dias sem check-in (ou nunca) — estrutura parada.
- "sem_equipe": sem coordenador (coord:0) e/ou poucos líderes — campo desmobilizado.

NÃO acuse sem evidência — cite os NÚMEROS (comitê, check-ins, dias, coord/lider, score). Sinais fortes:
- status=active E comite=NÃO → sem_estrutura.
- checkins=0 ou último há >30d → inatividade.
- coord:0 E lider:0 → sem_equipe.

Retorne JSON estrito (sem markdown):
{"alerts":[{"candidateId":"uuid","priority":"alta|media|baixa","pattern":"sem_estrutura|inatividade|sem_equipe|ok","justification":"≤200 chars com NÚMEROS","suggested_action":"cobrar|acompanhar|ok + frase ≤120 chars"}]}

Inclua TODOS os candidatos (mesmo "ok"). Ordem decrescente por priority.`;

    try {
      const ai = await callAgent(supabase, 'crm', `Audite a estrutura destes ${enriched.length} candidatos do partido "${party.name}":\n\n${linhas}`, {
        campaignId: 'party:' + party.id, // namespace pra agent_runs
        systemInstruction: system, complexity: 'balanced', maxTokens: 2000,
      });
      let cleaned = ai.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
      const parsed = JSON.parse(cleaned);
      const llmAlerts = Array.isArray(parsed?.alerts) ? parsed.alerts : [];
      return res.json({
        party: party.name,
        analyzedAt: new Date().toISOString(),
        candidatesAnalyzed: enriched.length,
        alerts: llmAlerts,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || 'ai_failed' });
    }
  });

  /**
   * Digest Semanal IA (#85). Sumário curto pro presidente com destaques
   * da semana de ESTRUTURA e ATIVIDADE (o partido não movimenta dinheiro):
   * comitês montados, check-ins, saúde (score), quem está parado. Output JSON
   * estruturado pra cards no painel.
   *
   * Snapshot atual + comparativo com o digest anterior (RAG). Funciona bem
   * porque o presidente gera ~1× por semana e vê o que mudou na estrutura.
   */
  router.post('/digest-weekly', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { data: party } = await supabase.from('parties').select('id, name').eq('presidentId', userId).maybeSingle();
    if (!party) return res.status(403).json({ error: 'not_president' });

    try {
      const { data: candidates, error } = await supabase
        .from('party_candidates')
        .select('id, displayName, cargo, regiao, status, "campaignId"')
        .eq('partyId', (party as any).id);
      if (error) throw error;
      if (!candidates || candidates.length === 0) {
        return res.json({ party: party.name, summary: 'Ainda sem candidatos pra resumir.', highlights: [], actions: [] });
      }

      const now = Date.now();
      const sevenDaysAgo = now - 7 * 86400000;

      // Sinais de estrutura (comitê) e atividade (check-ins).
      const candIds = candidates.map((c: any) => c.id);
      const committees: Record<string, any> = {};
      const checkinCount: Record<string, number> = {};
      const lastCheckinAt: Record<string, string> = {};
      let checkinsSemana = 0;
      if (candIds.length) {
        const { data: coms } = await supabase.from('party_committees').select('candidateId, photo, lat, "geoSource"').in('candidateId', candIds);
        for (const cm of coms || []) committees[(cm as any).candidateId] = cm;
        const { data: cks } = await supabase.from('party_checkins').select('candidateId, "createdAt"').in('candidateId', candIds);
        for (const ck of cks || []) {
          const k = (ck as any).candidateId;
          checkinCount[k] = (checkinCount[k] || 0) + 1;
          const at = (ck as any).createdAt;
          if (at && (!lastCheckinAt[k] || at > lastCheckinAt[k])) lastCheckinAt[k] = at;
          if (at && new Date(at).getTime() > sevenDaysAgo) checkinsSemana++;
        }
      }

      // Equipe registrada (coord/líderes) por campanha — convites contam.
      const campaignIds = candidates.map((c: any) => c.campaignId).filter(Boolean);
      const teamByCamp: Record<string, { coord: number; lider: number }> = {};
      if (campaignIds.length) {
        const { data: invs } = await supabase.from('party_member_invites')
          .select('"campaignId", role').in('campaignId', campaignIds).in('role', ['Coordenador', 'Líder']);
        for (const m of invs || []) {
          const k = (m as any).campaignId;
          teamByCamp[k] = teamByCamp[k] || { coord: 0, lider: 0 };
          if ((m as any).role === 'Coordenador') teamByCamp[k].coord++; else teamByCamp[k].lider++;
        }
      }

      // Snapshot rule-based de cada candidato (estrutura + atividade)
      const snap = candidates.map((c: any) => {
        const com = committees[c.id];
        const tm = (c.campaignId && teamByCamp[c.campaignId]) || { coord: 0, lider: 0 };
        const score = computeScore({
          status: c.status || 'pending',
          committee: com ? { hasPhoto: !!com.photo, geoSource: com.geoSource } : null,
          checkinCount: checkinCount[c.id] || 0, lastCheckinAt: lastCheckinAt[c.id] || null,
          coordCount: tm.coord, leaderCount: tm.lider,
        }, now);
        const lastCk = lastCheckinAt[c.id];
        const diasSemCheckin = lastCk ? Math.floor((now - new Date(lastCk).getTime()) / 86400000) : null;
        return {
          id: c.id, nome: c.displayName, cargo: c.cargo, regiao: c.regiao,
          status: c.status, score: score.score, level: score.level,
          temComite: !!(com && com.lat), checkins: checkinCount[c.id] || 0, diasSemCheckin,
          coord: tm.coord, lider: tm.lider,
        };
      });

      // Estatísticas pra contexto da IA (não joga snapshot bruto)
      const greens = snap.filter((c) => c.level === 'green').length;
      const reds = snap.filter((c) => c.level === 'red').length;
      const comComite = snap.filter((c) => c.temComite).length;
      const semComite = snap.filter((c) => c.status === 'active' && !c.temComite).length;
      const inativos = snap.filter((c) => c.diasSemCheckin == null || (c.diasSemCheckin ?? 0) > 30).length;

      const linhas = snap.map((c, i) =>
        `${i+1}. ${c.nome} (${c.cargo || '?'} | ${c.regiao || '?'}) | score=${c.score}/${c.level} | comite=${c.temComite ? 'sim' : 'NÃO'} | checkins=${c.checkins}${c.diasSemCheckin != null ? ` (último há ${c.diasSemCheckin}d)` : ' (nunca)'} | equipe=coord:${c.coord}/lider:${c.lider}`
      ).join('\n');

      const system = `Você é o Estrategista do Partido. Faça um DIGEST SEMANAL CURTO pro presidente sobre ESTRUTURA DE CAMPO e ATIVIDADE (o partido NÃO movimenta dinheiro — nunca cite valores em R$).

CONTEXTO DA SEMANA:
- ${snap.length} candidatos · ${greens} 🟢 · ${reds} 🔴 · ${comComite} com comitê · ${semComite} sem comitê (já ativos) · ${inativos} parados · ${checkinsSemana} check-ins nos últimos 7 dias

REGRAS:
- summary: 2-3 frases. Tom executivo, direto. Diga o que mudou na estrutura e o que importa.
- highlights: 3-6 cards de destaque (positivo OU negativo). Verbo no início, ≤140 chars. Tipos:
  * 'subiu': candidato que avançou (montou comitê, voltou a fazer check-in, score subiu)
  * 'caiu': candidato com problema (score vermelho, parou de fazer check-in)
  * 'risco': sem estrutura (ativo sem comitê, sem equipe, sumido)
  * 'destaque': marco superado, campo forte, etc.
- actions: 2-4 ações concretas pro presidente FAZER essa semana. Verbo + objeto, ≤140 chars.

Saída JSON estrito (sem markdown):
{"summary":"...","highlights":[{"type":"subiu|caiu|risco|destaque","candidateId":"uuid","title":"≤80","body":"≤140"}],"actions":["..."]}`;

      // Busca o digest anterior no RAG pra IA poder COMPARAR (subiu/caiu desde
      // a última semana) em vez de gerar do zero. Namespace 'party:<id>'.
      const partyNs = 'party:' + (party as any).id;
      const memoria = await retrieveContext(supabase, partyNs, 'digest semanal anterior estrutura highlights');

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
        stats: { total: snap.length, greens, reds, comComite, semComite, inativos, checkinsSemana },
        summary: typeof parsed?.summary === 'string' ? parsed.summary.slice(0, 500) : '',
        highlights: Array.isArray(parsed?.highlights) ? parsed.highlights.slice(0, 6) : [],
        actions: Array.isArray(parsed?.actions) ? parsed.actions.slice(0, 4) : [],
      };

      // Persiste no RAG pra próxima execução comparar. Fire-and-forget.
      const digestText = `Digest ${result.analyzedAt}\n${result.summary}\n` +
        `Stats: ${result.stats.greens} verdes, ${result.stats.reds} vermelhos, ${result.stats.comComite} com comitê, ${result.stats.semComite} sem comitê, ${result.stats.inativos} parados.\n` +
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
    // Equipe REAL (usuários já cadastrados) — usada no SCORE (saúde de verdade).
    const t = { coord: 0, lider: 0 };
    // Equipe REGISTRADA pelo candidato (inclui convites ainda pendentes) — usada
    // nas METAS: assim que o candidato cadastra o coordenador/líder, a meta marca,
    // mesmo antes da pessoa concluir o próprio cadastro.
    const reg = { coord: 0, lider: 0 };
    if (cand.campaignId) {
      const { data: members } = await supabase.from('users').select('type').eq('campaignId', cand.campaignId).in('type', ['Coordenador', 'Líder']);
      for (const m of members || []) { if ((m as any).type === 'Coordenador') t.coord++; else t.lider++; }
      const { data: invs } = await supabase.from('party_member_invites').select('role').eq('campaignId', cand.campaignId).in('role', ['Coordenador', 'Líder']);
      for (const r of invs || []) { if ((r as any).role === 'Coordenador') reg.coord++; else reg.lider++; }
    }
    // Meta conta o que foi registrado OU já é usuário (o maior) — evita zerar a
    // meta quando o convite ainda está pendente.
    const metaCoord = Math.max(t.coord, reg.coord);
    const metaLider = Math.max(t.lider, reg.lider);
    const com = committee as any;
    const metas = [
      { label: 'Concluir seu cadastro', done: cand.status === 'active' },
      { label: 'Cadastrar o comitê (foto + GPS)', done: !!(com && com.photo && com.lat) },
      { label: 'Cadastrar 1 coordenador', done: metaCoord >= 1 },
      { label: 'Cadastrar 5 líderes', done: metaLider >= 5 },
    ];
    const score = computeScore({
      status: cand.status,
      committee: com ? { hasPhoto: !!com.photo, geoSource: com.geoSource } : null,
      checkinCount: (checkins || []).length,
      lastCheckinAt: (checkins || [])[0]?.createdAt || null,
      coordCount: metaCoord, leaderCount: metaLider,
    });
    const cPhotos: string[] = Array.isArray((committee as any)?.photos) && (committee as any).photos.length
      ? (committee as any).photos : ((committee as any)?.photo ? [(committee as any).photo] : []);
    const committeeSigned = committee ? {
      ...committee,
      photo: await signPhoto((committee as any).photo),
      photos: (await Promise.all(cPhotos.map((p) => signPhoto(p)))).filter(Boolean),
    } : null;
    const photoUrl = await signPhoto((cand as any).metadata?.photoPath);
    return res.json({ candidate: { ...cand, photoUrl }, partyName: (party as any)?.name, committee: committeeSigned, checkins: checkins || [], metas, score });
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
    if (error) return dbFail(res, error);
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
    if (error) return dbFail(res, error);
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
    if (error) return dbFail(res, error);
    broadcastTelao(cand.partyId);
    return res.json({ checkin: data });
  });

  // ── CONVITE DE EQUIPE EM CADEIA (#149) ─────────────────────────────────
  // Cada nível convida o(s) papel(éis) abaixo, sempre na MESMA campanha do
  // candidato, via link/WhatsApp com nome+telefone já preenchidos — o convidado
  // só cria email+senha. Sem limite de pessoas.
  //   Candidato → Coordenador e Líder · Coordenador → Líder · Líder → Apoiador
  const ALLOWED_ROLES: Record<string, string[]> = {
    'Candidato de Partido': ['Coordenador', 'Líder'],
    'Coordenador': ['Líder'],
    'Líder': ['Apoiador'],
    'Lider': ['Apoiador'],
  };

  router.post('/member-invites', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const userType = (req as any).user?.userType;
    const campaignId = (req as any).user?.campaignId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const allowed = ALLOWED_ROLES[userType];
    if (!allowed || !allowed.length || !campaignId) {
      return res.status(403).json({ error: 'nao_pode_convidar', detail: 'Seu perfil não pode convidar membros de equipe aqui.' });
    }
    const { displayName, phone, bairro, role: roleReq } = req.body || {};
    // Papel pedido precisa estar entre os permitidos pra quem convida; senão, o 1º.
    const role = allowed.includes(roleReq) ? roleReq : allowed[0];
    const nome = String(displayName || '').trim().slice(0, 160);
    if (!nome) return res.status(400).json({ error: 'nome_obrigatorio' });
    const tel = String(phone || '').replace(/\D/g, '').slice(0, 20) || null;
    // Contexto do candidato (mesma campanha) — pra exibir nome do candidato/partido.
    const { data: cand } = await supabase.from('party_candidates')
      .select('id, "partyId"').eq('campaignId', campaignId).maybeSingle();
    const token = newToken();
    const { data, error } = await supabase.from('party_member_invites').insert({
      token, campaignId, partyId: (cand as any)?.partyId ?? null, candidateId: (cand as any)?.id ?? null,
      invitedBy: userId, displayName: nome, phone: tel, role, status: 'pending',
      bairro: bairro ? String(bairro).trim().slice(0, 120) : null,
    }).select('token, "displayName", phone, role, status, bairro, "createdAt"').single();
    if (error) return dbFail(res, error);
    return res.json({ invite: data, role });
  });

  // Candidato edita os dados de um membro que ele convidou.
  router.patch('/member-invites/:token', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { data: inv } = await supabase.from('party_member_invites')
      .select('id').eq('token', req.params.token).eq('invitedBy', userId).maybeSingle();
    if (!inv) return res.status(404).json({ error: 'not_found' });
    const { displayName, phone, bairro } = req.body || {};
    const patch: any = { updatedAt: new Date().toISOString() };
    if (displayName !== undefined) patch.displayName = String(displayName).trim().slice(0, 160);
    if (phone !== undefined) patch.phone = String(phone).replace(/\D/g, '').slice(0, 20) || null;
    if (bairro !== undefined) patch.bairro = bairro ? String(bairro).trim().slice(0, 120) : null;
    const { error } = await supabase.from('party_member_invites').update(patch).eq('id', (inv as any).id);
    if (error) return dbFail(res, error);
    return res.json({ ok: true });
  });

  router.get('/member-invites', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const userType = (req as any).user?.userType;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { data } = await supabase.from('party_member_invites')
      .select('token, "displayName", phone, role, status, bairro, "createdAt"')
      .eq('invitedBy', userId).order('createdAt', { ascending: false });
    const allowed = ALLOWED_ROLES[userType] || [];
    return res.json({ invites: data || [], canInvite: allowed.length > 0, allowedRoles: allowed });
  });

  // Candidato/membro exclui um registro de equipe que ele criou.
  router.delete('/member-invites/:token', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { data: inv } = await supabase.from('party_member_invites')
      .select('id, "userId"').eq('token', req.params.token).eq('invitedBy', userId).maybeSingle();
    if (!inv) return res.status(404).json({ error: 'not_found' });
    // Se o membro já se cadastrou (virou usuário), NÃO apaga a conta dele — só
    // remove o vínculo/registro de equipe. A conta é gerida pelo Supreme Admin.
    const { error } = await supabase.from('party_member_invites').delete().eq('id', (inv as any).id);
    if (error) return dbFail(res, error);
    return res.json({ ok: true });
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

    const [committeesQ, checkinsQ] = await Promise.all([
      supabase.from('party_committees').select('*').in('candidateId', inIds),
      supabase.from('party_checkins').select('*').in('candidateId', inIds),
    ]);

    const payload = {
      schema: 'campanhapro.party-backup',
      version: 2,
      exportedAt: new Date().toISOString(),
      party: { id: party.id, name: party.name },
      counts: {
        candidatos: (candidates || []).length,
        comites: (committeesQ.data || []).length,
        checkins: (checkinsQ.data || []).length,
      },
      data: {
        candidatos: candidates || [],
        comites: committeesQ.data || [],
        checkins: checkinsQ.data || [],
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
    // A1: whitelist de colunas por tabela. O backup é arquivo do cliente — sem
    // isso o spread (`...c`) deixava forjar colunas (createdBy, userId, timestamps).
    // Aqui só passam colunas conhecidas; partyId e createdBy são sempre forçados.
    const pick = (obj: any, keys: string[]) => {
      const out: any = {};
      for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
      return out;
    };
    const now = new Date().toISOString();
    const restored = { candidatos: 0, comites: 0, checkins: 0 };

    try {
      // Candidatos — remapeia pro partido atual, restaura como pendente (sem conta).
      const candidatos = cap(d.candidatos).map((c: any) => ({
        ...pick(c, ['id', 'displayName', 'cargo', 'regiao', 'estado', 'phone',
          'metadata', 'createdAt']),
        partyId: party.id, status: 'pending', userId: null, campaignId: null,
        inviteToken: newToken(), updatedAt: now,
      }));
      if (candidatos.length) {
        const { data } = await supabase.from('party_candidates').upsert(candidatos, { onConflict: 'id', ignoreDuplicates: true }).select('id');
        restored.candidatos = (data || []).length;
      }
      const comites = cap(d.comites).map((c: any) => ({
        ...pick(c, ['id', 'candidateId', 'address', 'lat', 'lng', 'photo', 'photos', 'geoSource', 'createdAt', 'updatedAt']),
        partyId: party.id,
      }));
      if (comites.length) {
        const { data } = await supabase.from('party_committees').upsert(comites, { onConflict: 'id', ignoreDuplicates: true }).select('id');
        restored.comites = (data || []).length;
      }
      const checkins = cap(d.checkins).map((c: any) => ({
        ...pick(c, ['id', 'candidateId', 'userId', 'tipo', 'lat', 'lng', 'photo', 'nota', 'createdAt']),
        partyId: party.id,
      }));
      if (checkins.length) {
        const { data } = await supabase.from('party_checkins').upsert(checkins, { onConflict: 'id', ignoreDuplicates: true }).select('id');
        restored.checkins = (data || []).length;
      }
      return res.json({ ok: true, restored });
    } catch (err: any) {
      console.error('[party] restore:', err);
      return res.status(500).json({ error: 'restore_failed', message: err?.message || 'Falha ao restaurar.' });
    }
  });

  // ── ORB CONVERSACIONAL (#142) — IA consultiva (só LEITURA) ──
  // Histórico de mensagens da IA — carrega as últimas N pro chat não zerar no refresh.
  router.get('/ai/messages', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const userType = (req as any).user?.userType;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (userType !== 'Presidente de Partido' && !(req as any).user?.isSupremeAdmin) {
      return res.status(403).json({ error: 'apenas_presidente' });
    }
    const party = await partyOf(userId);
    if (!party) return res.status(404).json({ error: 'partido_nao_encontrado' });
    const { data } = await supabase.from('party_ai_messages')
      .select('role, text, intent, "createdAt"')
      .eq('partyId', party.id)
      .order('createdAt', { ascending: true })
      .limit(100);
    return res.json({ messages: data || [] });
  });

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
      // Nome do presidente pra personalizar o atendimento (chama pelo nome).
      const { data: presidente } = await supabase.from('users')
        .select('name').eq('id', userId).maybeSingle();
      const nomePresidente = String((presidente as any)?.name || '').trim();
      const primeiroNome = nomePresidente.split(/\s+/)[0] || '';

      // 1. Snapshot determinístico do partido (escopado por partyId). SEM dinheiro:
      // o partido não movimenta valores — o foco é estrutura de campo.
      const { data: cands } = await supabase.from('party_candidates')
        .select('id, displayName, cargo, regiao, estado, status')
        .eq('partyId', party.id).order('displayName', { ascending: true });
      const candidates = cands || [];
      const cadastrados = candidates.filter((c: any) => c.status === 'active').length;
      const pendentes = candidates.filter((c: any) => c.status === 'pending').length;

      // Sinais de ESTRUTURA: comitê montado + nº de check-ins por candidato.
      const candIds = candidates.map((c: any) => c.id);
      const temComite: Record<string, boolean> = {};
      const checkinsByCand: Record<string, number> = {};
      if (candIds.length) {
        const { data: coms } = await supabase.from('party_committees').select('candidateId, lat').in('candidateId', candIds);
        for (const cm of coms || []) if ((cm as any).lat) temComite[(cm as any).candidateId] = true;
        const { data: cks } = await supabase.from('party_checkins').select('candidateId').in('candidateId', candIds);
        for (const ck of cks || []) {
          const id = (ck as any).candidateId;
          if (id) checkinsByCand[id] = (checkinsByCand[id] || 0) + 1;
        }
      }
      const comComite = Object.keys(temComite).length;

      const statusLabel = (s: string) => s === 'active' ? 'cadastro concluído' : s === 'pending' ? 'cadastro pendente' : (s || '—');
      const local = (c: any) => [c.regiao, c.estado].filter(Boolean).join('/') || 's/local';
      const snapshot = [
        `PARTIDO: ${party.name}`,
        `Candidatos: ${candidates.length} (${cadastrados} com cadastro concluído, ${pendentes} com cadastro pendente)`,
        `Estrutura: ${comComite} com comitê montado`,
        ``,
        `LEGENDA DE STATUS: "active" = cadastro concluído (já criou acesso/senha); "pending" = cadastro pendente (ainda não concluiu — o convite foi enviado mas ele não criou o acesso).`,
        ``,
        `CANDIDATOS (nome | cargo | cidade/UF | status | comitê | check-ins):`,
        ...candidates.slice(0, 120).map((c: any) =>
          `- ${c.displayName} | ${c.cargo || 's/cargo'} | ${local(c)} | ${statusLabel(c.status)} | comitê: ${temComite[c.id] ? 'sim' : 'NÃO'} | ${checkinsByCand[c.id] || 0} check-in(s)`),
      ].join('\n');

      // 1b. Carrega o histórico recente de conversas pra dar contexto ao Gemini
      const { data: recentMsgs } = await supabase.from('party_ai_messages')
        .select('role, text').eq('partyId', party.id)
        .order('createdAt', { ascending: false }).limit(20);
      const historyLines = (recentMsgs || []).reverse().map((m: any) =>
        `${m.role === 'user' ? 'PRESIDENTE' : 'ASSISTENTE'}: ${String(m.text).slice(0, 400)}`);

      // 2. Gemini interpreta — retorna JSON estruturado (consulta OU ação de candidato)
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        return res.json({ intent: 'consulta', message: `A IA está temporariamente indisponível. ${candidates.length} candidatos cadastrados (${comComite} com comitê).`, draft: null });
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
      const prompt = `Você é o assistente do Centro de Comando do partido, falando com o PRESIDENTE${primeiroNome ? ` (nome: ${primeiroNome})` : ''}.

VOCÊ EXECUTA AÇÕES — não é só consulta. Você consegue, COM CONFIRMAÇÃO do presidente: cadastrar e excluir candidato. NUNCA diga que "não consegue cadastrar" ou "use os botões" para essas tarefas — você FAZ. IMPORTANTE: este partido NÃO movimenta dinheiro — não existe repasse, valor, prestação de contas nem relatório financeiro. Se o presidente pedir qualquer coisa de dinheiro (lançar/repassar valor, repasse, prestação de contas, relatório de repasses), use intent="acao_nao_suportada" e explique gentilmente que o módulo do partido não controla valores — o foco é estrutura de campo (comitês, equipe, check-ins).

${primeiroNome ? `PERSONALIZAÇÃO: chame o presidente pelo primeiro nome ("${primeiroNome}") de forma natural — na saudação e em confirmações. Não repita o nome em toda frase; soe humano, não robótico.\n` : ''}
Responda SEMPRE em JSON válido (nada fora do JSON):
{
  "intent": "consulta" | "criar_candidato" | "excluir_candidato" | "ajuda" | "acao_nao_suportada",
  "message": "texto curto pro presidente",
  "draft": null OU { "candidateName": "nome citado", "cargo": "cargo se citado", "regiao": "cidade se citada", "estado": "UF se citada", "phone": "telefone se citado" }
}

REGRAS:
- "consulta": o presidente pergunta/pede pra ORGANIZAR, LISTAR, FILTRAR ou ORDENAR dados. Responda em "message" usando APENAS o snapshot abaixo (nunca invente nome/cidade/dado). draft = null.
- "criar_candidato": CRIAR/CADASTRAR/ADICIONAR um novo CANDIDATO/pessoa (ex: "cadastra a candidata Ana Maria Braga, vereadora, Niterói RJ"). Extraia candidateName (obrigatório) e, se citados, cargo, regiao (cidade), estado (UF), phone. Se não vier nome, use "consulta" e peça o nome.
  O campo "cargo" DEVE ser exatamente um destes: "Presidente", "Senador", "Deputado Federal", "Deputado Estadual", "Prefeito", "Vereador". Mapeie variações pro valor da lista (ex: "vereadora"→"Vereador", "prefeita"→"Prefeito", "deputada estadual"→"Deputado Estadual"). Se o cargo citado não for nenhum desses, deixe cargo vazio.
- "excluir_candidato": EXCLUIR/APAGAR/REMOVER um CANDIDATO inteiro (a pessoa). Extraia candidateName.
- "ajuda": o usuário pergunta COMO fazer algo, o que você faz, pede ajuda/instruções, ou está claramente perdido (ex: "como cadastro um candidato?", "o que você consegue fazer?", "me ajuda"). draft = null. (O texto de ajuda é montado pelo sistema.)
- "acao_nao_suportada": para escritas que você não faz (mexer em metas, comitê, check-in) E para QUALQUER pedido envolvendo dinheiro/repasse/valor (o partido não controla valores). NÃO use para cadastrar/excluir candidato — esses você FAZ. message explica gentilmente. NUNCA finja que fez.

COACHING (seja uma GUIA, não só executora):
- Sempre que faltar um dado, o comando estiver ambíguo, ou você não encontrar o candidato, NÃO responda seco — ENSINE com um EXEMPLO de comando pronto pro usuário copiar. Ex: 'Não achei "Maria". Pra cadastrar, tente: "cadastra a Maria Silva, vereadora, Niterói RJ, 21999990000".'
- Quando o usuário parecer não saber usar, ofereça o jeito certo de falar o comando.
- "criar usuário/candidato/pessoa" = criar_candidato.
- Compliance: se perguntarem se é IA, message = "Sim, sou o assistente automatizado do seu Centro de Comando."
- Este partido NÃO movimenta dinheiro — NUNCA cite valores em R$. Tom direto, chat.

SOBRE IMPORTAR CANDIDATOS EM LOTE (oriente quando o usuário perguntar como importar / colar lista / planilha / "tenho uma lista"):
- Há 3 formas de fornecer os dados: (1) "Colar simples" — uma linha por candidato: Nome, Cargo, Cidade, UF, Telefone, E-mail; (2) "Organizar com IA" — cola a planilha do jeito que estiver (qualquer ordem de colunas, colunas extras) que a IA acha e limpa os campos; (3) Arquivo — arrastar CSV, Excel, PDF ou uma FOTO da lista.
- NÃO PRECISA ROTULAR/IDENTIFICAR AS COLUNAS: a IA lê e identifica cada dado pelo CONTEÚDO, mesmo SEM cabeçalho — e-mail tem "@", telefone = sequência de dígitos, UF = 2 letras, cargo = F/E/Vereador, e o resto é o nome. Colunas de valor/dinheiro e de data são IGNORADAS (o partido não controla valores). Se tiver cabeçalho, ela usa também; mas não é obrigatório.
- CAMPOS QUE NÃO PODEM FALTAR: o NOME é obrigatório (linha sem nome é descartada); CIDADE+UF posicionam no mapa/telão; TELEFONE permite o convite por WhatsApp. Cargo e E-MAIL são opcionais (a IA captura o e-mail se houver; CPF/RG são descartados por privacidade).
- SEMPRE chame atenção pros campos obrigatórios pra evitar erro de importação, e lembre que aparece uma PRÉVIA editável antes de salvar (nada é gravado sem conferência). Se o usuário pedir, mostre um exemplo de linha pronto: "João Silva, Vereador, Niterói, RJ, 21999990000, joao@gmail.com".

COMO RESPONDER CONSULTAS DE LISTA/ORDENAÇÃO (importante):
- Quando pedirem uma lista (ex: "todos os candidatos com cadastro pendente em ordem alfabética decrescente"), INCLUA TODOS os itens que batem com o filtro — não resuma "há 1 candidato", liste de fato cada um.
- Respeite a ordem pedida (alfabética, crescente/decrescente, por valor, etc). Se pedirem "decrescente e alfabética", ordene de Z→A.
- Use uma linha por item, com hífen ou número. Ex: "1. Carlos Dias — Vereador, São Gonçalo/RJ".
- "cadastro pendente"/"não concluiu o cadastro" = status "pending". "cadastrado"/"concluído" = status "active".
- Se nenhum candidato bate o filtro, diga isso claramente.
- NUNCA mostre nomes de coluna crus do banco (ex: "status 'pending'") — traduza pro presidente ("cadastro ainda pendente").

SNAPSHOT ATUAL DO PARTIDO (hoje: ${hojeIso}):
${snapshot}
${historyLines.length ? `\nCONVERSA RECENTE (contexto — use pra entender referências como "ele", "o mesmo", "aquele candidato"):\n${historyLines.join('\n')}\n` : ''}
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

      const intent = ['consulta', 'criar_candidato', 'excluir_candidato', 'ajuda', 'acao_nao_suportada'].includes(parsed.intent) ? parsed.intent : 'consulta';
      let message = String(parsed.message || '').slice(0, 2000);
      let draft: any = null;

      // Ajuda: texto fixo (sempre preciso) ensinando os comandos com exemplos.
      if (intent === 'ajuda') {
        message = [
          'Posso te ajudar com estas tarefas — é só falar naturalmente (por texto ou voz):',
          '',
          '📊 *Consultar*: "lista os candidatos pendentes em ordem alfabética", "quem ainda não montou comitê?", "quantos candidatos por cidade?"',
          '➕ *Cadastrar candidato*: "cadastra o João Silva, vereador, Niterói RJ, 21999990000" (preciso de nome, cidade e UF; telefone é pro convite)',
          '📥 *Importar candidatos em lote*: você tem 3 formas —',
          '   1) *Colar simples*: uma linha por candidato, vírgula separando: Nome, Cargo, Cidade, UF, Telefone, E-mail',
          '   2) *Organizar com IA*: cola a planilha do jeito que estiver (qualquer ordem, com ou sem cabeçalho) que eu acho e limpo os campos',
          '   3) *Arquivo*: arraste CSV, Excel, PDF ou até uma FOTO da lista — eu leio e organizo',
          '   💡 Não precisa rotular as colunas: eu identifico cada dado pelo conteúdo (e-mail tem @, telefone = dígitos, UF = 2 letras) mesmo sem cabeçalho. Colunas de valor/dinheiro são ignoradas.',
          '   ⚠️ O *Nome* é obrigatório (linha sem nome é descartada). *Cidade+UF* posicionam no mapa e o *Telefone* permite o convite por WhatsApp. Cargo e e-mail são opcionais. Sempre mostro uma prévia pra você conferir antes de salvar.',
          '👤 *Excluir candidato*: "exclui o candidato João Silva"',
          '',
          'Este módulo do partido NÃO controla dinheiro — foco em estrutura de campo (comitês, equipe, check-ins).',
          'Antes de salvar qualquer coisa eu sempre mostro um resumo e peço sua confirmação.',
        ].join('\n');
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
          message = `⚠️ Vou EXCLUIR o candidato ${cand.displayName} e TODOS os dados dele (comitê, check-ins). Não pode ser desfeito. Confirma?`;
        }
      }

      const finalIntent = intent;

      await supabase.from('party_ai_command_logs').insert({
        partyId: party.id, userId, inputType: (req.body || {}).inputType || 'text',
        userCommand: text.slice(0, 500), detectedIntent: finalIntent, actionStatus: draft ? 'draft' : 'ok',
      }).then(() => {}, () => {});

      // Persiste mensagens (user + assistant) pra histórico sobreviver refresh
      const now = new Date().toISOString();
      await supabase.from('party_ai_messages').insert([
        { partyId: party.id, userId, role: 'user', text: text.slice(0, 2000), intent: null, createdAt: now },
        { partyId: party.id, userId, role: 'assistant', text: message.slice(0, 2000), intent: finalIntent, createdAt: new Date(Date.now() + 1).toISOString() },
      ]).then(() => {}, () => {});

      return res.json({ intent: finalIntent, message, draft });
    } catch (err: any) {
      console.error('[party] ai/command:', err);
      return res.status(500).json({ error: err?.message || 'ai_failed', message: 'Não consegui processar agora. Tente reformular.' });
    }
  });

  // ── BOTÃO DE EMERGÊNCIA (#141) — zera dados OPERACIONAIS do partido ────
  //
  // Apaga candidatos, comitês e check-ins + fotos do storage. NÃO apaga: a
  // conta `parties`, o usuário presidente, plano/assinatura.
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

    // M2: reautenticação agora é checada no servidor (antes era 100% no cliente).
    // O frontend manda o access_token recém-emitido pela reconfirmação de senha.
    // Obs.: a trilha de step-up por passkey (flag VITE_PASSKEY_STEP_UP, hoje OFF)
    // não emite esse token; quando for ligada, validar a asserção via /passkeys.
    const reauthToken = String((req.body || {}).reauthToken || '');
    if (!(await verifyFreshReauth(reauthToken, userId))) {
      return res.status(401).json({ error: 'reauth_necessaria', detail: 'Reautenticação expirada ou inválida. Confirme a senha novamente.' });
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
      summary.committees = await delCount('party_committees', 'partyId', party.id);
      summary.checkins = await delCount('party_checkins', 'partyId', party.id);
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
