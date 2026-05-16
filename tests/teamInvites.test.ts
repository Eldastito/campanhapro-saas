/**
 * Team invitations — auth router (admin-only) + public token router.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';
import {
  createTeamInvitesRouter, createTeamInvitesPublicRouter,
} from '../src/server/modules/team/teamInvitesRouter';

const ADMIN = {
  id: 'admin-uuid', email: 'admin@c1.com',
  campaignId: 'c1', userType: 'Admin', isSupremeAdmin: false,
};
const APOIADOR = { ...ADMIN, id: 'apoiador-uuid', userType: 'Apoiador' };
const INVITEE = {
  id: 'invitee-uuid', email: 'novo@c1.com',
};

function freshSupabase(overrides: Record<string, any[]> = {}) {
  return createMockSupabase({
    users: [
      { id: ADMIN.id, email: 'admin@c1.com', campaign_id: 'c1', type: 'Admin', name: 'Admin João' },
    ],
    campaigns: [{ id: 'c1', name: 'Campanha Teste 2026' }],
    team_invites: [],
    email_log: [],
    audit_logs: [],
    ...overrides,
  });
}

function authedApp(user: any, supabase: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) (req as any).user = user;
    next();
  });
  app.use('/api/v1/team', createTeamInvitesRouter(supabase));
  app.use('/api/v1/team', createTeamInvitesPublicRouter(supabase));
  return app;
}

async function req(app: express.Express, method: string, path: string, body?: any) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method, headers: { 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.status, body: parsed });
      } catch (err) { reject(err); } finally { server.close(); }
    });
  });
}

describe('POST /invites — create', () => {
  test('Apoiador cannot create invites (admin required)', async () => {
    const sb = freshSupabase();
    const res = await req(authedApp(APOIADOR, sb), 'POST', '/api/v1/team/invites', {
      email: 'novo@c1.com', role: 'Líder',
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'admin_required');
  });

  test('unauthenticated → 401', async () => {
    const sb = freshSupabase();
    const res = await req(authedApp(null, sb), 'POST', '/api/v1/team/invites', {
      email: 'a@b.c', role: 'Líder',
    });
    assert.equal(res.status, 401);
  });

  test('rejects invalid email', async () => {
    const sb = freshSupabase();
    const res = await req(authedApp(ADMIN, sb), 'POST', '/api/v1/team/invites', {
      email: 'not-an-email', role: 'Líder',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_email');
  });

  test('rejects non-invitable role (Admin promotion blocked)', async () => {
    const sb = freshSupabase();
    const res = await req(authedApp(ADMIN, sb), 'POST', '/api/v1/team/invites', {
      email: 'a@b.c', role: 'Admin',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'role_not_invitable');
  });

  test('rejects when target email is already a member of this campaign', async () => {
    const sb = freshSupabase({
      users: [
        { id: ADMIN.id, email: 'admin@c1.com', campaign_id: 'c1', type: 'Admin', name: 'Admin' },
        { id: 'u2', email: 'membro@c1.com', campaign_id: 'c1', type: 'Apoiador', name: 'Já é membro' },
      ],
    });
    const res = await req(authedApp(ADMIN, sb), 'POST', '/api/v1/team/invites', {
      email: 'membro@c1.com', role: 'Líder',
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'already_a_member');
  });

  test('Admin creates invite + audit + email log entry', async () => {
    const sb = freshSupabase();
    const res = await req(authedApp(ADMIN, sb), 'POST', '/api/v1/team/invites', {
      email: 'NOVO@c1.com', role: 'Líder',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.invite.email, 'novo@c1.com', 'email is normalised to lowercase');
    assert.equal(res.body.invite.role, 'Líder');

    const invites = (sb as any)._store.get('team_invites');
    assert.equal(invites.length, 1);
    assert.equal(invites[0].status, 'pending');
    assert.equal(invites[0].campaign_id, 'c1');
    assert.ok(invites[0].token);
    assert.ok(invites[0].expires_at);

    const audits = (sb as any)._store.get('audit_logs');
    assert.ok(audits.find((a: any) => a.action === 'team.invite.create'));
  });
});

describe('GET /invites — list', () => {
  test('returns own-campaign invites only', async () => {
    const sb = freshSupabase({
      team_invites: [
        { id: 'i1', campaign_id: 'c1', email: 'a@c1.com', role: 'Líder', status: 'pending',
          token: 't1', expires_at: new Date(Date.now() + 3600000).toISOString(),
          invited_by_name: 'Admin', created_at: new Date().toISOString() },
        { id: 'i2', campaign_id: 'OTHER', email: 'x@other.com', role: 'Líder', status: 'pending',
          token: 't2', expires_at: new Date(Date.now() + 3600000).toISOString(),
          invited_by_name: 'Outro', created_at: new Date().toISOString() },
      ],
    });
    const res = await req(authedApp(ADMIN, sb), 'GET', '/api/v1/team/invites');
    assert.equal(res.status, 200);
    assert.equal(res.body.invites.length, 1);
    assert.equal(res.body.invites[0].id, 'i1');
  });
});

describe('DELETE /invites/:id — revoke', () => {
  test('Admin revokes a pending invite', async () => {
    const sb = freshSupabase({
      team_invites: [
        { id: 'i1', campaign_id: 'c1', email: 'a@c1.com', role: 'Líder', status: 'pending',
          token: 't1', expires_at: new Date(Date.now() + 3600000).toISOString() },
      ],
    });
    const res = await req(authedApp(ADMIN, sb), 'DELETE', '/api/v1/team/invites/i1');
    assert.equal(res.status, 200);
    const stored = (sb as any)._store.get('team_invites')[0];
    assert.equal(stored.status, 'revoked');
  });

  test('cannot revoke invite from another campaign', async () => {
    const sb = freshSupabase({
      team_invites: [
        { id: 'i1', campaign_id: 'OTHER', email: 'a@b.c', role: 'Líder', status: 'pending',
          token: 't1', expires_at: new Date(Date.now() + 3600000).toISOString() },
      ],
    });
    const res = await req(authedApp(ADMIN, sb), 'DELETE', '/api/v1/team/invites/i1');
    assert.equal(res.status, 404);
  });

  test('Apoiador cannot revoke', async () => {
    const sb = freshSupabase({
      team_invites: [{ id: 'i1', campaign_id: 'c1', status: 'pending' }],
    });
    const res = await req(authedApp(APOIADOR, sb), 'DELETE', '/api/v1/team/invites/i1');
    assert.equal(res.status, 403);
  });
});

describe('GET /invites/token/:token — public view', () => {
  test('returns public-safe view (no campaign_id, no token, no email)', async () => {
    const sb = freshSupabase({
      team_invites: [
        { id: 'i1', campaign_id: 'c1', email: 'a@c1.com', role: 'Líder', status: 'pending',
          token: 'abc123', expires_at: new Date(Date.now() + 3600000).toISOString(),
          invited_by_name: 'Admin João' },
      ],
    });
    const res = await req(authedApp(null, sb), 'GET', '/api/v1/team/invites/token/abc123');
    assert.equal(res.status, 200);
    assert.equal(res.body.invite.role, 'Líder');
    assert.equal(res.body.invite.campaignName, 'Campanha Teste 2026');
    assert.equal(res.body.invite.invitedByName, 'Admin João');
    // Must NOT leak internal fields
    assert.equal(res.body.invite.campaign_id, undefined);
    assert.equal(res.body.invite.token, undefined);
    assert.equal(res.body.invite.email, undefined);
  });

  test('expired pending invite returns 410 + flips status to expired', async () => {
    const sb = freshSupabase({
      team_invites: [
        { id: 'i1', campaign_id: 'c1', email: 'a@b.c', role: 'Líder', status: 'pending',
          token: 'abc', expires_at: new Date(Date.now() - 3600000).toISOString() },
      ],
    });
    const res = await req(authedApp(null, sb), 'GET', '/api/v1/team/invites/token/abc');
    assert.equal(res.status, 410);
    const stored = (sb as any)._store.get('team_invites')[0];
    assert.equal(stored.status, 'expired');
  });

  test('unknown token → 404', async () => {
    const sb = freshSupabase();
    const res = await req(authedApp(null, sb), 'GET', '/api/v1/team/invites/token/nonexistent');
    assert.equal(res.status, 404);
  });
});

describe('POST /invites/token/:token/accept', () => {
  function ctxWithInvite(extra: any = {}) {
    return freshSupabase({
      team_invites: [{
        id: 'i1', campaign_id: 'c1', email: 'novo@c1.com', role: 'Líder',
        status: 'pending', token: 'abc',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        invited_by: ADMIN.id, invited_by_name: 'Admin João',
      }],
      ...extra,
    });
  }

  test('rejects when current user email != invite email', async () => {
    const sb = ctxWithInvite();
    const wrong = { id: 'x', email: 'other@nope.com' };
    const res = await req(authedApp(wrong, sb), 'POST', '/api/v1/team/invites/token/abc/accept');
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'email_mismatch');
  });

  test('happy path: attaches user to campaign with invited role + marks invite accepted', async () => {
    const sb = ctxWithInvite();
    const res = await req(authedApp(INVITEE, sb), 'POST', '/api/v1/team/invites/token/abc/accept');
    assert.equal(res.status, 200);
    assert.equal(res.body.campaignId, 'c1');
    assert.equal(res.body.role, 'Líder');

    const users = (sb as any)._store.get('users');
    const member = users.find((u: any) => u.id === INVITEE.id);
    assert.ok(member);
    assert.equal(member.campaign_id, 'c1');
    assert.equal(member.type, 'Líder');

    const invite = (sb as any)._store.get('team_invites')[0];
    assert.equal(invite.status, 'accepted');
    assert.equal(invite.accepted_by, INVITEE.id);
  });

  test('double-accept returns 409 (CAS-style guard)', async () => {
    const sb = ctxWithInvite();
    await req(authedApp(INVITEE, sb), 'POST', '/api/v1/team/invites/token/abc/accept');
    const res = await req(authedApp(INVITEE, sb), 'POST', '/api/v1/team/invites/token/abc/accept');
    assert.equal(res.status, 410);
    assert.equal(res.body.error, 'invite_accepted');
  });

  test('user already in another campaign → 409', async () => {
    const sb = ctxWithInvite({
      users: [
        { id: ADMIN.id, email: 'admin@c1.com', campaign_id: 'c1', type: 'Admin' },
        { id: INVITEE.id, email: 'novo@c1.com', campaign_id: 'OTHER', type: 'Admin' },
      ],
    });
    const res = await req(authedApp(INVITEE, sb), 'POST', '/api/v1/team/invites/token/abc/accept');
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'already_in_another_campaign');
  });

  test('expired token at accept time returns 410', async () => {
    const sb = ctxWithInvite();
    // Manually flip expires_at to the past
    (sb as any)._store.get('team_invites')[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await req(authedApp(INVITEE, sb), 'POST', '/api/v1/team/invites/token/abc/accept');
    assert.equal(res.status, 410);
    assert.equal(res.body.error, 'invite_expired');
  });
});
