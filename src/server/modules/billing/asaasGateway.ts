/**
 * Asaas payment gateway implementation.
 *
 * API docs: https://docs.asaas.com (v3 REST API)
 *
 * Env vars:
 *   ASAAS_API_KEY              — required. Sandbox keys start with $aact_YTU5...
 *   ASAAS_BASE_URL             — optional. Defaults to https://api.asaas.com/v3
 *                                Set to https://sandbox.asaas.com/api/v3 for sandbox.
 *   ASAAS_WEBHOOK_AUTH_TOKEN   — optional. If set, every incoming webhook must
 *                                carry header `asaas-access-token` matching it.
 */
import crypto from 'crypto';
import type {
  PaymentGateway,
  CreateCustomerParams, CreateCustomerResult,
  CreateSubscriptionParams, CreateSubscriptionResult,
  CancelSubscriptionParams,
  NormalizedWebhookEvent,
  PaymentMethod, PaymentStatus,
} from './paymentGateway';

function baseUrl(): string {
  return process.env.ASAAS_BASE_URL ?? 'https://api.asaas.com/v3';
}

/** Map our internal payment method enum to Asaas billingType */
const METHOD_TO_ASAAS: Record<PaymentMethod, string> = {
  pix: 'PIX',
  credit_card: 'CREDIT_CARD',
  debit_card: 'CREDIT_CARD',          // Asaas treats both via CREDIT_CARD with subType
  boleto: 'BOLETO',
  undefined: 'UNDEFINED',             // lets the customer choose at checkout
};

const ASAAS_STATUS_TO_NORMALIZED: Record<string, PaymentStatus> = {
  PENDING: 'pending',
  RECEIVED: 'paid',
  CONFIRMED: 'paid',
  RECEIVED_IN_CASH: 'paid',
  REFUNDED: 'refunded',
  REFUND_REQUESTED: 'refunded',
  REFUND_IN_PROGRESS: 'refunded',
  OVERDUE: 'overdue',
  CHARGEBACK_REQUESTED: 'failed',
  CHARGEBACK_DISPUTE: 'failed',
  AWAITING_CHARGEBACK_REVERSAL: 'failed',
  DUNNING_REQUESTED: 'overdue',
  DUNNING_RECEIVED: 'paid',
  AWAITING_RISK_ANALYSIS: 'pending',
};

const ASAAS_BILLING_TO_NORMALIZED: Record<string, PaymentMethod> = {
  PIX: 'pix',
  CREDIT_CARD: 'credit_card',
  BOLETO: 'boleto',
  UNDEFINED: 'undefined',
};

export class AsaasGateway implements PaymentGateway {
  readonly providerName = 'asaas' as const;

  private apiKey(): string {
    const key = process.env.ASAAS_API_KEY;
    if (!key) throw new Error('ASAAS_API_KEY not configured');
    return key;
  }

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'access_token': this.apiKey(),
        'User-Agent': 'CampanhaPro/1.0',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* leave as text */ }
    if (!res.ok) {
      const msg = parsed?.errors?.[0]?.description ?? parsed?.message ?? `asaas_http_${res.status}`;
      throw new Error(msg);
    }
    return parsed as T;
  }

  async createCustomer(params: CreateCustomerParams): Promise<CreateCustomerResult> {
    const body: Record<string, any> = {
      name: params.name,
      email: params.email,
      externalReference: params.campaignId,
    };
    if (params.cpfCnpj) body.cpfCnpj = params.cpfCnpj;
    if (params.phone) body.mobilePhone = params.phone;

    const data = await this.request<{ id: string }>('POST', '/customers', body);
    return { providerCustomerId: data.id };
  }

  /** Atualiza um cliente existente (ex.: preencher o CPF que faltava). */
  async updateCustomer(params: { providerCustomerId: string; name?: string; email?: string; cpfCnpj?: string; phone?: string }): Promise<void> {
    const body: Record<string, any> = {};
    if (params.name) body.name = params.name;
    if (params.email) body.email = params.email;
    if (params.cpfCnpj) body.cpfCnpj = params.cpfCnpj;
    if (params.phone) body.mobilePhone = params.phone;
    if (Object.keys(body).length === 0) return;
    await this.request('POST', `/customers/${params.providerCustomerId}`, body);
  }

  async createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult> {
    // Asaas wants the next due date in YYYY-MM-DD.
    // Use tomorrow so the user has time to pay the first invoice.
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const nextDueDate = tomorrow.toISOString().slice(0, 10);

    const billingType = params.allowedMethods[0]
      ? METHOD_TO_ASAAS[params.allowedMethods[0]]
      : 'UNDEFINED';

    const body = {
      customer: params.providerCustomerId,
      billingType,
      nextDueDate,
      value: params.amountCents / 100,
      cycle: params.cycle === 'yearly' ? 'YEARLY' : 'MONTHLY',
      description: params.description ?? `Assinatura CampanhaPro — plano ${params.planId}`,
      externalReference: `${params.campaignId}:${params.planId}`,
    };

    const data = await this.request<{ id: string }>('POST', '/subscriptions', body);

    // A assinatura NÃO retorna o link de pagamento direto — ele vive na 1ª
    // cobrança gerada. Buscamos a primeira cobrança para obter o invoiceUrl
    // (página de pagamento) e, se for PIX, o QR Code + copia-e-cola.
    let checkoutUrl: string | null = null;
    let pixQrCode: string | undefined;
    let pixCopyPaste: string | undefined;
    // A 1ª cobrança da assinatura pode levar 1-2s pra ser gerada — tenta algumas vezes.
    let first: { id: string; invoiceUrl?: string } | undefined;
    for (let attempt = 0; attempt < 4 && !first; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 900));
      try {
        const payments = await this.request<{ data?: Array<{ id: string; invoiceUrl?: string }> }>(
          'GET', `/subscriptions/${data.id}/payments`,
        );
        first = payments?.data?.[0];
      } catch { /* tenta de novo */ }
    }
    if (first) {
      checkoutUrl = first.invoiceUrl ?? null;
      if (billingType === 'PIX') {
        try {
          const pix = await this.request<{ encodedImage?: string; payload?: string }>(
            'GET', `/payments/${first.id}/pixQrCode`,
          );
          pixQrCode = pix?.encodedImage;
          pixCopyPaste = pix?.payload;
        } catch { /* PIX QR é opcional — o invoiceUrl já permite pagar */ }
      }
    }

    return {
      providerSubscriptionId: data.id,
      checkoutUrl,
      pixQrCode,
      pixCopyPaste,
    };
  }

  async cancelSubscription(params: CancelSubscriptionParams): Promise<void> {
    await this.request<unknown>('DELETE', `/subscriptions/${params.providerSubscriptionId}`);
  }

  parseWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): NormalizedWebhookEvent {
    // Auth check: if ASAAS_WEBHOOK_AUTH_TOKEN is configured, validate header
    const expectedToken = process.env.ASAAS_WEBHOOK_AUTH_TOKEN;
    if (expectedToken) {
      const received = headers['asaas-access-token'];
      const got = Array.isArray(received) ? received[0] : received;
      if (!got || !timingSafeEqual(got, expectedToken)) {
        throw new Error('invalid_webhook_token');
      }
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new Error('invalid_webhook_payload');
    }

    const payment = payload.payment ?? {};
    return {
      providerEventId: payload.id ?? payment.id ?? null,
      eventType: payload.event ?? 'UNKNOWN',
      status: ASAAS_STATUS_TO_NORMALIZED[payment.status] ?? 'pending',
      paymentMethod: ASAAS_BILLING_TO_NORMALIZED[payment.billingType] ?? 'undefined',
      amountCents: typeof payment.value === 'number' ? Math.round(payment.value * 100) : null,
      providerSubscriptionId: payment.subscription ?? null,
      providerCustomerId: payment.customer ?? null,
      raw: payload,
    };
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
