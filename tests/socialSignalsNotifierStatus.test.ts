/**
 * Testes do PR 39 — GET /signals/notifier-status + helpers get*NotifierStatus.
 *
 * Cobre:
 *   getSlackNotifierStatus / getEmailNotifierStatus:
 *     - campaignId obrigatório
 *     - configured=false quando env vazio
 *     - configured=true quando env setado; minSeverity efetivo (env ou default)
 *     - cachedDedupKeys reflete cache atual
 *     - email não expõe emails, só recipientsCount
 *   GET /signals/notifier-status:
 *     - 401 sem campaignId
 *     - 403 pra não-Admin
 *     - 200 pra Admin com payload {slack, email}
 *     - Não vaza slackWebhookUrl nem lista de emails
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';
import { createSocialSignalsRouter } from '../src/server/modules/social/socialSignalsRouter';
import {
  notifySignals,
  getSlackNotifierStatus,
  _resetNotifierCacheForTests,
} from '../src/server/modules/social/socialSignalsNotifier';
import {
  emailNotifySignals,
  getEmailNotifierStatus,
  _resetEmailNotifierCacheForTests,
} from '../src/server/modules/social/socialSignalsEmailNotifier';
import type { SocialSignal } from '../src/server/modules/social/intelligence/socialSignalBus';
import { SOCIAL_SIGNAL_BUS_VERSION } from '../src/server/modules/social/intelligence/socialSignalBus';
import type { EmailProvider, SendEmailParams, SendEmailResult } from '../src/server/modules/email/emailProvider';

const CAMP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NOW = new Date('2026-08-27T12:00:00Z');

let seq = 1;
function signal(overrides: Partial<SocialSignal> = {}): SocialSignal {
  return {
    dedupKey: overrides.dedupKey ?? `stub::${seq++}`,
    source: overrides.source ?? 'anomaly',
    severity: overrides.severity ?? 'crisis',
    summary: overrides.summary ?? 'stub summary',
    hypotheses: overrides.hypotheses ?? [],
    providers: overrides.providers ?? ['instagram'],
    topic: overrides.topic,
    confidence: overrides.confidence ?? 0.8,
    emittedAt: overrides.emittedAt ?? NOW,
    payload: overrides.payload ?? { kind: 'trend', result: {} as never },
    busVersion: SOCIAL_SIGNAL_BUS_VERSION,
  };
}

function okFetch(): typeof fetch {
  return (async () => ({
    ok: true, status: 200, text: async () => 'ok', headers: new Headers(),
  } as Response)) as typeof fetch;
}

function okEmailProvider(): EmailProvider {
  return {
    providerName: 'stub' as const,
    async sendEmail(_p: SendEmailParams): Promise<SendEmailResult> {
      return { providerMessageId: 'stub-1', ok: true, status: 200 };
    },
  };
}

beforeEach(() => {
  _resetNotifierCacheForTests();
  _resetEmailNotifierCacheForTests();
  seq = 1;
  delete process.env.SOCIAL_SIGNALS_SLACK_WEBHOOK_URL;
  delete process.env.SOCIAL_SIGNALS_NOTIFY_MIN_SEVERITY;
  delete process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS;
  delete process.env.SOCIAL_SIGNALS_EMAIL_NOTIFY_MIN_SEVERITY;
});

// ── getSlackNotifierStatus ─────────────────────────────────────────

describe('getSlackNotifierStatus', () => {
  test('campaignId obrigatório', () => {
    assert.throws(() => getSlackNotifierStatus(''));
  });

  test('sem env → configured=false, minSeverity=null, cache vazio', () => {
    const s = getSlackNotifierStatus(CAMP);
    assert.equal(s.configured, false);
    assert.equal(s.minSeverity, null);
    assert.equal(s.cachedDedupKeys, 0);
    assert.ok(s.cacheMaxPerCampaign > 0);
  });

  test('com env setado → configured=true, minSeverity default risk', () => {
    process.env.SOCIAL_SIGNALS_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/x';
    const s = getSlackNotifierStatus(CAMP);
    assert.equal(s.configured, true);
    assert.equal(s.minSeverity, 'risk');
  });

  test('minSeverity via env é honrado', () => {
    process.env.SOCIAL_SIGNALS_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/x';
    process.env.SOCIAL_SIGNALS_NOTIFY_MIN_SEVERITY = 'attention';
    const s = getSlackNotifierStatus(CAMP);
    assert.equal(s.minSeverity, 'attention');
  });

  test('cachedDedupKeys reflete cache após notificação', async () => {
    await notifySignals(
      { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: okFetch() },
      CAMP,
      [signal({ dedupKey: 'k1' }), signal({ dedupKey: 'k2' })],
    );
    const s = getSlackNotifierStatus(CAMP);
    assert.equal(s.cachedDedupKeys, 2);
  });

  test('response NÃO contém slackWebhookUrl', () => {
    process.env.SOCIAL_SIGNALS_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/SECRET/xxx/yyy';
    const s = getSlackNotifierStatus(CAMP);
    const asString = JSON.stringify(s);
    assert.ok(!asString.includes('SECRET'), 'não pode vazar URL do webhook');
    assert.ok(!asString.includes('hooks.slack.com'));
  });
});

// ── getEmailNotifierStatus ─────────────────────────────────────────

describe('getEmailNotifierStatus', () => {
  test('campaignId obrigatório', () => {
    assert.throws(() => getEmailNotifierStatus(''));
  });

  test('sem env → configured=false, recipientsCount=0', () => {
    const s = getEmailNotifierStatus(CAMP);
    assert.equal(s.configured, false);
    assert.equal(s.recipientsCount, 0);
    assert.equal(s.minSeverity, null);
  });

  test('com env → configured=true, recipientsCount reflete lista', () => {
    process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS = 'a@b.com,c@d.com,e@f.com';
    const s = getEmailNotifierStatus(CAMP);
    assert.equal(s.configured, true);
    assert.equal(s.recipientsCount, 3);
    assert.equal(s.minSeverity, 'risk');
  });

  test('response NÃO contém emails individuais', () => {
    process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS = 'secret@example.com';
    const s = getEmailNotifierStatus(CAMP);
    const asString = JSON.stringify(s);
    assert.ok(!asString.includes('secret@example.com'));
    assert.ok(!asString.includes('@example.com'));
  });

  test('cachedDedupKeys reflete cache após notificação', async () => {
    await emailNotifySignals(
      { recipients: ['a@b.com'], provider: okEmailProvider() },
      CAMP,
      [signal({ dedupKey: 'ek1' })],
    );
    const s = getEmailNotifierStatus(CAMP);
    assert.equal(s.cachedDedupKeys, 1);
  });
});

// ── GET /signals/notifier-status ──────────────────────────────────

interface FakeUser { id?: string; campaignId?: string; type?: string }

function buildApp(user: FakeUser, supabase: ReturnType<typeof createMockSupabase>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { user: FakeUser }).user = user; next(); });
  app.use('/api/v1/social', createSocialSignalsRouter(supabase));
  return app;
}

async function req(app: express.Express, path: string) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as { port: number }).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'GET' });
        const text = await res.text();
        let parsed: unknown = null;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.status, body: parsed });
      } catch (err) { reject(err); } finally { server.close(); }
    });
  });
}

describe('GET /signals/notifier-status — auth + payload', () => {
  test('401 sem campaignId', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ id: 'u1' }, supabase);
    const r = await req(app, '/api/v1/social/signals/notifier-status');
    assert.equal(r.status, 401);
  });

  test('403 pra não-Admin', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP, type: 'Fiscal' }, supabase);
    const r = await req(app, '/api/v1/social/signals/notifier-status');
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { error: 'admin_required' });
  });

  test('200 pra Admin, devolve {slack, email}', async () => {
    process.env.SOCIAL_SIGNALS_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/x';
    process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS = 'a@b.com,c@d.com';
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP, type: 'Admin' }, supabase);
    const r = await req(app, '/api/v1/social/signals/notifier-status');
    assert.equal(r.status, 200);
    const body = r.body as {
      slack: { configured: boolean; minSeverity: string | null };
      email: { configured: boolean; recipientsCount: number };
    };
    assert.equal(body.slack.configured, true);
    assert.equal(body.slack.minSeverity, 'risk');
    assert.equal(body.email.configured, true);
    assert.equal(body.email.recipientsCount, 2);
  });

  test('200 endpoint NÃO expõe webhook URL nem emails', async () => {
    process.env.SOCIAL_SIGNALS_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/SECRET/xxx';
    process.env.SOCIAL_SIGNALS_NOTIFY_EMAILS = 'leak@example.com';
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP, type: 'Admin' }, supabase);
    const r = await req(app, '/api/v1/social/signals/notifier-status');
    const asString = JSON.stringify(r.body);
    assert.ok(!asString.includes('SECRET'), 'vazou webhook URL');
    assert.ok(!asString.includes('leak@example.com'), 'vazou email');
  });

  test('sem env → 200 com configured=false pra ambos', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP, type: 'Admin' }, supabase);
    const r = await req(app, '/api/v1/social/signals/notifier-status');
    assert.equal(r.status, 200);
    const body = r.body as {
      slack: { configured: boolean };
      email: { configured: boolean };
    };
    assert.equal(body.slack.configured, false);
    assert.equal(body.email.configured, false);
  });
});
