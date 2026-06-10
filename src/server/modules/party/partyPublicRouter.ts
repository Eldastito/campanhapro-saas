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

export function createPartyPublicRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // Dados do convite — para a página de cadastro mostrar o contexto (nome travado).
  router.get('/invite/:token', async (req: Request, res: Response) => {
    const { data: cand } = await supabase.from('party_candidates')
      .select('id, displayName, cargo, regiao, status, partyId').eq('inviteToken', req.params.token).maybeSingle();
    if (!cand) return res.status(404).json({ error: 'invite_invalido' });
    const { data: party } = await supabase.from('parties').select('name').eq('id', (cand as any).partyId).maybeSingle();
    return res.json({
      partyName: (party as any)?.name || 'Partido',
      candidate: { displayName: (cand as any).displayName, cargo: (cand as any).cargo, regiao: (cand as any).regiao },
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

    const mail = String(email).trim().toLowerCase();
    // 1) cria o usuário de autenticação (service role)
    const { data: created, error: authErr } = await (supabase as any).auth.admin.createUser({
      email: mail, password: String(password), email_confirm: true,
    });
    if (authErr || !created?.user?.id) {
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
      return res.status(500).json({ error: 'falha_campanha', detail: campErr?.message });
    }
    const campaignId = (camp as any).id;

    // 3) perfil na tabela users (tipo Candidato, campanha própria)
    const { error: uErr } = await supabase.from('users').insert({
      id: uid, name: (cand as any).displayName, email: mail, type: 'Candidato',
      campaignId, isSupremeAdmin: false, phone: phone?.trim() || (cand as any).phone || null,
    });
    if (uErr) {
      await (supabase as any).auth.admin.deleteUser(uid).catch(() => {}); // rollback best-effort
      await supabase.from('campaigns').delete().eq('id', campaignId).then(() => {}, () => {});
      return res.status(500).json({ error: 'falha_perfil', detail: uErr.message });
    }

    // 3) ativa o candidato no partido
    await supabase.from('party_candidates').update({
      userId: uid, campaignId, status: 'active', updatedAt: new Date().toISOString(),
    }).eq('id', (cand as any).id);

    return res.json({ ok: true });
  });

  return router;
}
