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
 * shared secret. Two ways to deliver it are accepted, in this order:
 *   - HTTP header `x-webhook-secret` (legacy Node v2 path — supports custom
 *     headers on the outbound webhook call)
 *   - URL query string `?secret=<value>` (Evolution GO path — Go doesn't
 *     let us inject headers on the outbound webhook URL, so the secret
 *     lives in the URL we register)
 */
import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { audit } from '../observability/auditLogger';
import { handleInboundForBot } from '../../../lib/voterBot';

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
      // Optional shared-secret check — accept via header (Node v2) or
      // query string (Evolution GO, which can't inject custom headers).
      if (EVOLUTION_WEBHOOK_SECRET) {
        const fromHeader = req.header('x-webhook-secret') ?? '';
        const fromQuery = typeof req.query?.secret === 'string' ? req.query.secret : '';
        const provided = fromHeader || fromQuery;
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
        .select('id, campaignId, status, apiKey, instanceName')
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
      const rawEvent = (req.body?.event ?? req.body?.eventType ?? '').toString();
      // Normalize the event name to UPPERCASE: Evolution GO sends mixed-case
      // names ("QRCode", "QRTimeout", "Connection", "Message") — we observed
      // this in webhook_events. Stripping dots/underscores too lets us catch
      // legacy Node v2 names ("CONNECTION_UPDATE", "messages.upsert") with
      // the same logic instead of OR-chaining every casing.
      const event = rawEvent.replace(/[._\s-]/g, '').toUpperCase();
      const data = req.body?.data ?? req.body ?? {};

      // Respond 200 fast and process below so Evolution doesn't retry
      res.sendStatus(200);

      if (
        event === 'QRCODE' ||
        event === 'QRCODEUPDATED' ||      // qrcode.updated (Node v2, after normalize)
        event === 'QRCODEUPDATE'
      ) {
        // Evolution GO emits a fresh QR every ~20s while the instance is
        // pending pairing. The payload shape varies — try every key we've
        // seen across versions. Most commonly: data.qrcode (with the
        // "data:image/png;base64," prefix) or data.base64 (raw base64).
        const qr =
          (typeof data?.qrcode === 'string' && data.qrcode) ||
          (typeof data?.base64 === 'string' && data.base64) ||
          (typeof data?.qr === 'string' && data.qr) ||
          (typeof data?.code === 'string' && data.code) ||
          (typeof req.body?.qrcode === 'string' && req.body.qrcode) ||
          null;
        if (qr) {
          await supabaseAdmin
            .from('whatsapp_instances')
            .update({
              lastQRCode: qr,
              status: 'qrcode',
              updatedAt: new Date().toISOString(),
            })
            .eq('id', inst.id);
        }
      } else if (
        event === 'CONNECTION' ||
        event === 'CONNECTIONUPDATE'      // connection.update / CONNECTION_UPDATE
      ) {
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
      } else if (
        event === 'MESSAGE' ||
        event === 'SENDMESSAGE' ||         // SEND_MESSAGE
        event === 'MESSAGESUPSERT'         // messages.upsert / MESSAGES_UPSERT
      ) {
        // Evolution v2 sends one message per event in `data`, but the shape varies.
        const msgs = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : [data];
        // Bot ao vivo: só dispara se a campanha tiver habilitado (trava de segurança).
        const { data: camp } = await supabaseAdmin.from('campaigns')
          .select('"voterBotEnabled", name, "electionRole"').eq('id', campaignId).maybeSingle();
        const botEnabled = !!(camp as any)?.voterBotEnabled && !!(inst as any).apiKey;
        for (const m of msgs) {
          const direction: 'inbound' | 'outbound' = (m?.key?.fromMe || m?.fromMe) ? 'outbound' : 'inbound';
          const remoteJid = String(m?.key?.remoteJid ?? m?.remoteJid ?? '');
          const isGroup = remoteJid.includes('@g.us');
          const externalId = remoteJid.replace(/@.*$/, '');
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
          // pushName is the contact's WhatsApp profile name. Only meaningful
          // for inbound messages — on outbound it'd be our own profile name.
          const rawPushName = direction === 'inbound'
            ? String(m?.pushName ?? m?.notifyName ?? '').trim()
            : '';
          const pushName = rawPushName.length > 0 && rawPushName.length <= 80
            ? rawPushName
            : null;

          await ingestMessage(supabaseAdmin, {
            campaignId,
            whatsappInstanceId: inst.id,
            externalId,
            providerMessageId,
            text,
            receivedAt,
            direction,
            pushName,
          });

          // Bot ao vivo: responde mensagens INBOUND de eleitores (nunca grupos,
          // nunca as próprias mensagens). Fire-and-forget — não trava o webhook.
          if (botEnabled && direction === 'inbound' && !isGroup) {
            const { data: ct } = await supabaseAdmin.from('contacts')
              .select('id').eq('campaignId', campaignId).eq('phone', externalId).maybeSingle();
            void handleInboundForBot(supabaseAdmin, {
              campaignId,
              instanceId: inst.id,
              instanceName: (inst as any).instanceName || instanceName,
              apiKey: (inst as any).apiKey,
              phone: externalId,
              contactId: (ct as any)?.id ?? null,
              text,
              candidato: (camp as any)?.name ?? null,
              cargo: (camp as any)?.electionRole ?? null,
            });
          }
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
    pushName: string | null;
  },
) {
  const fallbackName = `WhatsApp ${params.externalId}`;
  // Try to match existing contact by phone; auto-create if missing
  const { data: existing } = await supabase
    .from('contacts')
    .select('id, name')
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
        name: params.pushName ?? fallbackName,
        source: params.direction === 'inbound' ? 'whatsapp_inbound' : 'whatsapp_outbound',
      })
      .select('id')
      .single();
    contactId = created?.id ?? null;
  } else if (params.pushName && isPlaceholderName(existing?.name)) {
    // Backfill the contact name once we learn it, but only if it still
    // carries our placeholder so we don't overwrite a name the user
    // edited manually in the CRM.
    await supabase
      .from('contacts')
      .update({ name: params.pushName })
      .eq('id', contactId);
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

function isPlaceholderName(name: unknown): boolean {
  return typeof name === 'string' && /^WhatsApp \d+$/.test(name);
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
