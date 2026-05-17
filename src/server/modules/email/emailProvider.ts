/**
 * Provider-agnostic email gateway. Defaults to `stub` which logs to console.
 * Set EMAIL_PROVIDER=resend + RESEND_API_KEY to enable real delivery.
 */
import { ResendProvider } from './resendProvider';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;          // optional override; defaults to EMAIL_FROM
  replyTo?: string;
}

export interface SendEmailResult {
  providerMessageId: string | null;
  /** True if the provider accepted the message; false otherwise (caller writes error). */
  ok: boolean;
  error?: string;
}

export interface EmailProvider {
  readonly providerName: 'resend' | 'stub' | 'ses';
  sendEmail(params: SendEmailParams): Promise<SendEmailResult>;
}

class StubProvider implements EmailProvider {
  readonly providerName = 'stub' as const;

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    console.log('[email/stub]', { to: params.to, subject: params.subject });
    return { providerMessageId: `stub_${Date.now()}`, ok: true };
  }
}

let cached: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  const provider = (process.env.EMAIL_PROVIDER ?? 'stub').toLowerCase();
  switch (provider) {
    case 'resend':
      cached = new ResendProvider();
      break;
    case 'stub':
    default:
      cached = new StubProvider();
  }
  return cached;
}

export function _resetEmailProviderCache() {
  cached = null;
}

export function defaultFrom(): string {
  return process.env.EMAIL_FROM ?? 'CampanhaPro <noreply@campanhapro.app>';
}
