/**
 * Provider-agnostic payment gateway interface.
 *
 * The CampanhaPro billing service code never imports a specific provider —
 * it asks `getPaymentGateway()` for an implementation. This lets us swap
 * Asaas ↔ Pagar.me ↔ Stripe by changing PAYMENT_PROVIDER without touching
 * the billing logic.
 *
 * Defaults to `stub` when PAYMENT_PROVIDER is unset — useful for local dev
 * and CI. Stub flips subscriptions to active immediately without any HTTP.
 */
import { AsaasGateway } from './asaasGateway';

export type PaymentMethod = 'pix' | 'credit_card' | 'debit_card' | 'boleto' | 'undefined';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'overdue';
export type BillingCycle = 'monthly' | 'yearly';

export interface CreateCustomerParams {
  campaignId: string;
  name: string;
  email: string;
  cpfCnpj?: string;
  phone?: string;
}

export interface CreateCustomerResult {
  providerCustomerId: string;
}

export interface CreateSubscriptionParams {
  campaignId: string;
  providerCustomerId: string;
  planId: string;
  amountCents: number;
  cycle: BillingCycle;
  description?: string;
  /** Allowed methods. Order matters; first method becomes the default. */
  allowedMethods: PaymentMethod[];
}

export interface CreateSubscriptionResult {
  providerSubscriptionId: string;
  /** URL the user is redirected to in order to confirm payment (Asaas customer area, Stripe Checkout, etc) */
  checkoutUrl: string | null;
  /** When applicable (PIX one-shots), the QR code payload. */
  pixQrCode?: string;
  pixCopyPaste?: string;
}

export interface CancelSubscriptionParams {
  providerSubscriptionId: string;
}

export interface NormalizedWebhookEvent {
  providerEventId: string | null;
  eventType: string;
  status: PaymentStatus;
  paymentMethod: PaymentMethod;
  amountCents: number | null;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  raw: any;
}

export interface PaymentGateway {
  readonly providerName: 'asaas' | 'stripe' | 'pagarme' | 'stub';

  createCustomer(params: CreateCustomerParams): Promise<CreateCustomerResult>;

  createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult>;

  cancelSubscription(params: CancelSubscriptionParams): Promise<void>;

  /**
   * Validate raw webhook + extract the normalized fields. Should throw on
   * invalid signature / token so the route handler can return 403.
   */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): NormalizedWebhookEvent;
}

class StubGateway implements PaymentGateway {
  readonly providerName = 'stub' as const;

  async createCustomer(params: CreateCustomerParams): Promise<CreateCustomerResult> {
    return { providerCustomerId: `stub_cus_${params.campaignId.slice(0, 8)}` };
  }

  async createSubscription(_params: CreateSubscriptionParams): Promise<CreateSubscriptionResult> {
    return {
      providerSubscriptionId: `stub_sub_${Date.now()}`,
      checkoutUrl: null,
    };
  }

  async cancelSubscription(): Promise<void> {
    // no-op
  }

  parseWebhook(): NormalizedWebhookEvent {
    throw new Error('stub_gateway_has_no_webhook');
  }
}

let cached: PaymentGateway | null = null;

export function getPaymentGateway(): PaymentGateway {
  if (cached) return cached;
  const provider = (process.env.PAYMENT_PROVIDER ?? 'stub').toLowerCase();
  switch (provider) {
    case 'asaas':
      cached = new AsaasGateway();
      break;
    case 'stub':
    default:
      cached = new StubGateway();
  }
  return cached;
}

/** For tests — clears the singleton so a different PAYMENT_PROVIDER takes effect. */
export function _resetGatewayCache() {
  cached = null;
}
