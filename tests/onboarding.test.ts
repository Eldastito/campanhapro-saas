import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';
import { createOnboardingRouter } from '../src/server/modules/onboarding/onboardingRouter';

const USER_A = 'user-aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'user-bbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function appWith(userId: string | null, supabase: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (userId) (req as any).user = { id: userId, email: `${userId}@test.com` };
    next();
  });
  app.use('/api/v1/onboarding', createOnboardingRouter(supabase));
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

describe('Onboarding', () => {
  test('unauthenticated → 401', async () => {
    const sb = createMockSupabase({ users: [], campaigns: [] });
    const app = appWith(null, sb);
    const res = await req(app, 'POST', '/api/v1/onboarding/bootstrap', { campaignName: 'X' });
    assert.equal(res.status, 401);
  });

  test('GET /status returns bootstrapped=false when user has no campaign', async () => {
    const sb = createMockSupabase({ users: [], campaigns: [] });
    const app = appWith(USER_A, sb);
    const res = await req(app, 'GET', '/api/v1/onboarding/status');
    assert.equal(res.status, 200);
    assert.equal(res.body.bootstrapped, false);
  });

  test('GET /status returns bootstrapped=true when user has campaign', async () => {
    const sb = createMockSupabase({
      users: [{ id: USER_A, campaign_id: 'c1', type: 'Admin', name: 'A', email: 'a@b.c' }],
      campaigns: [],
    });
    const app = appWith(USER_A, sb);
    const res = await req(app, 'GET', '/api/v1/onboarding/status');
    assert.equal(res.body.bootstrapped, true);
    assert.equal(res.body.user.campaign_id, 'c1');
  });

  test('POST /bootstrap rejects empty campaignName', async () => {
    const sb = createMockSupabase({ users: [], campaigns: [] });
    const app = appWith(USER_A, sb);
    const res = await req(app, 'POST', '/api/v1/onboarding/bootstrap', { campaignName: '   ' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /campaignName/);
  });

  test('POST /bootstrap creates campaign + user + free subscription', async () => {
    const sb = createMockSupabase({
      users: [],
      campaigns: [],
      plans: [{
        id: 'free', name: 'Gratuito', monthly_cents: 0, active: true,
        features: ['dashboard', 'crm'],
        limits: { contacts: 100, ai_budget_cents: 0, team_users: 2, messages_per_month: 0 },
      }],
      subscriptions: [],
    });
    const app = appWith(USER_A, sb);
    const res = await req(app, 'POST', '/api/v1/onboarding/bootstrap', {
      campaignName: 'Campanha Teste 2026',
      candidateName: 'João Silva',
      party: 'PRT',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.bootstrapped, true);
    assert.ok(res.body.campaignId);

    const campaigns = (sb as any)._store.get('campaigns');
    assert.equal(campaigns.length, 1);
    assert.equal(campaigns[0].name, 'Campanha Teste 2026');
    assert.equal(campaigns[0].candidate_name, 'João Silva');
    assert.equal(campaigns[0].created_by, USER_A);

    const users = (sb as any)._store.get('users');
    assert.equal(users.length, 1);
    assert.equal(users[0].type, 'Admin');
    assert.equal(users[0].campaign_id, campaigns[0].id);

    const subs = (sb as any)._store.get('subscriptions');
    assert.equal(subs.length, 1);
    assert.equal(subs[0].plan_id, 'free');
  });

  test('POST /bootstrap is idempotent — second call returns alreadyBootstrapped', async () => {
    const sb = createMockSupabase({
      users: [{ id: USER_A, campaign_id: 'existing-campaign', type: 'Admin', name: 'A', email: 'a@b.c' }],
      campaigns: [{ id: 'existing-campaign', name: 'Existing' }],
      plans: [{
        id: 'free', name: 'Gratuito', monthly_cents: 0, active: true,
        features: [], limits: {},
      }],
      subscriptions: [],
    });
    const app = appWith(USER_A, sb);
    const res = await req(app, 'POST', '/api/v1/onboarding/bootstrap', { campaignName: 'New name' });
    assert.equal(res.status, 200);
    assert.equal(res.body.alreadyBootstrapped, true);
    assert.equal(res.body.campaignId, 'existing-campaign');

    // No new campaign created
    const campaigns = (sb as any)._store.get('campaigns');
    assert.equal(campaigns.length, 1);
  });

  test('two different users get isolated campaigns', async () => {
    const sb = createMockSupabase({
      users: [], campaigns: [], subscriptions: [],
      plans: [{ id: 'free', name: 'Gratuito', monthly_cents: 0, active: true, features: [], limits: {} }],
    });

    const r1 = await req(appWith(USER_A, sb), 'POST', '/api/v1/onboarding/bootstrap', { campaignName: 'A' });
    const r2 = await req(appWith(USER_B, sb), 'POST', '/api/v1/onboarding/bootstrap', { campaignName: 'B' });

    assert.notEqual(r1.body.campaignId, r2.body.campaignId);
    const users = (sb as any)._store.get('users');
    assert.equal(users.find((u: any) => u.id === USER_A).campaign_id, r1.body.campaignId);
    assert.equal(users.find((u: any) => u.id === USER_B).campaign_id, r2.body.campaignId);
  });
});
