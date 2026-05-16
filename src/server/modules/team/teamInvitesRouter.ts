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
const INVITABLE_ROLES: UserRole[] = ['Líder', 'Apoiador', 'Colaborador', 'Pesquisador', 'Candidato'];

function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Token returned to the public endpoint — minimal payload, no campaign ids. */
function publicInviteView(row: any) {
  return {
    campaignName: row._campaignName ?? null,
    role: row.role,
    invitedByName: row.invited_by_name,
    expiresAt: row.expires_at,
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
      .eq('campaign_id', campaignId)
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
        campaign_id: campaignId,
        email: normalizedEmail,
        role,
        token,
        status: 'pending',
        invited_by: userId,
        invited_by_name: inviterName,
        expires_at: expiresAt,
      })
      .select('id, email, role, expires_at, status, created_at')
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
      .select('id, email, role, status, expires_at, accepted_at, invited_by_name, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
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
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('campaign_id', campaignId)
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
      .select('id, campaign_id, email, role, status, expires_at, invited_by_name')
      .eq('token', req.params.token)
      .maybeSingle();
    if (!invite) return res.status(404).json({ error: 'invite_not_found' });

    // Expire on read if past expires_at
    if (invite.status === 'pending' && new Date(invite.expires_at).getTime() < Date.now()) {
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
      .eq('id', invite.campaign_id)
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
      .select('id, campaign_id, email, role, status, expires_at')
      .eq('token', req.params.token)
      .maybeSingle();
    if (!invite) return res.status(404).json({ error: 'invite_not_found' });

    if (invite.status !== 'pending') return res.status(410).json({ error: `invite_${invite.status}` });
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      await supabase.from('team_invites').update({ status: 'expired' }).eq('id', invite.id);
      return res.status(410).json({ error: 'invite_expired' });
    }
    if (invite.email.toLowerCase() !== userEmail) {
      return res.status(403).json({ error: 'email_mismatch' });
    }

    // Verify the user isn't already in another campaign
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, campaign_id')
      .eq('id', userId)
      .maybeSingle();
    if (existingUser?.campaign_id && existingUser.campaign_id !== invite.campaign_id) {
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
          campaign_id: invite.campaign_id,
          is_supreme_admin: false,
        },
        { onConflict: 'id' },
      );

    if (upsertErr) return res.status(500).json({ error: upsertErr.message });

    // Mark invite as accepted (CAS-style to prevent double-accept)
    const { data: updated, error: inviteErr } = await supabase
      .from('team_invites')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        accepted_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invite.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (inviteErr || !updated) return res.status(409).json({ error: 'invite_already_consumed' });

    await audit(supabase, {
      campaignId: invite.campaign_id,
      actorId: userId,
      action: 'team.invite.accept',
      resourceType: 'team_invite',
      resourceId: invite.id,
      severity: 'info',
      metadata: { role: invite.role },
    });

    return res.json({ campaignId: invite.campaign_id, role: invite.role });
  });

  return router;
}

export { INVITABLE_ROLES, USER_ROLES };
