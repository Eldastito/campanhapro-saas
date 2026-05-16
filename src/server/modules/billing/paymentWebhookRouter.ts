import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPaymentGateway } from './paymentGateway';
import { audit } from '../observability/auditLogger';

interface RawRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Public webhook receiver for payment-gateway events (Asaas today; Stripe/Pagar.me
 * later). Authentication is token-based — the gateway implementation validates
 * the incoming header before we touch any data. Mount WITHOUT requireAuth.
 *
 * Always responds 200 quickly per Asaas/Stripe best practice. Errors are logged
 * and surfaced via the audit log + payment_events table so retries from the
 * provider remain idempotent (provider_event_id unique index).
 */
export function createPaymentWebhookRouter(supabase: SupabaseClient): Router {
  const router = Router();

  router.post('/asaas', async (req: RawRequest, res: Response) => {
    const gateway = getPaymentGateway();
    if (gateway.providerName !== 'asaas') {
      // The current configured provider isn't Asaas. Acknowledge anyway so
      // Asaas stops retrying (operator misconfiguration is not the provider's
      // problem) and log for visibility.
      console.warn('[payments/asaas] received but PAYMENT_PROVIDER is', gateway.providerName);
      return res.sendStatus(202);
    }

    if (!req.rawBody) {
      // express.json({ verify }) wasn't applied — defensive failure
      return res.sendStatus(400);
    }

    let event;
    try {
      event = gateway.parseWebhook(req.headers, req.rawBody);
    } catch (err: any) {
      console.warn('[payments/asaas] invalid webhook:', err.message);
      await audit(supabase, {
        actorType: 'webhook',
        action: 'payment.webhook.invalid',
        severity: 'critical',
        metadata: { provider: 'asaas', error: err.message, ip: req.ip },
      });
      return res.sendStatus(403);
    }

    // Respond fast — process inline but keep it cheap
    res.sendStatus(200);

    try {
      // Find the campaign tied to this subscription (if any)
      let campaignId: string | null = null;
      let subscriptionRowId: string | null = null;
      if (event.providerSubscriptionId) {
        const { data } = await supabase
          .from('subscriptions')
          .select('id, campaign_id')
          .eq('asaas_subscription_id', event.providerSubscriptionId)
          .maybeSingle();
        campaignId = data?.campaign_id ?? null;
        subscriptionRowId = data?.id ?? null;
      }

      // Idempotent insert — unique index on (provider, provider_event_id)
      await supabase.from('payment_events').upsert(
        {
          campaign_id: campaignId,
          subscription_id: subscriptionRowId,
          provider: 'asaas',
          provider_event_id: event.providerEventId,
          event_type: event.eventType,
          status: event.status,
          amount_cents: event.amountCents,
          payment_method: event.paymentMethod,
          metadata: event.raw,
        },
        { onConflict: 'provider,provider_event_id', ignoreDuplicates: true },
      );

      // Side-effects on subscription status
      if (subscriptionRowId) {
        const nextStatus =
          event.status === 'paid' ? 'active' :
          event.status === 'overdue' ? 'past_due' :
          event.status === 'failed' ? 'past_due' :
          null;
        if (nextStatus) {
          await supabase
            .from('subscriptions')
            .update({ status: nextStatus, updated_at: new Date().toISOString() })
            .eq('id', subscriptionRowId);
        }
      }

      await audit(supabase, {
        actorType: 'webhook',
        campaignId,
        action: `payment.${event.status}`,
        resourceType: 'subscription',
        resourceId: subscriptionRowId ?? undefined,
        severity: event.status === 'paid' ? 'info' :
                  event.status === 'failed' ? 'error' :
                  event.status === 'overdue' ? 'warn' : 'info',
        metadata: {
          provider: 'asaas',
          eventType: event.eventType,
          paymentMethod: event.paymentMethod,
          amountCents: event.amountCents,
        },
      });
    } catch (err: any) {
      console.error('[payments/asaas] processing error:', err);
      // Response already sent — Asaas will retry if we haven't acked 200,
      // but we did, so log + audit only.
      await audit(supabase, {
        actorType: 'webhook',
        action: 'payment.webhook.process_error',
        severity: 'error',
        metadata: { provider: 'asaas', error: err.message },
      });
    }
  });

  return router;
}
