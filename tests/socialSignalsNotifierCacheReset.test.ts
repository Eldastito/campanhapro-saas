/**
 * Testes do PR 40 — DELETE /signals/notifier-cache + resetters explícitos.
 *
 * Cobre:
 *   resetSlackNotifierCache / resetEmailNotifierCache:
 *     - campaignId obrigatório
 *     - Cache vazio → { cleared: 0 }
 *     - Cache com N entries → { cleared: N } e cache resetado
 *     - Isolamento §35: só limpa a campanha alvo
 *   DELETE /signals/notifier-cache:
 *     - 401 sem campaignId
 *     - 403 pra não-Admin
 *     - 200 pra Admin com { slack, email }
 *     - Após reset, próxima notificação do mesmo dedupKey re-envia
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockSupabase } from './helpers/mockSupabase';
import { createSocialSignalsRouter } from '../src/server/modules/social/socialSignalsRouter';
import {
  notifySignals,
  resetSlackNotifierCache,
  getSlackNotifierStatus,
  _resetNotifierCacheForTests,
} from '../src/server/modules/social/socialSignalsNotifier';
import {
  emailNotifySignals,
  resetEmailNotifierCache,
  getEmailNotifierStatus,
  _resetEmailNotifierCacheForTests,
} from '../src/server/modules/social/socialSignalsEmailNotifier';
import type { SocialSignal } from '../src/server/modules/social/intelligence/socialSignalBus';
import { SOCIAL_SIGNAL_BUS_VERSION } from '../src/server/modules/social/intelligence/socialSignalBus';
import type { EmailProvider, SendEmailParams, SendEmailResult } from '../src/server/modules/email/emailProvider';

const CAMP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
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
});

// ── Unit: resetSlackNotifierCache ──────────────────────────────────

describe('resetSlackNotifierCache', () => {
  test('campaignId obrigatório', () => {
    assert.throws(() => resetSlackNotifierCache(''));
  });

  test('cache vazio → cleared=0', () => {
    const r = resetSlackNotifierCache(CAMP);
    assert.equal(r.cleared, 0);
  });

  test('cache com N entries → cleared=N e cache zerado', async () => {
    await notifySignals(
      { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: okFetch() },
      CAMP,
      [signal({ dedupKey: 'k1' }), signal({ dedupKey: 'k2' }), signal({ dedupKey: 'k3' })],
    );
    // Confirma que tem 3 no cache
    assert.equal(getSlackNotifierStatus(CAMP).cachedDedupKeys, 3);
    const r = resetSlackNotifierCache(CAMP);
    assert.equal(r.cleared, 3);
    // Cache zerado
    assert.equal(getSlackNotifierStatus(CAMP).cachedDedupKeys, 0);
  });

  test('isolamento §35: só limpa a campanha alvo', async () => {
    const okF = okFetch();
    await notifySignals(
      { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: okF },
      CAMP,
      [signal({ dedupKey: 'a' })],
    );
    await notifySignals(
      { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: okF },
      OTHER,
      [signal({ dedupKey: 'x' }), signal({ dedupKey: 'y' })],
    );
    const r = resetSlackNotifierCache(CAMP);
    assert.equal(r.cleared, 1);
    assert.equal(getSlackNotifierStatus(CAMP).cachedDedupKeys, 0);
    assert.equal(getSlackNotifierStatus(OTHER).cachedDedupKeys, 2);
  });

  test('após reset, dedupKey previamente notificado é re-enviado', async () => {
    const s = signal({ dedupKey: 'reused' });
    await notifySignals(
      { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: okFetch() },
      CAMP,
      [s],
    );
    // 2ª chamada → skipped_deduped (cache marcou)
    const r1 = await notifySignals(
      { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: okFetch() },
      CAMP,
      [s],
    );
    assert.equal(r1.skippedDeduped, 1);
    // Reset
    resetSlackNotifierCache(CAMP);
    // 3ª chamada → notified=1 (cache vazio de novo)
    const r2 = await notifySignals(
      { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: okFetch() },
      CAMP,
      [s],
    );
    assert.equal(r2.notified, 1);
    assert.equal(r2.skippedDeduped, 0);
  });
});

// ── Unit: resetEmailNotifierCache (mesma forma) ────────────────────

describe('resetEmailNotifierCache', () => {
  test('campaignId obrigatório', () => {
    assert.throws(() => resetEmailNotifierCache(''));
  });

  test('cache com N entries → cleared=N e cache zerado', async () => {
    await emailNotifySignals(
      { recipients: ['a@b.com'], provider: okEmailProvider() },
      CAMP,
      [signal({ dedupKey: 'e1' }), signal({ dedupKey: 'e2' })],
    );
    assert.equal(getEmailNotifierStatus(CAMP).cachedDedupKeys, 2);
    const r = resetEmailNotifierCache(CAMP);
    assert.equal(r.cleared, 2);
    assert.equal(getEmailNotifierStatus(CAMP).cachedDedupKeys, 0);
  });

  test('isolamento §35 no email notifier', async () => {
    const provider = okEmailProvider();
    await emailNotifySignals({ recipients: ['a@b.com'], provider }, CAMP, [signal({ dedupKey: 'a' })]);
    await emailNotifySignals({ recipients: ['a@b.com'], provider }, OTHER, [signal({ dedupKey: 'x' })]);
    resetEmailNotifierCache(CAMP);
    assert.equal(getEmailNotifierStatus(CAMP).cachedDedupKeys, 0);
    assert.equal(getEmailNotifierStatus(OTHER).cachedDedupKeys, 1);
  });
});

// ── HTTP: DELETE /signals/notifier-cache ──────────────────────────

interface FakeUser { id?: string; campaignId?: string; type?: string }

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
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
        const text = await res.text();
        let parsed: unknown = null;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.status, body: parsed });
      } catch (err) { reject(err); } finally { server.close(); }
    });
  });
}

describe('DELETE /signals/notifier-cache — auth + payload', () => {
  test('401 sem campaignId', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ id: 'u1' }, supabase);
    const r = await req(app, 'DELETE', '/api/v1/social/signals/notifier-cache');
    assert.equal(r.status, 401);
  });

  test('403 pra não-Admin', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP, type: 'Fiscal' }, supabase);
    const r = await req(app, 'DELETE', '/api/v1/social/signals/notifier-cache');
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { error: 'admin_required' });
  });

  test('200 pra Admin devolve { slack, email } com contagem', async () => {
    // Popula cache antes
    await notifySignals(
      { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: okFetch() },
      CAMP,
      [signal({ dedupKey: 'sk1' }), signal({ dedupKey: 'sk2' })],
    );
    await emailNotifySignals(
      { recipients: ['a@b.com'], provider: okEmailProvider() },
      CAMP,
      [signal({ dedupKey: 'ek1' })],
    );

    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP, type: 'Admin' }, supabase);
    const r = await req(app, 'DELETE', '/api/v1/social/signals/notifier-cache');
    assert.equal(r.status, 200);
    const body = r.body as {
      slack: { cleared: number };
      email: { cleared: number };
    };
    assert.equal(body.slack.cleared, 2);
    assert.equal(body.email.cleared, 1);
    // Cache zerado
    assert.equal(getSlackNotifierStatus(CAMP).cachedDedupKeys, 0);
    assert.equal(getEmailNotifierStatus(CAMP).cachedDedupKeys, 0);
  });

  test('200 quando cache já estava vazio → cleared=0', async () => {
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP, type: 'Admin' }, supabase);
    const r = await req(app, 'DELETE', '/api/v1/social/signals/notifier-cache');
    assert.equal(r.status, 200);
    const body = r.body as { slack: { cleared: number }; email: { cleared: number } };
    assert.equal(body.slack.cleared, 0);
    assert.equal(body.email.cleared, 0);
  });

  test('não afeta outras campanhas (§35 no HTTP layer)', async () => {
    await notifySignals(
      { slackWebhookUrl: 'https://hooks.slack.com/x', fetchImpl: okFetch() },
      OTHER,
      [signal({ dedupKey: 'other-k' })],
    );
    const supabase = createMockSupabase({ social_signals: [] });
    const app = buildApp({ campaignId: CAMP, type: 'Admin' }, supabase);
    await req(app, 'DELETE', '/api/v1/social/signals/notifier-cache');
    // OTHER intacto
    assert.equal(getSlackNotifierStatus(OTHER).cachedDedupKeys, 1);
  });
});
