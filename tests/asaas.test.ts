/**
 * Tests for the payment gateway abstraction.
 *
 * AsaasGateway is exercised by stubbing global.fetch so we never hit the real
 * Asaas API. We verify request shape (URL, headers, body) and webhook parsing.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AsaasGateway } from '../src/server/modules/billing/asaasGateway';
import {
  getPaymentGateway, _resetGatewayCache,
} from '../src/server/modules/billing/paymentGateway';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

let calls: FetchCall[] = [];
let responses: Array<{ status: number; body: any }> = [];
let originalFetch: typeof fetch;
let originalEnv: NodeJS.ProcessEnv;

before(() => {
  originalFetch = globalThis.fetch;
  originalEnv = { ...process.env };
});

after(() => {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
});

function mockFetch() {
  calls = [];
  globalThis.fetch = (async (url: any, init?: any) => {
    calls.push({ url: String(url), init });
    const next = responses.shift() ?? { status: 200, body: {} };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => JSON.stringify(next.body),
    } as Response;
  }) as typeof fetch;
}

describe('AsaasGateway', () => {
  test('throws when ASAAS_API_KEY is missing', async () => {
    delete process.env.ASAAS_API_KEY;
    const g = new AsaasGateway();
    await assert.rejects(
      () => g.createCustomer({ campaignId: 'c1', name: 'A', email: 'a@b.c' }),
      /ASAAS_API_KEY not configured/,
    );
  });

  test('createCustomer sends correct payload + headers', async () => {
    process.env.ASAAS_API_KEY = 'test-key';
    process.env.ASAAS_BASE_URL = 'https://sandbox.asaas.com/api/v3';
    mockFetch();
    responses = [{ status: 200, body: { id: 'cus_123' } }];

    const g = new AsaasGateway();
    const result = await g.createCustomer({
      campaignId: 'campaign-uuid',
      name: 'João Silva',
      email: 'joao@example.com',
      cpfCnpj: '12345678900',
      phone: '11999999999',
    });

    assert.equal(result.providerCustomerId, 'cus_123');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://sandbox.asaas.com/api/v3/customers');
    assert.equal(calls[0].init?.method, 'POST');
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers['access_token'], 'test-key');
    assert.equal(headers['Content-Type'], 'application/json');
    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.name, 'João Silva');
    assert.equal(body.email, 'joao@example.com');
    assert.equal(body.cpfCnpj, '12345678900');
    assert.equal(body.mobilePhone, '11999999999');
    assert.equal(body.externalReference, 'campaign-uuid');
  });

  test('createSubscription maps PIX method and amount correctly', async () => {
    process.env.ASAAS_API_KEY = 'test-key';
    mockFetch();
    responses = [{ status: 200, body: { id: 'sub_456', invoiceUrl: 'https://asaas.com/i/abc' } }];

    const g = new AsaasGateway();
    const result = await g.createSubscription({
      campaignId: 'campaign-uuid',
      providerCustomerId: 'cus_123',
      planId: 'pro',
      amountCents: 29900,
      cycle: 'monthly',
      allowedMethods: ['pix'],
      description: 'Plano Pro',
    });

    assert.equal(result.providerSubscriptionId, 'sub_456');
    assert.equal(result.checkoutUrl, 'https://asaas.com/i/abc');
    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.customer, 'cus_123');
    assert.equal(body.billingType, 'PIX');
    assert.equal(body.value, 299);                  // cents → reais
    assert.equal(body.cycle, 'MONTHLY');
    assert.equal(body.externalReference, 'campaign-uuid:pro');
  });

  test('createSubscription with credit_card maps to CREDIT_CARD', async () => {
    process.env.ASAAS_API_KEY = 'test-key';
    mockFetch();
    responses = [{ status: 200, body: { id: 'sub_789' } }];

    const g = new AsaasGateway();
    await g.createSubscription({
      campaignId: 'c1', providerCustomerId: 'cus_x',
      planId: 'enterprise', amountCents: 99900,
      cycle: 'monthly', allowedMethods: ['credit_card'],
    });
    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.billingType, 'CREDIT_CARD');
    assert.equal(body.value, 999);
  });

  test('createSubscription with undefined method lets customer choose', async () => {
    process.env.ASAAS_API_KEY = 'test-key';
    mockFetch();
    responses = [{ status: 200, body: { id: 'sub_a' } }];

    const g = new AsaasGateway();
    await g.createSubscription({
      campaignId: 'c1', providerCustomerId: 'cus_x',
      planId: 'pro', amountCents: 29900,
      cycle: 'monthly', allowedMethods: ['undefined'],
    });
    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.billingType, 'UNDEFINED');
  });

  test('API error surfaces the Asaas error description', async () => {
    process.env.ASAAS_API_KEY = 'test-key';
    mockFetch();
    responses = [{
      status: 400,
      body: { errors: [{ description: 'Invalid CPF/CNPJ' }] },
    }];

    const g = new AsaasGateway();
    await assert.rejects(
      () => g.createCustomer({ campaignId: 'c1', name: 'A', email: 'a@b.c' }),
      /Invalid CPF\/CNPJ/,
    );
  });

  test('parseWebhook validates token when ASAAS_WEBHOOK_AUTH_TOKEN is set', () => {
    process.env.ASAAS_WEBHOOK_AUTH_TOKEN = 'secret-token-32-chars-long-yes';
    const g = new AsaasGateway();
    const body = Buffer.from(JSON.stringify({
      id: 'evt_1', event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay_1', status: 'RECEIVED', billingType: 'PIX', value: 299, subscription: 'sub_1', customer: 'cus_1' },
    }));

    // Wrong token → rejected
    assert.throws(
      () => g.parseWebhook({ 'asaas-access-token': 'wrong' }, body),
      /invalid_webhook_token/,
    );

    // Correct token → parsed
    const ev = g.parseWebhook({ 'asaas-access-token': 'secret-token-32-chars-long-yes' }, body);
    assert.equal(ev.eventType, 'PAYMENT_RECEIVED');
    assert.equal(ev.status, 'paid');
    assert.equal(ev.paymentMethod, 'pix');
    assert.equal(ev.amountCents, 29900);
    assert.equal(ev.providerSubscriptionId, 'sub_1');
    assert.equal(ev.providerEventId, 'evt_1');

    delete process.env.ASAAS_WEBHOOK_AUTH_TOKEN;
  });

  test('parseWebhook maps OVERDUE status to overdue', () => {
    delete process.env.ASAAS_WEBHOOK_AUTH_TOKEN;
    const g = new AsaasGateway();
    const body = Buffer.from(JSON.stringify({
      id: 'evt_2', event: 'PAYMENT_OVERDUE',
      payment: { id: 'pay_2', status: 'OVERDUE', billingType: 'BOLETO', value: 99, subscription: 'sub_2' },
    }));
    const ev = g.parseWebhook({}, body);
    assert.equal(ev.status, 'overdue');
    assert.equal(ev.paymentMethod, 'boleto');
  });

  test('parseWebhook rejects malformed JSON', () => {
    const g = new AsaasGateway();
    assert.throws(
      () => g.parseWebhook({}, Buffer.from('not json{{{')),
      /invalid_webhook_payload/,
    );
  });
});

describe('PaymentGateway factory', () => {
  test('returns stub when PAYMENT_PROVIDER is unset', () => {
    _resetGatewayCache();
    delete process.env.PAYMENT_PROVIDER;
    const g = getPaymentGateway();
    assert.equal(g.providerName, 'stub');
  });

  test('returns asaas when PAYMENT_PROVIDER=asaas', () => {
    _resetGatewayCache();
    process.env.PAYMENT_PROVIDER = 'asaas';
    const g = getPaymentGateway();
    assert.equal(g.providerName, 'asaas');
    _resetGatewayCache();
    delete process.env.PAYMENT_PROVIDER;
  });

  test('stub gateway returns no-op customer/subscription ids', async () => {
    _resetGatewayCache();
    delete process.env.PAYMENT_PROVIDER;
    const g = getPaymentGateway();
    const c = await g.createCustomer({ campaignId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'A', email: 'a@b.c' });
    assert.match(c.providerCustomerId, /^stub_cus_/);
    const s = await g.createSubscription({
      campaignId: 'aaaaaaaa', providerCustomerId: c.providerCustomerId,
      planId: 'pro', amountCents: 0, cycle: 'monthly', allowedMethods: ['undefined'],
    });
    assert.match(s.providerSubscriptionId, /^stub_sub_/);
    assert.equal(s.checkoutUrl, null);
  });
});
