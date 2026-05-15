import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { sendMessage, Channel } from '../integrations/channelsClient';
import { hasOutboundConsent } from './consent';

export function createChannelsRouter(supabaseAdmin: SupabaseClient) {
  const router = Router();

  /**
   * GET /api/v1/channels/conversations
   * Lists conversations for the current campaign.
   */
  router.get('/conversations', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId ?? (req.query.campaignId as string);
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data, error } = await supabaseAdmin
        .from('channel_conversations')
        .select('*')
        .eq('campaignId', campaignId)
        .order('lastMessageAt', { ascending: false })
        .limit(100);

      if (error) throw error;
      return res.json({ conversations: data ?? [] });
    } catch (err: any) {
      console.error('[Channels] list conversations:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/v1/channels/conversations/:id/messages
   * Returns messages for a conversation (paginated).
   */
  router.get('/conversations/:id/messages', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      const conversationId = req.params.id;
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data: convo } = await supabaseAdmin
        .from('channel_conversations')
        .select('id, campaignId')
        .eq('id', conversationId)
        .single();

      if (!convo || convo.campaignId !== campaignId) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const { data, error } = await supabaseAdmin
        .from('channel_messages')
        .select('*')
        .eq('conversationId', conversationId)
        .order('createdAt', { ascending: true })
        .limit(200);

      if (error) throw error;
      return res.json({ messages: data ?? [] });
    } catch (err: any) {
      console.error('[Channels] list messages:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/v1/channels/send
   * Sends an outbound message. Requires explicit consent unless replying
   * within an open conversation (24h window per Meta policy).
   */
  router.post('/send', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId ?? req.body.campaignId;
      const userId = (req as any).user?.id ?? null;
      const { channel, to, text, contactId, templateName, templateParams } = req.body as {
        channel: Channel;
        to: string;
        text?: string;
        contactId?: string;
        templateName?: string;
        templateParams?: string[];
      };

      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });
      if (!channel || !to) return res.status(400).json({ error: 'channel e to obrigatórios' });
      if (!text && !templateName) return res.status(400).json({ error: 'text ou templateName obrigatório' });

      // Consent check (skipped only for replies to existing open conversations)
      if (contactId) {
        const consent = await hasOutboundConsent(supabaseAdmin, campaignId, contactId, channel);
        const { data: openConvo } = await supabaseAdmin
          .from('channel_conversations')
          .select('id, lastInboundAt')
          .eq('campaignId', campaignId)
          .eq('contactId', contactId)
          .eq('channel', channel)
          .maybeSingle();

        const within24h =
          openConvo?.lastInboundAt &&
          Date.now() - new Date(openConvo.lastInboundAt).getTime() < 24 * 3600 * 1000;

        if (!consent && !within24h && !templateName) {
          return res.status(403).json({ error: 'no_consent_and_outside_24h_window' });
        }
      }

      const result = await sendMessage({
        campaignId,
        channel,
        to,
        text,
        templateName,
        templateParams,
      });

      if (!result.success) {
        return res.status(502).json({ error: result.error ?? 'send_failed' });
      }

      // Persist outbound message + upsert conversation
      const now = new Date().toISOString();
      const { data: convoRow } = await supabaseAdmin
        .from('channel_conversations')
        .upsert(
          {
            campaignId,
            channel,
            contactId: contactId ?? null,
            externalId: to,
            lastMessageAt: now,
            updatedAt: now,
          },
          { onConflict: 'campaignId,channel,externalId' }
        )
        .select('id')
        .single();

      if (convoRow?.id) {
        await supabaseAdmin.from('channel_messages').insert({
          conversationId: convoRow.id,
          campaignId,
          direction: 'outbound',
          channel,
          providerMessageId: result.messageId ?? null,
          body: text ?? `[template:${templateName}]`,
          sentByUserId: userId,
          createdAt: now,
        });
      }

      return res.json({ ok: true, messageId: result.messageId });
    } catch (err: any) {
      console.error('[Channels] send:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/v1/channels/consent
   * Records consent for outbound messaging (LGPD audit trail).
   */
  router.post('/consent', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId ?? req.body.campaignId;
      const { contactId, channel, granted, source, note } = req.body;
      if (!campaignId || !contactId || !channel || granted === undefined) {
        return res.status(400).json({ error: 'campos obrigatórios ausentes' });
      }

      await supabaseAdmin.from('consent_records').insert({
        campaignId,
        contactId,
        channel,
        granted,
        source: source ?? 'manual',
        note: note ?? null,
        revokedAt: granted ? null : new Date().toISOString(),
      });

      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[Channels] consent:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
