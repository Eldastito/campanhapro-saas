/**
 * Testes do PR 22 — status/observabilidade do scheduler.
 *
 * Cobre:
 *   SchedulerHandle.getStatus():
 *     - Antes de qualquer tick: running=true, tickCount=0, lastOutcome=null
 *     - Depois de N ticks: tickCount atualizado, lastOutcome refletindo o último
 *     - stop() reflete running=false
 *     - startedAt não muda entre chamadas
 *
 *   getCurrentSchedulerHandle():
 *     - null quando scheduler nunca foi iniciado
 *     - devolve handle quando maybeStart criou um
 *     - devolve null quando handle foi parado
 *
 *   GET /signals/scheduler-status:
 *     - 401 sem campaignId
 *     - 403 pra não-Admin
 *     - 200 com enabled:false quando não iniciado
 *     - 200 com status completo quando iniciado
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';

import {
  startSocialSignalsScheduler,
  maybeStartSocialSignalsScheduler,
  getCurrentSchedulerHandle,
  _resetCurrentSchedulerHandleForTests,
  SOCIAL_SIGNALS_SCHEDULER_VERSION,
} from '../src/server/modules/social/socialSignalsScheduler';
import { createSocialSignalsRouter } from '../src/server/modules/social/socialSignalsRouter';

const CAMP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// silencia noise
beforeEach(() => {
  console.warn = () => {};
  console.log = () => {};
  _resetCurrentSchedulerHandleForTests();
});

// ── SchedulerHandle.getStatus ──────────────────────────────────────

describe('SchedulerHandle.getStatus — snapshot', () => {
  test('antes do primeiro tick: running=true, tickCount=0, lastOutcome=null', () => {
    const supabase = createMockSupabase({});
    const handle = startSocialSignalsScheduler({
      supabase,
      intervalMs: 60_000,
    });
    const status = handle.getStatus();
    assert.equal(status.running, true);
    assert.equal(status.tickCount, 0);
    assert.equal(status.lastOutcome, null);
    assert.ok(typeof status.startedAt === 'string');
    assert.equal(status.schedulerVersion, SOCIAL_SIGNALS_SCHEDULER_VERSION);
    handle.stop();
  });

  test('depois de runOnStart tick: tickCount=1, lastOutcome preenchido', async () => {
    const supabase = createMockSupabase({
      campaign_configs: [{ id: 'x1', campaignId: CAMP }],
      social_posts: [], social_comments: [], social_signals: [],
    });
    const handle = startSocialSignalsScheduler({
      supabase, intervalMs: 60_000, runOnStart: true,
    });
    await new Promise(res => setTimeout(res, 30));
    const status = handle.getStatus();
    assert.equal(status.tickCount, 1);
    assert.ok(status.lastOutcome);
    assert.equal(status.lastOutcome!.ok, true);
    handle.stop();
  });

  test('stop() → running=false; startedAt preservado', () => {
    const supabase = createMockSupabase({});
    const handle = startSocialSignalsScheduler({ supabase, intervalMs: 60_000 });
    const before = handle.getStatus();
    handle.stop();
    const after = handle.getStatus();
    assert.equal(after.running, false);
    assert.equal(after.startedAt, before.startedAt);
  });

  test('erro no tick vira lastOutcome.ok=false; tickCount ainda incrementa', async () => {
    // Force erro global
    const brokenSupabase = {
      from: () => { throw new Error('supabase broken'); },
    } as unknown as ReturnType<typeof createMockSupabase>;
    const handle = startSocialSignalsScheduler({
      supabase: brokenSupabase, intervalMs: 60_000, runOnStart: true,
    });
    await new Promise(res => setTimeout(res, 30));
    const status = handle.getStatus();
    assert.equal(status.tickCount, 1);
    assert.ok(status.lastOutcome);
    assert.equal(status.lastOutcome!.ok, false);
    handle.stop();
  });
});

// ── getCurrentSchedulerHandle ──────────────────────────────────────

describe('getCurrentSchedulerHandle registry', () => {
  test('null quando scheduler nunca foi iniciado', () => {
    assert.equal(getCurrentSchedulerHandle(), null);
  });

  test('maybeStart registra o handle; getCurrent devolve o mesmo', () => {
    const supabase = createMockSupabase({});
    const handle = maybeStartSocialSignalsScheduler({
      supabase,
      env: { SOCIAL_SIGNALS_SCHEDULER_ENABLED: '1' },
    });
    assert.ok(handle);
    const current = getCurrentSchedulerHandle();
    assert.equal(current, handle);
    handle!.stop();
  });

  test('após stop(), getCurrent devolve null', () => {
    const supabase = createMockSupabase({});
    const handle = maybeStartSocialSignalsScheduler({
      supabase,
      env: { SOCIAL_SIGNALS_SCHEDULER_ENABLED: '1' },
    });
    handle!.stop();
    assert.equal(getCurrentSchedulerHandle(), null);
  });
});

// ── GET /signals/scheduler-status ───────────────────────────────────

interface FakeUser {
  id?: string;
  campaignId?: string;
  type?: string;
}

function buildApp(user: FakeUser, supabase: ReturnType<typeof createMockSupabase>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { user: FakeUser }).user = user; next(); });
  app.use('/api/v1/social', createSocialSignalsRouter(supabase));
  return app;
}

async function req(app: express.Express, method: string, path: string) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as { port: number }).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
        });
        const text = await res.text();
        let parsed: unknown = null;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.status, body: parsed });
      } catch (err) { reject(err); } finally { server.close(); }
    });
  });
}

describe('GET /signals/scheduler-status — auth', () => {
  test('401 sem campaignId', async () => {
    const supabase = createMockSupabase({});
    const app = buildApp({ id: 'u1' }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals/scheduler-status');
    assert.equal(r.status, 401);
  });

  test('403 pra não-Admin', async () => {
    const supabase = createMockSupabase({});
    const app = buildApp({ campaignId: CAMP, type: 'Fiscal' }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals/scheduler-status');
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { error: 'admin_required' });
  });
});

describe('GET /signals/scheduler-status — respostas', () => {
  test('enabled:false quando scheduler não iniciado', async () => {
    const supabase = createMockSupabase({});
    const app = buildApp({ campaignId: CAMP, type: 'Admin' }, supabase);
    const r = await req(app, 'GET', '/api/v1/social/signals/scheduler-status');
    assert.equal(r.status, 200);
    const body = r.body as { enabled: boolean; reason?: string };
    assert.equal(body.enabled, false);
    assert.equal(body.reason, 'scheduler_not_running');
  });

  test('enabled:true + status completo quando scheduler ativo', async () => {
    const supabase = createMockSupabase({});
    const handle = maybeStartSocialSignalsScheduler({
      supabase,
      env: {
        SOCIAL_SIGNALS_SCHEDULER_ENABLED: '1',
        SOCIAL_SIGNALS_SCHEDULER_INTERVAL_MS: '60000',
      },
    });
    assert.ok(handle);
    try {
      const app = buildApp({ campaignId: CAMP, type: 'Admin' }, supabase);
      const r = await req(app, 'GET', '/api/v1/social/signals/scheduler-status');
      assert.equal(r.status, 200);
      const body = r.body as {
        enabled: boolean;
        running: boolean;
        startedAt: string;
        tickCount: number;
        lastOutcome: unknown;
        schedulerVersion: string;
      };
      assert.equal(body.enabled, true);
      assert.equal(body.running, true);
      assert.equal(typeof body.startedAt, 'string');
      assert.equal(typeof body.tickCount, 'number');
      assert.equal(body.schedulerVersion, SOCIAL_SIGNALS_SCHEDULER_VERSION);
    } finally {
      handle!.stop();
    }
  });
});
