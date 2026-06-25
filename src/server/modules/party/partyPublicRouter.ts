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
      .select('id, displayName, regiao, estado, status, campaignId, metadata').eq('partyId', partyId);
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
      // Equipe REGISTRADA pelo candidato (convites, inclusive pendentes) também
      // conta — consistente com a conferência do presidente. Pega o maior.
      const { data: invs } = await supabase.from('party_member_invites')
        .select('"campaignId", role').in('campaignId', campIds).in('role', ['Coordenador', 'Líder']);
      const reg: Record<string, { coord: number; lider: number }> = {};
      for (const r of invs || []) {
        const k = (r as any).campaignId; reg[k] = reg[k] || { coord: 0, lider: 0 };
        if ((r as any).role === 'Coordenador') reg[k].coord++; else reg[k].lider++;
      }
      for (const k of Object.keys(reg)) {
        team[k] = team[k] || { coord: 0, lider: 0 };
        team[k].coord = Math.max(team[k].coord, reg[k].coord);
        team[k].lider = Math.max(team[k].lider, reg[k].lider);
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
      // Aguarda geocodificações pendentes por até 3s — o que ficar pronto neste
      // poll vai pro cityCoords e aparece no mapa JÁ. Antes era fire-and-forget e
      // o usuário precisava de outro poll pra ver candidatos sem comitê. Throttle
      // do Nominatim é 1.1s/req, então ~2 cidades cabem nessa janela; o restante
      // entra no próximo poll com cache já populado.
      const aQuecer = [...new Set(semComite.map((c: any) => cityQueryOf(c)!))].filter((q) => !cachedKeys.has(geoKey(q)));
      if (aQuecer.length) {
        await Promise.race([
          new Promise<void>((r) => setTimeout(r, 3000)),
          Promise.allSettled(aQuecer.map(async (q) => {
            const coord = await geocode(q);
            if (coord) cityCoords[geoKey(q)] = coord;
          })),
        ]);
      }
    }

    // Assina a foto de CAPA do comitê (TTL 1h) pra exibir no popup do telão.
    // Só a capa — o telão é público; não expõe a galeria inteira.
    const photoUrls: Record<string, string> = {};
    await Promise.all(Object.entries(committees).map(async ([cid, cm]: any) => {
      const stored = (cm as any)?.photo;
      if (!stored || typeof stored !== 'string') return;
      if (stored.startsWith('data:')) { photoUrls[cid] = stored; return; } // legado inline
      const { data } = await supabase.storage.from('party-proofs').createSignedUrl(stored, 3600);
      if (data?.signedUrl) photoUrls[cid] = data.signedUrl;
    }));

    // Retrato do candidato (metadata.photoPath) — assina p/ exibir no pino/popup.
    const candPhotoUrls: Record<string, string> = {};
    await Promise.all(candidates.map(async (c: any) => {
      const stored = c?.metadata?.photoPath;
      if (!stored || typeof stored !== 'string') return;
      const { data } = await supabase.storage.from('party-proofs').createSignedUrl(stored, 3600);
      if (data?.signedUrl) candPhotoUrls[c.id] = data.signedUrl;
    }));

    let green = 0, yellow = 0, red = 0;
    const points = candidates.map((c: any) => {
      const com = committees[c.id];
      const t = (c.campaignId && team[c.campaignId]) || { coord: 0, lider: 0 };
      const sc = computeScore({
        status: c.status,
        committee: com ? { hasPhoto: !!com.photo, geoSource: com.geoSource } : null,
        checkinCount: checkinCount[c.id] || 0, lastCheckinAt: lastCheckinAt[c.id] || null,
        coordCount: t.coord, leaderCount: t.lider,
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
        lat, lng, hasPhoto: !!com?.photo, photoUrl: photoUrls[c.id] || null,
        candidatePhotoUrl: candPhotoUrls[c.id] || null,
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
      .select('id, displayName, cargo, regiao, phone, email, status, partyId').eq('inviteToken', req.params.token).maybeSingle();
    if (!cand) return res.status(404).json({ error: 'invite_invalido' });
    const { data: party } = await supabase.from('parties').select('name').eq('id', (cand as any).partyId).maybeSingle();
    return res.json({
      partyName: (party as any)?.name || 'Partido',
      candidate: { displayName: (cand as any).displayName, cargo: (cand as any).cargo, regiao: (cand as any).regiao, phone: (cand as any).phone || null, email: (cand as any).email || null },
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

  // ── CONVITE DE EQUIPE EM CADEIA (#149) — PÚBLICO ───────────────────────
  // O membro convidado (Coordenador/Líder/Apoiador) abre o link, vê nome+papel
  // travados e só cria email+senha. Entra na MESMA campanha do candidato.
  router.get('/member-invite/:token', async (req: Request, res: Response) => {
    const { data: inv } = await supabase.from('party_member_invites')
      .select('"displayName", phone, role, status, "campaignId"').eq('token', req.params.token).maybeSingle();
    if (!inv) return res.status(404).json({ error: 'invite_invalido' });
    const { data: camp } = await supabase.from('campaigns').select('name, "candidateName"').eq('id', (inv as any).campaignId).maybeSingle();
    return res.json({
      displayName: (inv as any).displayName,
      phone: (inv as any).phone || null,
      role: (inv as any).role,
      candidateName: (camp as any)?.candidateName || (camp as any)?.name || null,
      alreadyRegistered: (inv as any).status === 'active',
    });
  });

  router.post('/member-invite/:token/register', async (req: Request, res: Response) => {
    const { email, password, phone } = req.body || {};
    if (!email?.trim() || !password || String(password).length < 6) {
      return res.status(400).json({ error: 'email_e_senha_min_6_obrigatorios' });
    }
    const { data: inv } = await supabase.from('party_member_invites')
      .select('*').eq('token', req.params.token).maybeSingle();
    if (!inv) return res.status(404).json({ error: 'invite_invalido' });
    if ((inv as any).status === 'active' && (inv as any).userId) {
      return res.status(409).json({ error: 'ja_cadastrado' });
    }
    const mail = String(email).trim().toLowerCase();
    // 1) cria a identidade de auth (email pré-confirmado)
    const { data: created, error: authErr } = await (supabase as any).auth.admin.createUser({
      email: mail, password: String(password), email_confirm: true,
    });
    if (authErr || !created?.user?.id) {
      return res.status(400).json({ error: 'falha_criar_usuario', detail: authErr?.message });
    }
    const uid = created.user.id;
    // 2) perfil vinculado à MESMA campanha do candidato, com o papel do convite
    const { error: uErr } = await supabase.from('users').insert({
      id: uid, name: (inv as any).displayName, email: mail, type: (inv as any).role,
      campaignId: (inv as any).campaignId, isSupremeAdmin: false,
      phone: phone?.trim() || (inv as any).phone || null,
    });
    if (uErr) {
      await (supabase as any).auth.admin.deleteUser(uid).catch(() => {}); // rollback best-effort
      return res.status(500).json({ error: 'falha_perfil', detail: uErr.message });
    }
    // 3) marca o convite como usado
    await supabase.from('party_member_invites').update({
      status: 'active', userId: uid, updatedAt: new Date().toISOString(),
    }).eq('id', (inv as any).id);

    return res.json({ ok: true });
  });

  return router;
}
