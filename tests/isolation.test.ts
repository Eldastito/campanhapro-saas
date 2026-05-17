/**
 * Cross-campaign isolation tests.
 *
 * Goal: every router endpoint that touches campaign-scoped data MUST
 *  - reject access when req.user.campaignId does not match the resource's campaign
 *  - never leak rows from other campaigns
 *
 * Strategy: instantiate the real router with a mock Supabase pre-populated
 * with two campaigns' data, then drive HTTP through Express.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';
import { createScenariosRouter } from '../src/server/modules/scenarios/scenariosRouter';
import { createObservabilityRouter } from '../src/server/modules/observability/observabilityRouter';

const CAMPAIGN_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMPAIGN_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function buildAppWithUser(campaignId: string, supabase: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 'user-' + campaignId, campaignId };
    next();
  });
  app.use('/api/v1/scenarios', createScenariosRouter(supabase));
  app.use('/api/v1/observability', createObservabilityRouter(supabase));
  return app;
}

async function jsonRequest(app: express.Express, method: string, path: string, body?: any) {
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
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

describe('Cross-campaign isolation', () => {
  test('GET /scenarios/dossiers returns only own-campaign rows', async () => {
    const supabase = createMockSupabase({
      dossiers: [
        { id: 'd1', campaignId: CAMPAIGN_A, subjectName: 'A', subjectType: 'opponent', status: 'pending_approval', content: 'x', createdAt: '2026-05-15' },
        { id: 'd2', campaignId: CAMPAIGN_B, subjectName: 'B', subjectType: 'opponent', status: 'pending_approval', content: 'x', createdAt: '2026-05-15' },
      ],
    });
    const app = buildAppWithUser(CAMPAIGN_A, supabase);
    const res = await jsonRequest(app, 'GET', '/api/v1/scenarios/dossiers');
    assert.equal(res.status, 200);
    assert.equal(res.body.dossiers.length, 1);
    assert.equal(res.body.dossiers[0].id, 'd1');
  });

  test('approve dossier from another campaign is a no-op (no leak)', async () => {
    const supabase = createMockSupabase({
      dossiers: [
        { id: 'foreign', campaignId: CAMPAIGN_B, subjectName: 'B', subjectType: 'opponent', status: 'pending_approval', content: 'x' },
      ],
    });
    const app = buildAppWithUser(CAMPAIGN_A, supabase);
    const res = await jsonRequest(app, 'POST', '/api/v1/scenarios/dossiers/foreign/approve');
    assert.equal(res.status, 200);
    // Verify the foreign-campaign row was NOT mutated
    const stored = (supabase as any)._store.get('dossiers')[0];
    assert.equal(stored.status, 'pending_approval', 'foreign campaign dossier must not be approved by campaign A');
  });

  test('GET /scenarios/simulate (history) returns only own-campaign runs', async () => {
    const supabase = createMockSupabase({
      simulation_runs: [
        { id: 's1', campaignId: CAMPAIGN_A, iterations: 1000, candidatesInput: [], resultsSummary: [], createdAt: '2026-05-15' },
        { id: 's2', campaignId: CAMPAIGN_B, iterations: 1000, candidatesInput: [], resultsSummary: [], createdAt: '2026-05-15' },
      ],
    });
    const app = buildAppWithUser(CAMPAIGN_A, supabase);
    const res = await jsonRequest(app, 'GET', '/api/v1/scenarios/simulate');
    assert.equal(res.status, 200);
    assert.equal(res.body.runs.length, 1);
    assert.equal(res.body.runs[0].id, 's1');
  });

  test('observability /audit returns only own-campaign log lines', async () => {
    const supabase = createMockSupabase({
      audit_logs: [
        { id: 'a1', campaignId: CAMPAIGN_A, action: 'dossier.approve', actorId: 'u1', actorType: 'user', resourceType: 'dossier', resourceId: 'd1', severity: 'warn', metadata: {}, traceId: 't1', createdAt: '2026-05-15' },
        { id: 'a2', campaignId: CAMPAIGN_B, action: 'dossier.approve', actorId: 'u2', actorType: 'user', resourceType: 'dossier', resourceId: 'd2', severity: 'warn', metadata: {}, traceId: 't2', createdAt: '2026-05-15' },
      ],
      campaigns: [],
    });
    const app = buildAppWithUser(CAMPAIGN_A, supabase);
    const res = await jsonRequest(app, 'GET', '/api/v1/observability/audit');
    assert.equal(res.status, 200);
    assert.equal(res.body.entries.length, 1);
    assert.equal(res.body.entries[0].id, 'a1');
  });

  test('unauthenticated request is rejected (no campaignId on req.user)', async () => {
    const supabase = createMockSupabase({ dossiers: [] });
    const app = express();
    app.use(express.json());
    // No auth middleware — req.user is undefined
    app.use('/api/v1/scenarios', createScenariosRouter(supabase));
    const res = await jsonRequest(app, 'GET', '/api/v1/scenarios/dossiers');
    assert.equal(res.status, 401);
  });
});
