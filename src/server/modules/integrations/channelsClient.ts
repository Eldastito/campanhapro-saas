// Stub client for omnichannel messaging (WhatsApp Cloud API, Instagram Messaging API).
// Phase 3 will implement real sending; for now all methods return graceful no-ops.
// IMPORTANT: Never use whatsapp-web.js in production SaaS — use official Meta APIs only.

const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_API_VERSION = process.env.META_API_VERSION || 'v19.0';

export type Channel = 'whatsapp' | 'instagram';

export interface OutboundMessage {
  campaignId: string;
  channel: Channel;
  to: string;
  text?: string;
  templateName?: string;
  templateParams?: string[];
  mediaUrl?: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendMessage(msg: OutboundMessage): Promise<SendResult> {
  if (!WA_PHONE_NUMBER_ID || !META_ACCESS_TOKEN) {
    console.warn('[ChannelsClient] Meta credentials not set — stub mode active, message not sent');
    return { success: false, error: 'channels_not_configured' };
  }

  if (msg.channel === 'whatsapp') {
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
    if (!res.ok) return { success: false, error: `wa_api_error_${res.status}` };
    const data = (await res.json()) as { messages?: [{ id: string }] };
    return { success: true, messageId: data.messages?.[0]?.id };
  }

  return { success: false, error: 'channel_not_implemented' };
}
