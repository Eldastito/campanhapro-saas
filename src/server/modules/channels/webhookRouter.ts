import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { audit } from '../observability/auditLogger';

interface RawRequest extends Request {
  rawBody?: Buffer;
}

const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || '';

function verifySignature(rawBody: Buffer, signatureHeader?: string): boolean {
  if (!META_APP_SECRET || !signatureHeader) return false;
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', META_APP_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createWebhookRouter(supabaseAdmin: SupabaseClient) {
  const router = Router();

  /**
   * Meta verification handshake (GET).
   * Called once when registering the webhook URL.
   */
  router.get('/meta', (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === META_WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(String(challenge ?? ''));
    }
    return res.sendStatus(403);
  });

  /**
   * Meta inbound webhook (POST). Validates X-Hub-Signature-256
   * and ingests incoming messages.
   *
   * Important: this router MUST be mounted with access to req.rawBody
   * (configured via express.json({ verify }) in server.ts).
   */
  router.post('/meta', async (req: RawRequest, res: Response) => {
    const payloadHash = req.rawBody
      ? crypto.createHash('sha256').update(req.rawBody).digest('hex')
      : crypto.randomBytes(16).toString('hex');
    try {
      const signature = req.header('x-hub-signature-256');
      const valid = !!req.rawBody && verifySignature(req.rawBody, signature);
      if (!valid) {
        console.warn('[Webhook] invalid signature');
        await recordWebhookEvent(supabaseAdmin, {
          source: 'meta', signatureValid: false, payloadHash,
          error: 'invalid_signature',
        });
        await audit(supabaseAdmin, {
          actorType: 'webhook',
          action: 'webhook.meta.signature_invalid',
          severity: 'critical',
          metadata: { ip: req.ip, ua: req.get('user-agent') },
        });
        return res.sendStatus(403);
      }

      const payload = req.body as any;

      // Replay protection: reject entries older than 5 minutes
      // (Meta sends epoch-second timestamps in entry.time).
      const REPLAY_WINDOW_MS = 5 * 60 * 1000;
      const nowMs = Date.now();
      const oldestAllowedMs = nowMs - REPLAY_WINDOW_MS;
      const stale = (payload.entry ?? []).some(
        (e: any) => typeof e.time === 'number' && e.time * 1000 < oldestAllowedMs,
      );
      if (stale) {
        await recordWebhookEvent(supabaseAdmin, {
          source: 'meta', signatureValid: true, payloadHash,
          error: 'stale_payload',
        });
        await audit(supabaseAdmin, {
          actorType: 'webhook',
          action: 'webhook.meta.stale',
          severity: 'warn',
          metadata: { ip: req.ip },
        });
        return res.sendStatus(408);
      }

      // Respond 200 immediately per Meta best practices — process async
      res.sendStatus(200);

      // Process entries
      let ingestedCampaign: string | null = null;
      let processedCount = 0;
      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value ?? {};
          const phoneNumberId = value.metadata?.phone_number_id;
          const messages = value.messages ?? [];

          for (const msg of messages) {
            const outcome = await ingestInboundMessage(supabaseAdmin, {
              channel: 'whatsapp',
              externalId: msg.from,
              providerMessageId: msg.id,
              text: msg.text?.body ?? `[${msg.type}]`,
              receivedAt: new Date(Number(msg.timestamp) * 1000).toISOString(),
              phoneNumberId,
            });
            if (outcome?.campaignId) ingestedCampaign = outcome.campaignId;
            processedCount++;
          }
        }
      }

      await recordWebhookEvent(supabaseAdmin, {
        source: 'meta', signatureValid: true, payloadHash,
        campaignId: ingestedCampaign,
        eventType: payload.object ?? 'unknown',
        processedAt: new Date().toISOString(),
      });
      await audit(supabaseAdmin, {
        actorType: 'webhook',
        campaignId: ingestedCampaign,
        action: 'webhook.meta.received',
        severity: 'info',
        metadata: { processedCount },
      });
    } catch (err: any) {
      console.error('[Webhook] error:', err);
      await recordWebhookEvent(supabaseAdmin, {
        source: 'meta', signatureValid: true, payloadHash,
        error: err?.message ?? 'processing_error',
      });
    }
  });

  return router;
}

async function ingestInboundMessage(
  supabase: SupabaseClient,
  params: {
    channel: 'whatsapp' | 'instagram';
    externalId: string;
    providerMessageId: string;
    text: string;
    receivedAt: string;
    phoneNumberId?: string;
  }
) {
  // Resolve campaign by phone_number_id mapping
  const { data: mapping } = await supabase
    .from('channel_phone_mappings')
    .select('campaignId')
    .eq('phoneNumberId', params.phoneNumberId ?? '')
    .maybeSingle();

  const campaignId = mapping?.campaignId;
  if (!campaignId) {
    console.warn('[Webhook] no campaign mapped for phone', params.phoneNumberId);
    return null;
  }

  // Try to match an existing contact by phone
  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('campaignId', campaignId)
    .eq('phone', params.externalId)
    .maybeSingle();

  const now = params.receivedAt;
  const { data: convoRow } = await supabase
    .from('channel_conversations')
    .upsert(
      {
        campaignId,
        channel: params.channel,
        contactId: contact?.id ?? null,
        externalId: params.externalId,
        lastMessageAt: now,
        lastInboundAt: now,
        updatedAt: now,
      },
      { onConflict: 'campaignId,channel,externalId' }
    )
    .select('id')
    .single();

  if (convoRow?.id) {
    await supabase.from('channel_messages').insert({
      conversationId: convoRow.id,
      campaignId,
      direction: 'inbound',
      channel: params.channel,
      providerMessageId: params.providerMessageId,
      body: params.text,
      createdAt: now,
    });
  }

  return { campaignId };
}

async function recordWebhookEvent(
  supabase: SupabaseClient,
  params: {
    source: string;
    signatureValid: boolean;
    payloadHash: string;
    campaignId?: string | null;
    eventType?: string;
    processedAt?: string;
    error?: string;
  }
) {
  try {
    await supabase.from('webhook_events').upsert(
      {
        source: params.source,
        signature_valid: params.signatureValid,
        payload_hash: params.payloadHash,
        campaign_id: params.campaignId ?? null,
        event_type: params.eventType ?? null,
        processed_at: params.processedAt ?? null,
        error: params.error ?? null,
      },
      { onConflict: 'source,payload_hash', ignoreDuplicates: true },
    );
  } catch (err) {
    console.error('[Webhook] event log failed:', err);
  }
}
