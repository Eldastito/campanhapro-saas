// Omnichannel messaging client.
// Routes outbound messages to the right provider:
//   - 'meta'      → WhatsApp Cloud API (single campaign-wide number, env-configured)
//   - 'evolution' → Self-hosted Evolution API (per-instance, multiple numbers per campaign)
//
// IMPORTANT: Never use whatsapp-web.js in production SaaS. Evolution API uses
// Baileys under the hood; whatsapp-web.js is explicitly disallowed.

import { SupabaseClient } from '@supabase/supabase-js';
import { sendText as evolutionSendText } from './evolutionApiClient';

const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_API_VERSION = process.env.META_API_VERSION || 'v19.0';

export type Channel = 'whatsapp' | 'instagram';
export type Provider = 'meta' | 'evolution';

export interface OutboundMessage {
  campaignId: string;
  channel: Channel;
  to: string;
  text?: string;
  templateName?: string;
  templateParams?: string[];
  mediaUrl?: string;
  // Provider routing — defaults to 'evolution' for whatsapp if an instance is given,
  // otherwise falls back to 'meta' for backward compatibility.
  provider?: Provider;
  whatsappInstanceId?: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider?: Provider;
}

export async function sendMessage(
  msg: OutboundMessage,
  supabase?: SupabaseClient,
): Promise<SendResult> {
  // ---------- WhatsApp via Evolution API ----------
  if (msg.channel === 'whatsapp' && msg.provider === 'evolution') {
    if (!msg.whatsappInstanceId || !supabase) {
      return { success: false, error: 'evolution_instance_required', provider: 'evolution' };
    }
    const { data: inst } = await supabase
      .from('whatsapp_instances')
      .select('instanceName, apiKey, status, campaignId')
      .eq('id', msg.whatsappInstanceId)
      .maybeSingle();

    if (!inst || inst.campaignId !== msg.campaignId) {
      return { success: false, error: 'instance_not_found', provider: 'evolution' };
    }
    if (inst.status !== 'connected') {
      return { success: false, error: `instance_${inst.status}`, provider: 'evolution' };
    }
    if (!inst.apiKey) {
      return { success: false, error: 'instance_missing_api_key', provider: 'evolution' };
    }
    if (!msg.text) {
      return { success: false, error: 'evolution_text_required', provider: 'evolution' };
    }

    try {
      const result = await evolutionSendText(inst.instanceName, inst.apiKey, msg.to, msg.text);
      return { success: true, messageId: result.messageId, provider: 'evolution' };
    } catch (err: any) {
      return { success: false, error: `evolution_send_failed:${err.message}`, provider: 'evolution' };
    }
  }

  // ---------- WhatsApp via Meta Cloud API (legacy / fallback) ----------
  if (msg.channel === 'whatsapp') {
    if (!WA_PHONE_NUMBER_ID || !META_ACCESS_TOKEN) {
      return { success: false, error: 'channels_not_configured', provider: 'meta' };
    }
    const body = msg.templateName
      ? {
          messaging_product: 'whatsapp',
          to: msg.to,
          type: 'template',
          template: {
            name: msg.templateName,
            language: { code: 'pt_BR' },
            components: msg.templateParams?.length
              ? [{ type: 'body', parameters: msg.templateParams.map(v => ({ type: 'text', text: v })) }]
              : [],
          },
        }
      : { messaging_product: 'whatsapp', to: msg.to, type: 'text', text: { body: msg.text } };

    const res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${WA_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${META_ACCESS_TOKEN}` },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) return { success: false, error: `wa_api_error_${res.status}`, provider: 'meta' };
    const data = (await res.json()) as { messages?: [{ id: string }] };
    return { success: true, messageId: data.messages?.[0]?.id, provider: 'meta' };
  }

  return { success: false, error: 'channel_not_implemented' };
}
