/**
 * CALL CENTER — cadastro público via convite (sem auth).
 * O convidado abre o link, vê o nome travado (quem convidou definiu) e cria
 * e-mail+senha. Entra DIRETO na campanha existente (não cria tenant novo).
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createCallCenterPublicRouter(supabase: SupabaseClient): Router {
  const router = Router();

  router.get('/invite/:token', async (req: Request, res: Response) => {
    const { data: inv } = await supabase.from('cc_invites')
      .select('id, "displayName", role, status, "campaignId"')
      .eq('token', req.params.token).maybeSingle();
    if (!inv || (inv as any).status === 'revoked') return res.status(404).json({ error: 'invite_invalido' });
    const { data: camp } = await supabase.from('campaigns').select('name, "candidateName"')
      .eq('id', (inv as any).campaignId).maybeSingle();
    return res.json({
      displayName: (inv as any).displayName,
      role: (inv as any).role,
      campaignName: (camp as any)?.candidateName || (camp as any)?.name || 'Campanha',
      alreadyUsed: (inv as any).status === 'used',
    });
  });

  router.post('/register/:token', async (req: Request, res: Response) => {
    const { email, password, phone } = req.body || {};
    if (!email?.trim() || !password || String(password).length < 6) {
      return res.status(400).json({ error: 'email_e_senha_min_6_obrigatorios' });
    }
    const { data: inv } = await supabase.from('cc_invites')
      .select('*').eq('token', req.params.token).maybeSingle();
    if (!inv || (inv as any).status !== 'pending') return res.status(404).json({ error: 'invite_invalido_ou_usado' });

    const mail = String(email).trim().toLowerCase();
    const { data: created, error: authErr } = await (supabase as any).auth.admin.createUser({
      email: mail, password: String(password), email_confirm: true,
    });
    if (authErr || !created?.user?.id) {
      return res.status(400).json({ error: 'falha_criar_usuario', detail: authErr?.message });
    }
    const uid = created.user.id;

    // Perfil entra na campanha EXISTENTE do convite (operador é parte do tenant).
    const { error: uErr } = await supabase.from('users').insert({
      id: uid, name: (inv as any).displayName, email: mail, type: (inv as any).role,
      campaignId: (inv as any).campaignId, isSupremeAdmin: false,
      phone: phone?.trim() || (inv as any).phone || null,
    });
    if (uErr) {
      await (supabase as any).auth.admin.deleteUser(uid).catch(() => {});
      return res.status(500).json({ error: 'falha_perfil', detail: uErr.message });
    }

    await supabase.from('cc_invites').update({
      status: 'used', usedBy: uid, usedAt: new Date().toISOString(),
    }).eq('id', (inv as any).id);

    return res.json({ ok: true });
  });

  return router;
}
