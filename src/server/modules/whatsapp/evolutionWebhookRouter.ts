/**
 * Evolution API webhook receiver — handles inbound WhatsApp messages and
 * connection-state updates from a self-hosted Evolution server.
 *
 * Mounted under: POST /api/webhooks/evolution/:instanceName
 *
 * Authentication: Evolution doesn't sign payloads by default. We rely on:
 *   1. The instanceName URL segment matching a row we created
 *   2. The instance still being non-deleted in our DB
 *   3. Standard webhookLimiter rate limiting (configured in server.ts)
 *
 * If EVOLUTION_WEBHOOK_SECRET is set, we additionally require a matching
 * header — Evolution v2 supports this via the `webhook.headers` field.
 */
import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { audit } from '../observability/auditLogger';

interface RawRequest extends Request {
  rawBody?: Buffer;
}

const EVOLUTION_WEBHOOK_SECRET = process.env.EVOLUTION_WEBHOOK_SECRET;

export function createEvolutionWebhookRouter(supabaseAdmin: SupabaseClient) {
  const router = Router();

  router.post('/evolution/:instanceName', async (req: RawRequest, res: Response) => {
    const { instanceName } = req.params;
    const payloadHash = req.rawBody
      ? crypto.createHash('sha256').update(req.rawBody).digest('hex')
      : crypto.randomBytes(16).toString('hex');

    try {
      // Optional shared-secret check
      if (EVOLUTION_WEBHOOK_SECRET) {
        const provided = req.header('x-webhook-secret') ?? '';
        const a = Buffer.from(provided);
        const b = Buffer.from(EVOLUTION_WEBHOOK_SECRET);
        const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
        if (!ok) {
          await audit(supabaseAdmin, {
            actorType: 'webhook',
            action: 'webhook.evolution.unauthorized',
            severity: 'critical',
            metadata: { ip: req.ip, instanceName },
          });
          return res.sendStatus(403);
        }
      }

      // Resolve instance → campaign
      const { data: inst } = await supabaseAdmin
        .from('whatsapp_instances')
        .select('id, campaignId, status')
        .eq('instanceName', instanceName)
        .maybeSingle();

      if (!inst || inst.status === 'deleted') {
        await recordWebhookEvent(supabaseAdmin, {
          source: 'evolution', signatureValid: true, payloadHash,
          error: 'unknown_instance',
        });
        return res.sendStatus(404);
      }

      const campaignId = inst.campaignId;
      const event = (req.body?.event ?? req.body?.eventType ?? '').toString();
      const data = req.body?.data ?? req.body ?? {};

      // Respond 200 fast and process below so Evolution doesn't retry
      res.sendStatus(200);

      if (event === 'connection.update' || event === 'CONNECTION_UPDATE') {
        const state: string = data?.state ?? data?.status ?? '';
        const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        if (state === 'open') {
          updates.status = 'connected';
          updates.lastConnectedAt = new Date().toISOString();
          updates.lastQRCode = null;
          if (data?.wuid || data?.number) {
            updates.phoneNumber = String(data.wuid ?? data.number).replace(/\D+/g, '');
          }
        } else if (state === 'close') {
          updates.status = 'disconnected';
        } else if (state === 'connecting') {
          updates.status = 'qrcode';
        }
        await supabaseAdmin.from('whatsapp_instances').update(updates).eq('id', inst.id);
      } else if (event === 'messages.upsert' || event === 'MESSAGES_UPSERT') {
        // Evolution v2 sends one message per event in `data`, but the shape varies.
        const msgs = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : [data];
        for (const m of msgs) {
          const direction: 'inbound' | 'outbound' = (m?.key?.fromMe || m?.fromMe) ? 'outbound' : 'inbound';
          const externalId = String(m?.key?.remoteJid ?? m?.remoteJid ?? '').replace(/@.*$/, '');
          if (!externalId) continue;
          const text =
            m?.message?.conversation ??
            m?.message?.extendedTextMessage?.text ??
            m?.body ??
            m?.text ??
            '[mídia ou mensagem não-texto]';
          const providerMessageId = String(m?.key?.id ?? m?.id ?? crypto.randomBytes(8).toString('hex'));
          const tsRaw = Number(m?.messageTimestamp ?? m?.timestamp ?? 0);
          const receivedAt = tsRaw > 0
            ? new Date(tsRaw < 1e12 ? tsRaw * 1000 : tsRaw).toISOString()
            : new Date().toISOString();

          await ingestMessage(supabaseAdmin, {
            campaignId,
            whatsappInstanceId: inst.id,
            externalId,
            providerMessageId,
            text,
            receivedAt,
            direction,
          });
        }
      }

      await recordWebhookEvent(supabaseAdmin, {
        source: 'evolution', signatureValid: true, payloadHash,
        campaignId, eventType: event, processedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[Evolution webhook] error:', err);
      await recordWebhookEvent(supabaseAdmin, {
        source: 'evolution', signatureValid: true, payloadHash,
        error: err?.message ?? 'processing_error',
      });
    }
  });

  return router;
}

async function ingestMessage(
  supabase: SupabaseClient,
  params: {
    campaignId: string;
    whatsappInstanceId: string;
    externalId: string;
    providerMessageId: string;
    text: string;
    receivedAt: string;
    direction: 'inbound' | 'outbound';
  },
) {
  // Try to match existing contact by phone; auto-create if missing
  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('campaignId', params.campaignId)
    .eq('phone', params.externalId)
    .maybeSingle();

  let contactId = existing?.id ?? null;
  if (!contactId) {
    const { data: created } = await supabase
      .from('contacts')
      .insert({
        campaignId: params.campaignId,
        phone: params.externalId,
        name: `WhatsApp ${params.externalId}`,
        source: params.direction === 'inbound' ? 'whatsapp_inbound' : 'whatsapp_outbound',
      })
      .select('id')
      .single();
    contactId = created?.id ?? null;
  }

  const now = params.receivedAt;
  const convoPayload: Record<string, unknown> = {
    campaignId: params.campaignId,
    channel: 'whatsapp',
    provider: 'evolution',
    whatsappInstanceId: params.whatsappInstanceId,
    contactId,
    externalId: params.externalId,
    lastMessageAt: now,
    updatedAt: now,
  };
  // lastInboundAt only advances when the contact writes to us. Outbound
  // messages still bump lastMessageAt so the conversation rises in the list.
  if (params.direction === 'inbound') convoPayload.lastInboundAt = now;

  const { data: convoRow } = await supabase
    .from('channel_conversations')
    .upsert(convoPayload, { onConflict: 'campaignId,channel,externalId' })
    .select('id')
    .single();

  if (convoRow?.id) {
    // Dedup: if the same provider message id was already recorded
    // (e.g. outbound sent via /channels/send already inserted it),
    // skip to avoid duplicates.
    const { data: dup } = await supabase
      .from('channel_messages')
      .select('id')
      .eq('conversationId', convoRow.id)
      .eq('providerMessageId', params.providerMessageId)
      .maybeSingle();
    if (dup) return;

    await supabase.from('channel_messages').insert({
      conversationId: convoRow.id,
      campaignId: params.campaignId,
      direction: params.direction,
      channel: 'whatsapp',
      provider: 'evolution',
      whatsappInstanceId: params.whatsappInstanceId,
      providerMessageId: params.providerMessageId,
      body: params.text,
      createdAt: now,
    });
  }
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
  },
) {
  try {
    await supabase.from('webhook_events').upsert(
      {
        source: params.source,
        signatureValid: params.signatureValid,
        payloadHash: params.payloadHash,
        campaignId: params.campaignId ?? null,
        eventType: params.eventType ?? null,
        processedAt: params.processedAt ?? null,
        error: params.error ?? null,
      },
      { onConflict: 'source,payloadHash', ignoreDuplicates: true },
    );
  } catch (err) {
    console.error('[Evolution webhook] event log failed:', err);
  }
}
