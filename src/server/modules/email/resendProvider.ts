/**
 * Resend implementation. https://resend.com — free tier 3k/month, $20 for 50k.
 *
 * Env:
 *   RESEND_API_KEY   — required. From dashboard → API Keys.
 *   EMAIL_FROM       — required. e.g. "CampanhaPro <noreply@campanhapro.app>"
 *                      The domain must be verified in Resend.
 */
import type { EmailProvider, SendEmailParams, SendEmailResult } from './emailProvider';
import { defaultFrom } from './emailProvider';

const BASE_URL = 'https://api.resend.com';

export class ResendProvider implements EmailProvider {
  readonly providerName = 'resend' as const;

  private apiKey(): string {
    const k = process.env.RESEND_API_KEY;
    if (!k) throw new Error('RESEND_API_KEY not configured');
    return k;
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    try {
      const body = {
        from: params.from ?? defaultFrom(),
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
        reply_to: params.replyTo,
      };
      const res = await fetch(`${BASE_URL}/emails`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: any = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { /* keep as text */ }

      if (!res.ok) {
        // Retry-After em segundos → ms (Resend segue RFC 6585); cap 60s
        // pra não bloquear worker por muito tempo. Se ausente/inválido,
        // caller usa próprio default.
        let retryAfterMs: number | undefined;
        if (res.status === 429) {
          const raw = res.headers.get('retry-after');
          if (raw) {
            const n = Number(raw);
            if (Number.isFinite(n) && n > 0) {
              retryAfterMs = Math.min(n * 1000, 60_000);
            }
          }
        }
        return {
          providerMessageId: null,
          ok: false,
          error: parsed?.message ?? parsed?.error ?? `resend_http_${res.status}`,
          status: res.status,
          retryAfterMs,
        };
      }

      return { providerMessageId: parsed?.id ?? null, ok: true, status: res.status };
    } catch (err: any) {
      return { providerMessageId: null, ok: false, error: err.message };
    }
  }
}
