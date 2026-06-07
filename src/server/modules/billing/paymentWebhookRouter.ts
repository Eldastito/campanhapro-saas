import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPaymentGateway } from './paymentGateway';
import { audit } from '../observability/auditLogger';
import { sendPaymentConfirmedEmail, sendPaymentOverdueEmail } from '../email/emailService';

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
          .select('id, "campaignId"')
          .eq('asaasSubscriptionId', event.providerSubscriptionId)
          .maybeSingle();
        campaignId = data?.campaignId ?? null;
        subscriptionRowId = data?.id ?? null;
      }

      // Idempotent insert — unique index on (provider, provider_event_id)
      await supabase.from('payment_events').upsert(
        {
          campaignId: campaignId,
          subscriptionId: subscriptionRowId,
          provider: 'asaas',
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          status: event.status,
          amountCents: event.amountCents,
          paymentMethod: event.paymentMethod,
          metadata: event.raw,
        },
        { onConflict: 'provider,providerEventId', ignoreDuplicates: true },
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
            .update({ status: nextStatus, updatedAt: new Date().toISOString() })
            .eq('id', subscriptionRowId);
        }

        // Pagamento CONFIRMADO → libera o acesso da campanha (gate do onboarding pago):
        // campaign_configs.status 'pending_payment' → 'active' + aplica os módulos do plano.
        if (event.status === 'paid' && campaignId) {
          try {
            const { data: subRow } = await supabase
              .from('subscriptions').select('"planId"').eq('id', subscriptionRowId).maybeSingle();
            const planId = (subRow as any)?.planId as string | undefined;
            let features: string[] = [];
            if (planId) {
              const { data: plan } = await supabase.from('plans').select('features').eq('id', planId).maybeSingle();
              features = (plan as any)?.features ?? [];
            }
            const planTier = planId === 'enterprise' ? 'completo' : 'limitado';
            await supabase.from('campaign_configs').upsert(
              { id: campaignId, status: 'active', planTier, features },
              { onConflict: 'id' },
            );
          } catch (e) {
            console.warn('[webhook] ativar campaign_configs falhou:', e);
          }
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

      // Notify the campaign admin via email (idempotent via providerEventId)
      if (campaignId && subscriptionRowId && event.providerEventId &&
          (event.status === 'paid' || event.status === 'overdue')) {
        try {
          const { data: adminUser } = await supabase
            .from('users')
            .select('email, name')
            .eq('campaignId', campaignId)
            .eq('type', 'Admin')
            .order('createdAt', { ascending: true })
            .limit(1)
            .maybeSingle();

          const { data: sub } = await supabase
            .from('subscriptions')
            .select('"planId"')
            .eq('id', subscriptionRowId)
            .maybeSingle();
          const { data: plan } = sub?.planId
            ? await supabase.from('plans').select('name').eq('id', sub.planId).maybeSingle()
            : { data: null };

          if (adminUser?.email && plan?.name && event.amountCents != null) {
            const sender = event.status === 'paid' ? sendPaymentConfirmedEmail : sendPaymentOverdueEmail;
            await sender(supabase, {
              campaignId,
              email: adminUser.email,
              name: adminUser.name ?? adminUser.email.split('@')[0],
              planName: plan.name,
              amountCents: event.amountCents,
              paymentMethod: event.paymentMethod,
              paymentEventId: event.providerEventId,
            } as any);
          }
        } catch (err: any) {
          console.warn('[payments/asaas] email notification failed:', err.message);
        }
      }
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
