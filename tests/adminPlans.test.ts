/**
 * Supreme Admin plan-catalogue endpoints.
 *
 * Verifies: auth gate (403 for non-admins), validation (400 for bad input),
 * CRUD success, in-use refusal on deactivation, audit emission.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';
import { createBillingRouter } from '../src/server/modules/billing/billingRouter';

function buildApp(user: any, supabase: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) (req as any).user = user;
    next();
  });
  app.use('/api/v1/billing', createBillingRouter(supabase));
  return app;
}

async function req(app: express.Express, method: string, path: string, body?: any) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
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

function freshSupabase(extra: Record<string, any[]> = {}) {
  return createMockSupabase({
    plans: [
      { id: 'free', name: 'Gratuito', monthlyCents: 0, active: true, features: ['dashboard'], limits: {} },
      { id: 'pro', name: 'Pro', monthlyCents: 29900, active: true, features: ['dashboard', 'crm'], limits: { contacts: 10000 } },
    ],
    subscriptions: [],
    audit_logs: [],
    ...extra,
  });
}

const SUPREME = {
  id: 'supreme-user', email: 'eldastito@gmail.com',
  campaignId: 'c1', isSupremeAdmin: true,
};
const CAMPAIGN_ADMIN = {
  id: 'admin-user', email: 'admin@campaign.com',
  campaignId: 'c1', userType: 'Admin', isSupremeAdmin: false,
};

describe('Supreme Admin · plan CRUD', () => {
  test('campaign-level Admin gets 403 on GET /admin/plans', async () => {
    const sb = freshSupabase();
    const res = await req(buildApp(CAMPAIGN_ADMIN, sb), 'GET', '/api/v1/billing/admin/plans');
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'supreme_admin_required');
  });

  test('unauthenticated → 401', async () => {
    const sb = freshSupabase();
    const res = await req(buildApp(null, sb), 'GET', '/api/v1/billing/admin/plans');
    assert.equal(res.status, 401);
  });

  test('Supreme Admin lists all plans (including inactive)', async () => {
    const sb = freshSupabase({
      plans: [
        { id: 'free', name: 'Gratuito', monthlyCents: 0, active: true, features: [], limits: {} },
        { id: 'old', name: 'Legacy', monthlyCents: 100, active: false, features: [], limits: {} },
      ],
    });
    const res = await req(buildApp(SUPREME, sb), 'GET', '/api/v1/billing/admin/plans');
    assert.equal(res.status, 200);
    assert.equal(res.body.plans.length, 2);
  });

  test('POST /admin/plans creates a plan and audits the action', async () => {
    const sb = freshSupabase();
    const res = await req(buildApp(SUPREME, sb), 'POST', '/api/v1/billing/admin/plans', {
      id: 'pro_anual',
      name: 'Pro Anual',
      monthlyCents: 249900,
      features: ['dashboard', 'crm', 'ai_agents'],
      limits: { contacts: 10000, ai_budget_cents: 80000, team_users: 25, messages_per_month: 5000 },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.plan.id, 'pro_anual');
    assert.equal(res.body.plan.monthlyCents, 249900);

    // Audit row written
    const audits = (sb as any)._store.get('audit_logs');
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'admin.plan.create');
    assert.equal(audits[0].severity, 'warn');
  });

  test('POST /admin/plans rejects invalid id (special chars)', async () => {
    const sb = freshSupabase();
    const res = await req(buildApp(SUPREME, sb), 'POST', '/api/v1/billing/admin/plans', {
      id: 'PRO!ANUAL',
      name: 'X', monthlyCents: 100, features: [], limits: {},
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /invalid_id/);
  });

  test('POST /admin/plans rejects negative price', async () => {
    const sb = freshSupabase();
    const res = await req(buildApp(SUPREME, sb), 'POST', '/api/v1/billing/admin/plans', {
      id: 'cheap', name: 'X', monthlyCents: -1, features: [], limits: {},
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /invalid_monthlyCents/);
  });

  test('POST /admin/plans rejects unknown limit key', async () => {
    const sb = freshSupabase();
    const res = await req(buildApp(SUPREME, sb), 'POST', '/api/v1/billing/admin/plans', {
      id: 'evil', name: 'X', monthlyCents: 0, features: [],
      limits: { hacker_field: 999 },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /unknown_limit/);
  });

  test('PUT /admin/plans/:id updates fields and emits audit', async () => {
    const sb = freshSupabase();
    const res = await req(buildApp(SUPREME, sb), 'PUT', '/api/v1/billing/admin/plans/pro', {
      name: 'Pro 2.0',
      monthlyCents: 34900,
      features: ['dashboard', 'crm', 'ai_agents'],
      limits: { contacts: 15000 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.plan.name, 'Pro 2.0');
    assert.equal(res.body.plan.monthlyCents, 34900);

    const stored = (sb as any)._store.get('plans').find((p: any) => p.id === 'pro');
    assert.equal(stored.monthlyCents, 34900);

    const audits = (sb as any)._store.get('audit_logs');
    assert.equal(audits[0].action, 'admin.plan.update');
  });

  test('DELETE /admin/plans/:id with active subscriptions returns 409', async () => {
    const sb = freshSupabase({
      subscriptions: [
        { id: 's1', campaignId: 'c1', planId: 'pro', status: 'active' },
      ],
    });
    const res = await req(buildApp(SUPREME, sb), 'DELETE', '/api/v1/billing/admin/plans/pro');
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'plan_in_use');
    assert.equal(res.body.activeSubscriptions, 1);

    // Plan remains active
    const stored = (sb as any)._store.get('plans').find((p: any) => p.id === 'pro');
    assert.equal(stored.active, true);
  });

  test('DELETE /admin/plans/:id soft-deactivates when not in use', async () => {
    const sb = freshSupabase();
    const res = await req(buildApp(SUPREME, sb), 'DELETE', '/api/v1/billing/admin/plans/pro');
    assert.equal(res.status, 200);

    const stored = (sb as any)._store.get('plans').find((p: any) => p.id === 'pro');
    assert.equal(stored.active, false);

    const audits = (sb as any)._store.get('audit_logs');
    assert.equal(audits[0].action, 'admin.plan.deactivate');
  });

  test('Supreme Admin via env email is also accepted', async () => {
    process.env.SUPREME_ADMIN_EMAIL = 'owner@example.com';
    const sb = freshSupabase();
    const userByEmail = {
      id: 'someone', email: 'owner@example.com',
      campaignId: 'c1', isSupremeAdmin: false,
    };
    const res = await req(buildApp(userByEmail, sb), 'GET', '/api/v1/billing/admin/plans');
    assert.equal(res.status, 200);
    delete process.env.SUPREME_ADMIN_EMAIL;
  });
});
