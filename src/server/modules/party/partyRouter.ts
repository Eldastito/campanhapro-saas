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

  // Editar um candidato (nome/cargo/região/telefone).
  router.patch('/candidates/:id', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await candidateOfPresident(userId, req.params.id))) return res.status(404).json({ error: 'not_found' });
    const { displayName, cargo, regiao, phone } = req.body || {};
    const patch: any = { updatedAt: new Date().toISOString() };
    if (typeof displayName === 'string' && displayName.trim()) patch.displayName = displayName.trim().slice(0, 160);
    if (cargo !== undefined) patch.cargo = cargo?.toString().trim() || null;
    if (regiao !== undefined) patch.regiao = regiao?.toString().trim() || null;
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

    // Score rule-based atual de cada um (sem novas chamadas SQL — usa o
    // mesmo computeScore que o painel já mostra).
    const now = Date.now();
    const enriched = candidates.map((c: any) => {
      const score = computeScore({
        status: c.status || 'pending',
        committee: null, // signals de comitê não trafegados aqui — TODO
        checkinCount: 0, lastCheckinAt: null,
        coordCount: 0, leaderCount: 0,
        valorRecebido: Number(c.valorRecebido || 0),
        valorAlocado: Number(c.valorAlocado || 0),
      }, now);
      return { ...c, score: score.score, scoreLevel: score.level, scoreReasons: score.reasons };
    });

    const linhas = enriched.map((c, i) =>
      `${i+1}. ${c.displayName} | cargo=${c.cargo || '?'} | regiao=${c.regiao || '?'} | recebido=R$${Number(c.valorRecebido||0).toFixed(0)} | alocado=R$${Number(c.valorAlocado||0).toFixed(0)} | score=${c.score} (${c.scoreLevel}) | status=${c.status} | valve=${c.repasseStatus||'liberado'}`
    ).join('\n');

    const system = `Você é o Auditor Antifraude do Partido. Analise a lista de candidatos e detecte padrões SUSPEITOS:
- "absorção": recebeu R$ mas score baixo / sem comitê / sem alocação clara
- "disparidade": R$/atividade muito acima dos pares no mesmo cargo
- "inatividade": último sinal há muito tempo apesar de repasses

NÃO acuse sem evidência. Use a regra: se score é vermelho E valorRecebido > 0 E valorAlocado < 30% recebido, é forte sinal.

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

  return router;
}
