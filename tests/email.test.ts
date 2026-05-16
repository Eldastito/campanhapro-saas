/**
 * Email service tests — exercises template rendering, provider abstraction,
 * idempotency, and the email_log audit trail.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';
import {
  sendWelcomeEmail, sendPaymentConfirmedEmail, sendSubscriptionCanceledEmail,
} from '../src/server/modules/email/emailService';
import {
  getEmailProvider, _resetEmailProviderCache,
} from '../src/server/modules/email/emailProvider';
import { ResendProvider } from '../src/server/modules/email/resendProvider';
import { templates } from '../src/server/modules/email/templates';

const CAMPAIGN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'user-uuid-1';

let originalFetch: typeof fetch;
let originalEnv: NodeJS.ProcessEnv;

before(() => {
  originalFetch = globalThis.fetch;
  originalEnv = { ...process.env };
});

after(() => {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
  _resetEmailProviderCache();
});

describe('email templates', () => {
  test('welcome includes name and campaign in subject and body', () => {
    const t = templates.welcome({ name: 'João', campaignName: 'Campanha 2026' });
    assert.match(t.subject, /João/);
    assert.match(t.html, /João/);
    assert.match(t.html, /Campanha 2026/);
    assert.match(t.text, /Campanha 2026/);
  });

  test('paymentConfirmed formats amount in BRL', () => {
    const t = templates.paymentConfirmed({
      name: 'A', planName: 'Pro', amountCents: 29900, paymentMethod: 'pix',
    });
    assert.match(t.html, /R\$/);
    assert.match(t.html, /299/);
    assert.match(t.html, /PIX/);
  });

  test('paymentConfirmed maps payment methods to PT-BR labels', () => {
    const t = templates.paymentConfirmed({
      name: 'A', planName: 'Pro', amountCents: 29900, paymentMethod: 'credit_card',
    });
    assert.match(t.html, /cartão de crédito/);
  });

  test('teamInvite includes role and inviter', () => {
    const t = templates.teamInvite({
      inviterName: 'Maria', campaignName: 'Campanha X', role: 'Líder',
      inviteUrl: 'https://app/invite/abc',
    });
    assert.match(t.subject, /Maria/);
    assert.match(t.html, /Líder/);
    assert.match(t.html, /https:\/\/app\/invite\/abc/);
  });

  test('subjects do not exceed 78 chars (deliverability)', () => {
    const tested = [
      templates.welcome({ name: 'João Silva', campaignName: 'Campanha 2026' }),
      templates.paymentConfirmed({ name: 'João', planName: 'Pro', amountCents: 29900, paymentMethod: 'pix' }),
      templates.paymentOverdue({ name: 'João', planName: 'Pro', amountCents: 29900 }),
      templates.subscriptionCanceled({ name: 'João', planName: 'Pro', periodEnd: new Date().toISOString() }),
    ];
    for (const t of tested) {
      assert.ok(t.subject.length <= 78, `subject too long (${t.subject.length}): ${t.subject}`);
    }
  });

  test('html escapes user-provided strings to prevent XSS', () => {
    const t = templates.welcome({
      name: '<script>alert(1)</script>',
      campaignName: 'X "& Co"',
    });
    assert.doesNotMatch(t.html, /<script>/);
    assert.match(t.html, /&lt;script&gt;/);
    assert.match(t.html, /&quot;/);
  });
});

describe('emailService — provider integration', () => {
  test('stub provider returns ok=true and logs', async () => {
    _resetEmailProviderCache();
    delete process.env.EMAIL_PROVIDER;
    const provider = getEmailProvider();
    assert.equal(provider.providerName, 'stub');
    const result = await provider.sendEmail({ to: 'a@b.c', subject: 'X', html: '<p>x</p>' });
    assert.equal(result.ok, true);
    assert.match(result.providerMessageId!, /^stub_/);
  });

  test('sendWelcomeEmail writes email_log row with status=sent', async () => {
    _resetEmailProviderCache();
    delete process.env.EMAIL_PROVIDER;
    const sb = createMockSupabase({ email_log: [] });

    await sendWelcomeEmail(sb, {
      campaignId: CAMPAIGN, userId: USER,
      email: 'admin@test.com', name: 'Admin Teste',
      campaignName: 'Campanha 2026',
    });

    const rows = (sb as any)._store.get('email_log');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].template, 'welcome');
    assert.equal(rows[0].status, 'sent');
    assert.equal(rows[0].provider, 'stub');
    assert.equal(rows[0].campaign_id, CAMPAIGN);
    assert.equal(rows[0].idempotency_key, `welcome:${CAMPAIGN}`);
  });

  test('idempotency: second send with same key skips delivery', async () => {
    _resetEmailProviderCache();
    delete process.env.EMAIL_PROVIDER;
    const sb = createMockSupabase({ email_log: [] });

    await sendWelcomeEmail(sb, {
      campaignId: CAMPAIGN, userId: USER,
      email: 'admin@test.com', name: 'A', campaignName: 'C',
    });
    await sendWelcomeEmail(sb, {
      campaignId: CAMPAIGN, userId: USER,
      email: 'admin@test.com', name: 'A', campaignName: 'C',
    });

    // Only one row — second call short-circuited on idempotency check
    const rows = (sb as any)._store.get('email_log');
    assert.equal(rows.length, 1);
  });

  test('different payment_event_id triggers two distinct emails', async () => {
    _resetEmailProviderCache();
    delete process.env.EMAIL_PROVIDER;
    const sb = createMockSupabase({ email_log: [] });

    await sendPaymentConfirmedEmail(sb, {
      campaignId: CAMPAIGN, email: 'a@b.c', name: 'A',
      planName: 'Pro', amountCents: 29900, paymentMethod: 'pix',
      paymentEventId: 'pay_1',
    });
    await sendPaymentConfirmedEmail(sb, {
      campaignId: CAMPAIGN, email: 'a@b.c', name: 'A',
      planName: 'Pro', amountCents: 29900, paymentMethod: 'pix',
      paymentEventId: 'pay_2',
    });

    const rows = (sb as any)._store.get('email_log');
    assert.equal(rows.length, 2);
  });

  test('sendSubscriptionCanceledEmail uses subscriptionId as idempotency key', async () => {
    _resetEmailProviderCache();
    delete process.env.EMAIL_PROVIDER;
    const sb = createMockSupabase({ email_log: [] });

    await sendSubscriptionCanceledEmail(sb, {
      campaignId: CAMPAIGN, email: 'a@b.c', name: 'A',
      planName: 'Pro', periodEnd: new Date().toISOString(),
      subscriptionId: 'sub_1',
    });
    const rows = (sb as any)._store.get('email_log');
    assert.equal(rows[0].idempotency_key, 'subscription_canceled:sub_1');
  });

  test('provider error is logged with status=failed (never throws)', async () => {
    _resetEmailProviderCache();
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 'test';
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return {
        ok: false, status: 401,
        text: async () => JSON.stringify({ message: 'invalid_api_key' }),
      } as Response;
    }) as typeof fetch;

    const sb = createMockSupabase({ email_log: [] });
    await assert.doesNotReject(() => sendWelcomeEmail(sb, {
      campaignId: CAMPAIGN, userId: USER,
      email: 'a@b.c', name: 'A', campaignName: 'C',
    }));

    assert.equal(called, true);
    const rows = (sb as any)._store.get('email_log');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'failed');
    assert.match(rows[0].error, /invalid_api_key/);
    _resetEmailProviderCache();
  });
});

describe('ResendProvider', () => {
  test('sendEmail posts to Resend API with correct shape', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.EMAIL_FROM = 'From <from@example.com>';
    let captured: any = null;
    globalThis.fetch = (async (url: any, init: any) => {
      captured = { url, init };
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ id: 'rsd_123' }),
      } as Response;
    }) as typeof fetch;

    const provider = new ResendProvider();
    const result = await provider.sendEmail({
      to: 'admin@test.com', subject: 'Hi', html: '<p>hi</p>',
    });
    assert.equal(result.ok, true);
    assert.equal(result.providerMessageId, 'rsd_123');
    assert.equal(captured.url, 'https://api.resend.com/emails');
    const headers = captured.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(String(captured.init.body));
    assert.equal(body.from, 'From <from@example.com>');
    assert.deepEqual(body.to, ['admin@test.com']);
    assert.equal(body.subject, 'Hi');
  });
});
