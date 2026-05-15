import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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
    try {
      const signature = req.header('x-hub-signature-256');
      if (!req.rawBody || !verifySignature(req.rawBody, signature)) {
        console.warn('[Webhook] invalid signature');
        return res.sendStatus(403);
      }

      const payload = req.body as any;
      // Respond 200 immediately per Meta best practices — process async
      res.sendStatus(200);

      // Process entries
      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value ?? {};
          const phoneNumberId = value.metadata?.phone_number_id;
          const messages = value.messages ?? [];

          for (const msg of messages) {
            await ingestInboundMessage(supabaseAdmin, {
              channel: 'whatsapp',
              externalId: msg.from,
              providerMessageId: msg.id,
              text: msg.text?.body ?? `[${msg.type}]`,
              receivedAt: new Date(Number(msg.timestamp) * 1000).toISOString(),
              phoneNumberId,
            });
          }
        }
      }
    } catch (err: any) {
      console.error('[Webhook] error:', err);
      // Response already sent
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
    return;
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
}
