/**
 * Team invitations.
 *
 *   POST   /api/v1/team/invites              (Admin) create invite + send email
 *   GET    /api/v1/team/invites              (Admin) list invites for the campaign
 *   DELETE /api/v1/team/invites/:id          (Admin) revoke a pending invite
 *   GET    /api/v1/team/invites/token/:token (public) verify a token; safe payload only
 *   POST   /api/v1/team/invites/token/:token/accept (auth) attach current user to the
 *                                                    campaign with the invited role
 *
 * Public token lookup must NEVER leak campaign-wide data — we only return the
 * inviter name, role label, and campaign name; nothing else.
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { USER_ROLES, type UserRole } from '../../../types/roles';
import { audit, actorFromRequest } from '../observability/auditLogger';
import { sendTeamInviteEmail } from '../email/emailService';

const INVITE_TTL_DAYS = 7;
/** Roles an Admin is allowed to invite. Excludes 'Admin', 'Coordenador',
 *  'Suporte', 'Manutenção', 'blocked' — promoting to those needs Supreme Admin. */
const INVITABLE_ROLES: UserRole[] = ['Líder', 'Apoiador', 'Colaborador', 'Pesquisador', 'Fiscal', 'Candidato'];

function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Token returned to the public endpoint — minimal payload, no campaign ids. */
function publicInviteView(row: any) {
  return {
    campaignName: row._campaignName ?? null,
    role: row.role,
    invitedByName: row.invitedByName,
    expiresAt: row.expiresAt,
    status: row.status,
  };
}

export function createTeamInvitesRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // ------ Authenticated routes (campaign Admin) ------

  // POST /invites — Admin only
  router.post('/invites', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    const userId = (req as any).user?.id;
    const userType = (req as any).user?.userType;
    if (!campaignId || !userId) return res.status(401).json({ error: 'Unauthorized' });
    if (userType !== 'Admin' && userType !== 'Coordenador') {
      return res.status(403).json({ error: 'admin_required' });
    }

    const { email, role } = req.body as { email: string; role: UserRole };
    if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email_required' });
    if (!INVITABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: 'role_not_invitable', allowed: INVITABLE_ROLES });
    }

    // Normalize email
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'invalid_email' });
    }

    // Reject if a user with that email is already a member of this campaign
    const { data: existingMember } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .eq('campaignId', campaignId)
      .maybeSingle();
    if (existingMember) {
      return res.status(409).json({ error: 'already_a_member' });
    }

    // Lookup inviter name + campaign name for the email
    const [{ data: inviter }, { data: campaign }] = await Promise.all([
      supabase.from('users').select('name').eq('id', userId).maybeSingle(),
      supabase.from('campaigns').select('name').eq('id', campaignId).maybeSingle(),
    ]);

    const token = generateToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const inviterName = inviter?.name ?? 'Admin da campanha';
    const campaignName = campaign?.name ?? 'Campanha';

    const { data: created, error } = await supabase
      .from('team_invites')
      .insert({
        campaignId: campaignId,
        email: normalizedEmail,
        role,
        token,
        status: 'pending',
        invitedBy: userId,
        invitedByName: inviterName,
        expiresAt: expiresAt,
      })
      .select('id, email, role, "expiresAt", status, "createdAt"')
      .single();

    if (error) {
      // Unique-index collision = duplicate pending invite
      if (String(error.message).includes('uq_team_invites_pending')) {
        return res.status(409).json({ error: 'invite_already_pending' });
      }
      return res.status(500).json({ error: error.message });
    }

    // Build invite URL (frontend route)
    const inviteUrl = `${process.env.APP_URL ?? 'http://localhost:3000'}/invite/${token}`;

    // Send invite email (fire-and-forget — never block the response on SMTP)
    sendTeamInviteEmail(supabase, {
      campaignId,
      email: normalizedEmail,
      inviterName,
      campaignName,
      role,
      inviteUrl,
      inviteId: created.id,
    }).catch(err => console.warn('[team] invite email failed:', err.message));

    await audit(supabase, {
      ...actorFromRequest(req),
      action: 'team.invite.create',
      resourceType: 'team_invite',
      resourceId: created.id,
      severity: 'info',
      metadata: { email: normalizedEmail, role },
    });

    return res.status(201).json({ invite: created });
  });

  // GET /invites — list invites for the current campaign (any team member can see them)
  router.get('/invites', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('team_invites')
      .select('id, email, role, status, "expiresAt", "acceptedAt", "invitedByName", "createdAt"')
      .eq('campaignId', campaignId)
      .order('createdAt', { ascending: false })
      .limit(200);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ invites: data ?? [] });
  });

  // DELETE /invites/:id — revoke a pending invite (Admin only)
  router.delete('/invites/:id', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    const userType = (req as any).user?.userType;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    if (userType !== 'Admin' && userType !== 'Coordenador') {
      return res.status(403).json({ error: 'admin_required' });
    }

    const { data: updated, error } = await supabase
      .from('team_invites')
      .update({ status: 'revoked', updatedAt: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('campaignId', campaignId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!updated) return res.status(404).json({ error: 'invite_not_found_or_not_pending' });

    await audit(supabase, {
      ...actorFromRequest(req),
      action: 'team.invite.revoke',
      resourceType: 'team_invite',
      resourceId: req.params.id,
      severity: 'info',
    });

    res.json({ ok: true });
  });

  // POST /members — cria a IDENTIDADE DE LOGIN de um membro (Supabase Auth + users).
  // O TeamManager grava os dados operacionais em team_members; sem esta conta o
  // membro não consegue logar. Admin/Coordenador apenas. Usa service-role.
  router.post('/members', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    const userType = (req as any).user?.userType;
    const requesterId = (req as any).user?.id;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const isLeader = userType === 'Líder';
    if (userType !== 'Admin' && userType !== 'Coordenador' && !isLeader) {
      return res.status(403).json({ error: 'admin_required' });
    }

    const { name, email, password, role } = req.body as {
      name?: string; email?: string; password?: string; role?: UserRole;
    };
    const nm = (name ?? '').trim();
    const normalizedEmail = (email ?? '').trim().toLowerCase();
    if (!nm) return res.status(400).json({ error: 'name_required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return res.status(400).json({ error: 'invalid_email' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'password_min_6' });
    if (!INVITABLE_ROLES.includes(role as UserRole)) {
      return res.status(400).json({ error: 'role_not_invitable', allowed: INVITABLE_ROLES });
    }
    // Um Líder só pode recrutar funções subordinadas (não cria Líder/Candidato/Admin).
    const LEADER_RECRUITABLE: UserRole[] = ['Apoiador', 'Colaborador', 'Pesquisador', 'Fiscal'];
    if (isLeader && !LEADER_RECRUITABLE.includes(role as UserRole)) {
      return res.status(403).json({ error: 'leader_role_limited', allowed: LEADER_RECRUITABLE });
    }

    // Já existe usuário com esse e-mail?
    const { data: existing } = await supabase
      .from('users').select('id, "campaignId"').eq('email', normalizedEmail).maybeSingle();
    if (existing?.campaignId && existing.campaignId !== campaignId) {
      return res.status(409).json({ error: 'email_in_another_campaign' });
    }

    // Vínculo de liderança: se quem cadastra é Líder, o membro fica sob ele.
    // (Admin pode passar assignedLeaderId no corpo para atribuir a um líder.)
    const leaderLink: string | null = isLeader ? requesterId : ((req.body?.assignedLeaderId as string) || null);

    // REAPROVEITA: e-mail já é usuário desta campanha (ex.: cadastro anterior que
    // não completou) → reseta a senha + atualiza papel/nome, em vez de barrar.
    if (existing && existing.campaignId === campaignId) {
      await supabase.auth.admin.updateUserById(existing.id, {
        password,
        user_metadata: { name: nm },
      }).catch((e) => console.warn('[team] updateUser pwd falhou:', e?.message));
      await supabase.from('users').update({ name: nm, type: role, role: 'active', assignedLeaderId: leaderLink }).eq('id', existing.id);
      await supabase.from('tenant_memberships').upsert({
        tenantId: campaignId, tenantKind: 'campaign', userId: existing.id, role, source: 'team_invite',
      }, { onConflict: 'tenantId,userId' }).then(() => {}, () => {});
      await audit(supabase, {
        ...actorFromRequest(req),
        action: 'team.member.reactivate',
        resourceType: 'user',
        resourceId: existing.id,
        severity: 'info',
        metadata: { email: normalizedEmail, role },
      }).catch(() => {});
      return res.status(200).json({ ok: true, userId: existing.id, reused: true });
    }

    // 1. Identidade no Supabase Auth (e-mail já confirmado → login direto).
    const { data: created, error: authErr } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { name: nm },
    });
    if (authErr || !created?.user) {
      // Conta existe no Auth mas sem linha em users (órfã) → tenta localizar e reaproveitar.
      const dup = String(authErr?.message ?? '').toLowerCase().includes('already') ||
                  String(authErr?.message ?? '').toLowerCase().includes('registered');
      if (dup) {
        try {
          const { data: list } = await supabase.auth.admin.listUsers();
          const found = list?.users?.find((u: any) => (u.email ?? '').toLowerCase() === normalizedEmail);
          if (found) {
            await supabase.auth.admin.updateUserById(found.id, { password, user_metadata: { name: nm } }).catch(() => {});
            await supabase.from('users').upsert({
              id: found.id, name: nm, email: normalizedEmail, type: role,
              plan: 'Básico', role: 'active', campaignId, isSupremeAdmin: false,
              assignedLeaderId: leaderLink,
            }, { onConflict: 'id' });
            await supabase.from('tenant_memberships').upsert({
              tenantId: campaignId, tenantKind: 'campaign', userId: found.id, role, source: 'team_invite',
            }, { onConflict: 'tenantId,userId' }).then(() => {}, () => {});
            return res.status(200).json({ ok: true, userId: found.id, reused: true });
          }
        } catch (e: any) {
          console.warn('[team] reaproveitar conta órfã falhou:', e?.message);
        }
      }
      return res.status(dup ? 409 : 400).json({
        error: dup ? 'email_already_registered' : 'auth_create_failed',
        detail: authErr?.message,
      });
    }

    // 2. Linha de perfil (login → papel + campanha). Rollback do Auth se falhar.
    const { error: profErr } = await supabase.from('users').insert({
      id: created.user.id,
      name: nm,
      email: normalizedEmail,
      type: role,
      plan: 'Básico',
      role: 'active',
      campaignId,
      isSupremeAdmin: false,
      assignedLeaderId: leaderLink,
    });
    if (profErr) {
      await supabase.auth.admin.deleteUser(created.user.id).catch(() => {});
      return res.status(500).json({ error: 'profile_insert_failed', detail: profErr.message });
    }

    // Control Plane: vincula o novo membro ao tenant (campanha) — não-fatal.
    await supabase.from('tenant_memberships').upsert({
      tenantId: campaignId, tenantKind: 'campaign', userId: created.user.id, role, source: 'team_invite',
    }, { onConflict: 'tenantId,userId' }).then(() => {}, () => {});

    await audit(supabase, {
      ...actorFromRequest(req),
      action: 'team.member.create',
      resourceType: 'user',
      resourceId: created.user.id,
      severity: 'info',
      metadata: { email: normalizedEmail, role },
    }).catch(() => {});

    return res.status(201).json({ ok: true, userId: created.user.id });
  });

  // POST /members/:teamMemberId/invite — gera link de convite para um membro
  // ÓRFÃO da team_members (linha existe mas userId é NULL). Reutiliza a infra
  // de team_invites: cria um token, envia e-mail e devolve a URL pro admin
  // copiar/enviar pelo WhatsApp. A amarração final (team_members.userId) acontece
  // no /accept abaixo, procurando team_members pelo e-mail+campanha.
  router.post('/members/:teamMemberId/invite', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    const userType = (req as any).user?.userType;
    const userId = (req as any).user?.id;
    if (!campaignId || !userId) return res.status(401).json({ error: 'Unauthorized' });
    const isLeader = userType === 'Líder';
    if (userType !== 'Admin' && userType !== 'Coordenador' && !isLeader) {
      return res.status(403).json({ error: 'admin_required' });
    }

    // 1. Lê o team_member
    const { data: member } = await supabase.from('team_members')
      .select('id, name, email, role, "campaignId", "userId", "assignedLeaderId"')
      .eq('id', req.params.teamMemberId).maybeSingle();
    if (!member || (member as any).campaignId !== campaignId) {
      return res.status(404).json({ error: 'member_not_found' });
    }
    if ((member as any).userId) return res.status(409).json({ error: 'already_has_access' });

    const memberEmail = String((member as any).email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(memberEmail)) {
      return res.status(400).json({ error: 'member_email_missing_or_invalid' });
    }
    const role = (member as any).role as UserRole;
    if (!INVITABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: 'role_not_invitable', actual: role, allowed: INVITABLE_ROLES });
    }
    if (isLeader && (member as any).assignedLeaderId !== userId) {
      return res.status(403).json({ error: 'leader_can_only_invite_own_members' });
    }

    // 2. Reusa infra de team_invites
    const [{ data: inviter }, { data: campaign }] = await Promise.all([
      supabase.from('users').select('name').eq('id', userId).maybeSingle(),
      supabase.from('campaigns').select('name').eq('id', campaignId).maybeSingle(),
    ]);
    const token = generateToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const inviterName = inviter?.name ?? 'Admin da campanha';
    const campaignName = campaign?.name ?? 'Campanha';

    const { data: created, error } = await supabase.from('team_invites').insert({
      campaignId, email: memberEmail, role, token, status: 'pending',
      invitedBy: userId, invitedByName: inviterName, expiresAt,
    }).select('id, email, role, "expiresAt", status, "createdAt", token').single();
    if (error) {
      if (String(error.message).includes('uq_team_invites_pending')) {
        // Já existe convite pendente — devolve o token existente pra reusar.
        const { data: existing } = await supabase.from('team_invites')
          .select('id, email, role, "expiresAt", status, "createdAt", token')
          .eq('campaignId', campaignId).eq('email', memberEmail).eq('status', 'pending').maybeSingle();
        if (existing) {
          const url = `${process.env.APP_URL ?? 'http://localhost:3000'}/invite/${(existing as any).token}`;
          return res.status(200).json({ invite: existing, inviteUrl: url, reused: true });
        }
      }
      return res.status(500).json({ error: error.message });
    }
    const inviteUrl = `${process.env.APP_URL ?? 'http://localhost:3000'}/invite/${token}`;

    // 3. E-mail (fire-and-forget)
    sendTeamInviteEmail(supabase, {
      campaignId, email: memberEmail, inviterName, campaignName, role, inviteUrl, inviteId: created.id,
    }).catch((err) => console.warn('[team] grant-access email failed:', err.message));

    await audit(supabase, {
      ...actorFromRequest(req), action: 'team.member.grant_access',
      resourceType: 'team_member', resourceId: (member as any).id, severity: 'info',
      metadata: { email: memberEmail, role, inviteId: created.id },
    }).catch(() => {});

    return res.status(201).json({ invite: created, inviteUrl });
  });

  // Autorização p/ gerenciar um membro-alvo: Admin/Coordenador, ou o Líder dono dele.
  async function authorizeManage(req: Request, targetUserId: string) {
    const campaignId = (req as any).user?.campaignId;
    const userType = (req as any).user?.userType;
    const requesterId = (req as any).user?.id;
    if (!campaignId) return { status: 401 as const, error: 'Unauthorized' };
    const { data: target } = await supabase
      .from('users').select('id, "campaignId", "assignedLeaderId"').eq('id', targetUserId).maybeSingle();
    if (!target || target.campaignId !== campaignId) return { status: 404 as const, error: 'member_not_found' };
    const isAdmin = userType === 'Admin' || userType === 'Coordenador';
    const isOwningLeader = userType === 'Líder' && target.assignedLeaderId === requesterId;
    if (!isAdmin && !isOwningLeader) return { status: 403 as const, error: 'forbidden' };
    return { status: 200 as const, target };
  }

  // POST /members/:userId/reset-password — redefine a senha de um liderado.
  router.post('/members/:userId/reset-password', async (req: Request, res: Response) => {
    const password = (req.body?.password ?? '') as string;
    if (!password || password.length < 6) return res.status(400).json({ error: 'password_min_6' });
    const auth = await authorizeManage(req, req.params.userId);
    if (auth.status !== 200) return res.status(auth.status).json({ error: auth.error });
    const { error } = await supabase.auth.admin.updateUserById(req.params.userId, { password });
    if (error) return res.status(500).json({ error: 'reset_failed', detail: error.message });
    await audit(supabase, {
      ...actorFromRequest(req), action: 'team.member.reset_password',
      resourceType: 'user', resourceId: req.params.userId, severity: 'warn',
    }).catch(() => {});
    return res.json({ ok: true });
  });

  // DELETE /members/:userId — remove o ACESSO do membro (Auth + users).
  // A linha em team_members é removida pelo cliente.
  router.delete('/members/:userId', async (req: Request, res: Response) => {
    const auth = await authorizeManage(req, req.params.userId);
    if (auth.status !== 200) return res.status(auth.status).json({ error: auth.error });
    await supabase.from('users').delete().eq('id', req.params.userId);
    await supabase.auth.admin.deleteUser(req.params.userId).catch(() => {});
    await audit(supabase, {
      ...actorFromRequest(req), action: 'team.member.delete',
      resourceType: 'user', resourceId: req.params.userId, severity: 'warn',
    }).catch(() => {});
    return res.json({ ok: true });
  });

  return router;
}

/**
 * Public router — NO auth required. Mounted separately (server.ts) so requireAuth
 * doesn't apply. Token is the secret.
 */
export function createTeamInvitesPublicRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // GET /invites/token/:token — verify a token and return a public-safe view
  router.get('/invites/token/:token', async (req: Request, res: Response) => {
    const { data: invite } = await supabase
      .from('team_invites')
      .select('id, "campaignId", email, role, status, "expiresAt", "invitedByName"')
      .eq('token', req.params.token)
      .maybeSingle();
    if (!invite) return res.status(404).json({ error: 'invite_not_found' });

    // Expire on read if past expiresAt
    if (invite.status === 'pending' && new Date(invite.expiresAt).getTime() < Date.now()) {
      await supabase.from('team_invites').update({ status: 'expired' }).eq('id', invite.id);
      invite.status = 'expired';
    }

    if (invite.status !== 'pending') {
      return res.status(410).json({ error: `invite_${invite.status}` });
    }

    // Look up campaign name (one extra query — small, public-safe field only)
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('name')
      .eq('id', invite.campaignId)
      .maybeSingle();

    return res.json({
      invite: publicInviteView({ ...invite, _campaignName: campaign?.name }),
    });
  });

  // POST /invites/token/:token/accept — authenticated; attaches the current user
  router.post('/invites/token/:token/accept', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const userEmail = (req as any).user?.email?.toLowerCase();
    if (!userId || !userEmail) return res.status(401).json({ error: 'Unauthorized' });

    const { data: invite } = await supabase
      .from('team_invites')
      .select('id, "campaignId", email, role, status, "expiresAt"')
      .eq('token', req.params.token)
      .maybeSingle();
    if (!invite) return res.status(404).json({ error: 'invite_not_found' });

    if (invite.status !== 'pending') return res.status(410).json({ error: `invite_${invite.status}` });
    if (new Date(invite.expiresAt).getTime() < Date.now()) {
      await supabase.from('team_invites').update({ status: 'expired' }).eq('id', invite.id);
      return res.status(410).json({ error: 'invite_expired' });
    }
    if (invite.email.toLowerCase() !== userEmail) {
      return res.status(403).json({ error: 'email_mismatch' });
    }

    // Verify the user isn't already in another campaign
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, "campaignId"')
      .eq('id', userId)
      .maybeSingle();
    if (existingUser?.campaignId && existingUser.campaignId !== invite.campaignId) {
      return res.status(409).json({ error: 'already_in_another_campaign' });
    }

    // Upsert the user row with the invited campaign + role
    const { error: upsertErr } = await supabase
      .from('users')
      .upsert(
        {
          id: userId,
          email: userEmail,
          name: (req as any).user?.email?.split('@')[0] ?? 'Novo membro',
          type: invite.role,
          plan: 'Básico',
          role: 'active',
          campaignId: invite.campaignId,
          isSupremeAdmin: false,
        },
        { onConflict: 'id' },
      );

    if (upsertErr) return res.status(500).json({ error: upsertErr.message });

    // Mark invite as accepted (CAS-style to prevent double-accept)
    const { data: updated, error: inviteErr } = await supabase
      .from('team_invites')
      .update({
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
        acceptedBy: userId,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', invite.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (inviteErr || !updated) return res.status(409).json({ error: 'invite_already_consumed' });

    // GERAR ACESSO: se este convite foi disparado pra um team_member órfão,
    // amarra agora — o que estava em team_members ganha userId e o membro
    // entra no app já dentro da equipe (não precisa cadastrar de novo).
    await supabase.from('team_members')
      .update({ userId, updatedAt: new Date().toISOString() })
      .eq('campaignId', invite.campaignId)
      .eq('email', invite.email)
      .is('userId', null);

    await audit(supabase, {
      campaignId: invite.campaignId,
      actorId: userId,
      action: 'team.invite.accept',
      resourceType: 'team_invite',
      resourceId: invite.id,
      severity: 'info',
      metadata: { role: invite.role },
    });

    return res.json({ campaignId: invite.campaignId, role: invite.role });
  });

  return router;
}

export { INVITABLE_ROLES, USER_ROLES };
