/**
 * Cadeia de cadastro do PARTIDO — endpoints PÚBLICOS (sem auth).
 * O convidado abre o link com o token, vê quem o convidou (nome travado) e se
 * cadastra. O vínculo à hierarquia é garantido pelo token (não editável).
 *
 *   GET  /api/public/party/invite/:token     dados do convite (partido + candidato)
 *   POST /api/public/party/register/:token    autocadastro do candidato (cria usuário)
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeScore } from './score';
import { geocode } from '../../../lib/geocode';
import { ensureCampaignConfig } from '../../../utils/planUtils';
import { Plan } from '../../../types/user';

// Chave do geo_cache idêntica à de geocode.ts (lower + espaços colapsados).
const geoKey = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');
// Jitter determinístico (~1–2km) p/ candidatos sem comitê na MESMA cidade não
// empilharem exatamente no mesmo ponto. Derivado do id (estável entre cargas).
const jitter = (id: string, salt: number) => {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h % 1000) / 1000 - 0.5) * 0.03; // ±0.015°
};

// A3: janela de validade do convite. Token é single-use (vira 'active' ao
// cadastrar), mas sem isso um link vazado e nunca usado valia pra sempre. Ampla
// por padrão (cobre o pré-eleição); ajustável por env, 0 = sem expiração.
const INVITE_TTL_DAYS = Number(process.env.PARTY_INVITE_TTL_DAYS || 90);

export function createPartyPublicRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // TELÃO público (sem auth, link tokenizado). Mostra ESTRUTURA no mapa — comitês,
  // check-ins e a saúde (cor do score) por candidato. NÃO expõe valores em R$.
  router.get('/telao/:token', async (req: Request, res: Response) => {
    const { data: party } = await supabase.from('parties').select('id, name').eq('telaoToken', req.params.token).maybeSingle();
    if (!party) return res.status(404).json({ error: 'telao_invalido' });
    const partyId = (party as any).id;
    const { data: cands } = await supabase.from('party_candidates')
      .select('id, displayName, regiao, estado, status, campaignId, valorRecebido, valorAlocado').eq('partyId', partyId);
    const candidates = cands || [];
    const ids = candidates.map((c: any) => c.id);
    const campIds = candidates.map((c: any) => c.campaignId).filter(Boolean);

    const committees: Record<string, any> = {};
    const checkinCount: Record<string, number> = {};
    const lastCheckinAt: Record<string, string> = {};
    const checkinPoints: { lat: number; lng: number }[] = [];
    if (ids.length) {
      const { data: coms } = await supabase.from('party_committees').select('candidateId, address, lat, lng, photo, "geoSource"').in('candidateId', ids);
      for (const cm of coms || []) committees[(cm as any).candidateId] = cm;
      const { data: cks } = await supabase.from('party_checkins').select('candidateId, lat, lng, "createdAt"').in('candidateId', ids);
      for (const ck of cks || []) {
        const k = (ck as any).candidateId;
        checkinCount[k] = (checkinCount[k] || 0) + 1;
        const at = (ck as any).createdAt;
        if (at && (!lastCheckinAt[k] || at > lastCheckinAt[k])) lastCheckinAt[k] = at;
        if (typeof (ck as any).lat === 'number') checkinPoints.push({ lat: (ck as any).lat, lng: (ck as any).lng });
      }
    }
    const team: Record<string, { coord: number; lider: number }> = {};
    if (campIds.length) {
      const { data: members } = await supabase.from('users').select('campaignId, type').in('campaignId', campIds).in('type', ['Coordenador', 'Líder']);
      for (const m of members || []) {
        const k = (m as any).campaignId; team[k] = team[k] || { coord: 0, lider: 0 };
        if ((m as any).type === 'Coordenador') team[k].coord++; else team[k].lider++;
      }
    }

    // Posição aproximada por cidade/UF (#147f): candidatos SEM comitê com GPS
    // viram bolinha aproximada na cidade — assim os 🔴 sem comitê aparecem.
    const cityQueryOf = (c: any): string | null => {
      const cidade = String(c.regiao || '').trim();
      if (!cidade) return null;
      const uf = String(c.estado || '').trim();
      return uf ? `${cidade}, ${uf}, Brasil` : `${cidade}, Brasil`;
    };
    const semComite = candidates.filter((c: any) => {
      const com = committees[c.id];
      return !(com && typeof com.lat === 'number') && cityQueryOf(c);
    });
    const cityCoords: Record<string, { lat: number; lng: number }> = {};
    if (semComite.length) {
      const keys = [...new Set(semComite.map((c: any) => geoKey(cityQueryOf(c)!)))];
      const cachedKeys = new Set<string>();
      const { data: cacheRows } = await supabase.from('geo_cache').select('query, lat, lng').in('query', keys);
      for (const row of cacheRows || []) {
        cachedKeys.add((row as any).query);
        if ((row as any).lat != null && (row as any).lng != null) cityCoords[(row as any).query] = { lat: (row as any).lat, lng: (row as any).lng };
      }
      // Aquece o cache em background pras cidades ainda não consultadas (sem travar
      // a resposta nem esperar o throttle do Nominatim) — aparecem no próximo poll.
      const aQuecer = [...new Set(semComite.map((c: any) => cityQueryOf(c)!))].filter((q) => !cachedKeys.has(geoKey(q)));
      for (const q of aQuecer) void geocode(q);
    }

    let green = 0, yellow = 0, red = 0;
    const points = candidates.map((c: any) => {
      const com = committees[c.id];
      const t = (c.campaignId && team[c.campaignId]) || { coord: 0, lider: 0 };
      const sc = computeScore({
        status: c.status,
        committee: com ? { hasPhoto: !!com.photo, geoSource: com.geoSource } : null,
        checkinCount: checkinCount[c.id] || 0, lastCheckinAt: lastCheckinAt[c.id] || null,
        coordCount: t.coord, leaderCount: t.lider,
        valorRecebido: Number(c.valorRecebido) || 0, valorAlocado: Number(c.valorAlocado) || 0,
      });
      if (sc.level === 'green') green++; else if (sc.level === 'yellow') yellow++; else red++;

      // Localização do pino: 1º comitê (GPS/endereço); senão, aproximada pela cidade.
      let lat: number | null = com?.lat ?? null;
      let lng: number | null = com?.lng ?? null;
      let approx = !!com && com.geoSource === 'address';
      let noCommittee = false;
      let local = com?.address || [c.regiao, c.estado].filter(Boolean).join('/') || null;
      if (typeof lat !== 'number') {
        const cc = cityCoords[geoKey(cityQueryOf(c) || '')];
        if (cc) {
          lat = cc.lat + jitter(c.id, 7);
          lng = cc.lng + jitter(c.id, 13);
          approx = true; noCommittee = true;
          local = [c.regiao, c.estado].filter(Boolean).join('/') || local;
        }
      }
      return {
        displayName: c.displayName,
        local, approx, noCommittee,
        lat, lng, hasPhoto: !!com?.photo,
        level: sc.level, checkins: checkinCount[c.id] || 0,
      };
    });

    return res.json({
      partyName: (party as any).name,
      channel: `party-telao-${partyId}`,
      points, checkinPoints,
      stats: {
        candidates: candidates.length,
        committees: Object.keys(committees).length,
        checkins: Object.values(checkinCount).reduce((a, b) => a + b, 0),
        green, yellow, red,
      },
    });
  });

  // Dados do convite — para a página de cadastro mostrar o contexto (nome travado).
  router.get('/invite/:token', async (req: Request, res: Response) => {
    const { data: cand } = await supabase.from('party_candidates')
      .select('id, displayName, cargo, regiao, phone, status, partyId').eq('inviteToken', req.params.token).maybeSingle();
    if (!cand) return res.status(404).json({ error: 'invite_invalido' });
    const { data: party } = await supabase.from('parties').select('name').eq('id', (cand as any).partyId).maybeSingle();
    return res.json({
      partyName: (party as any)?.name || 'Partido',
      candidate: { displayName: (cand as any).displayName, cargo: (cand as any).cargo, regiao: (cand as any).regiao, phone: (cand as any).phone || null },
      alreadyRegistered: (cand as any).status === 'active',
    });
  });

  // Autocadastro do candidato — cria o usuário (auth + users) e ativa o registro.
  router.post('/register/:token', async (req: Request, res: Response) => {
    const { email, password, phone } = req.body || {};
    if (!email?.trim() || !password || String(password).length < 6) {
      return res.status(400).json({ error: 'email_e_senha_min_6_obrigatorios' });
    }
    const { data: cand } = await supabase.from('party_candidates')
      .select('*').eq('inviteToken', req.params.token).maybeSingle();
    if (!cand) return res.status(404).json({ error: 'invite_invalido' });
    if ((cand as any).status === 'active' && (cand as any).userId) {
      return res.status(409).json({ error: 'ja_cadastrado' });
    }

    // A3: expiração do convite (defesa em profundidade).
    const createdMs = new Date((cand as any).createdAt || 0).getTime();
    if (INVITE_TTL_DAYS > 0 && createdMs > 0 && Date.now() - createdMs > INVITE_TTL_DAYS * 86_400_000) {
      return res.status(410).json({ error: 'convite_expirado', detail: 'Este convite expirou. Peça um novo link ao presidente.' });
    }

    // A3: claim atômico — sem isso, dois cliques simultâneos passavam a checagem
    // acima e criavam DOIS usuários + campanhas (um órfão). Só uma requisição
    // consegue mover pending→registering; as demais batem em 409.
    // Aceita reclaim de um 'registering' obsoleto (>5min) — recupera de um
    // cadastro que travou no meio (crash) sem deixar o convite preso pra sempre.
    const staleTs = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: claimed } = await supabase.from('party_candidates')
      .update({ status: 'registering', updatedAt: new Date().toISOString() })
      .eq('id', (cand as any).id)
      .or(`status.eq.pending,and(status.eq.registering,updatedAt.lt.${staleTs})`)
      .select('id').single();
    if (!claimed) {
      return res.status(409).json({ error: 'cadastro_em_andamento', detail: 'Este convite já está sendo usado ou foi concluído.' });
    }
    // Libera o claim se algo falhar no meio — senão o convite fica preso fora de 'pending'.
    const releaseClaim = () => supabase.from('party_candidates')
      .update({ status: 'pending', updatedAt: new Date().toISOString() })
      .eq('id', (cand as any).id).then(() => {}, () => {});

    const mail = String(email).trim().toLowerCase();
    // 1) cria o usuário de autenticação (service role)
    const { data: created, error: authErr } = await (supabase as any).auth.admin.createUser({
      email: mail, password: String(password), email_confirm: true,
    });
    if (authErr || !created?.user?.id) {
      await releaseClaim();
      return res.status(400).json({ error: 'falha_criar_usuario', detail: authErr?.message });
    }
    const uid = created.user.id;

    // 2) cria a CAMPANHA (tenant) do candidato — users.campaignId é FK p/ campaigns.id.
    const { data: party } = await supabase.from('parties').select('name').eq('id', (cand as any).partyId).maybeSingle();
    const { data: camp, error: campErr } = await supabase.from('campaigns').insert({
      name: (cand as any).displayName,
      candidateName: (cand as any).displayName,
      party: (party as any)?.name || null,
      electionRole: (cand as any).cargo || null,
      electionCity: (cand as any).regiao || null,
      createdBy: uid,
    }).select('id').single();
    if (campErr || !camp?.id) {
      await (supabase as any).auth.admin.deleteUser(uid).catch(() => {});
      await releaseClaim();
      return res.status(500).json({ error: 'falha_campanha' });
    }
    const campaignId = (camp as any).id;

    // 3) perfil na tabela users (tipo Candidato, campanha própria)
    const { error: uErr } = await supabase.from('users').insert({
      id: uid, name: (cand as any).displayName, email: mail, type: 'Candidato de Partido',
      campaignId, isSupremeAdmin: false, phone: phone?.trim() || (cand as any).phone || null,
    });
    if (uErr) {
      await (supabase as any).auth.admin.deleteUser(uid).catch(() => {}); // rollback best-effort
      await supabase.from('campaigns').delete().eq('id', campaignId).then(() => {}, () => {});
      await releaseClaim();
      return res.status(500).json({ error: 'falha_perfil' });
    }

    // 3) ativa o candidato no partido
    await supabase.from('party_candidates').update({
      userId: uid, campaignId, status: 'active', updatedAt: new Date().toISOString(),
    }).eq('id', (cand as any).id);

    // 4) provisiona o plano GRÁTIS na campanha — assim que ele entrar na plataforma
    //    (modo cortesia), já encontra CRM, agenda, formulários liberados; IA travada.
    await ensureCampaignConfig(supabase, campaignId, Plan.GRATIS).catch(() => {});

    return res.json({ ok: true });
  });

  return router;
}
