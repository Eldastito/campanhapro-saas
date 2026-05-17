import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { sendMessage, Channel } from '../integrations/channelsClient';
import { hasOutboundConsent } from './consent';
import { audit, actorFromRequest } from '../observability/auditLogger';

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
          await audit(supabaseAdmin, {
            ...actorFromRequest(req),
            action: 'message.send.blocked',
            resourceType: 'contact',
            resourceId: contactId,
            severity: 'warn',
            metadata: { reason: 'no_consent_and_outside_24h_window', channel, to },
          });
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

        // Phase 8 — billing: meter outbound message
        try {
          await supabaseAdmin.from('usage_records').insert({
            campaignId: campaignId,
            metric: 'message_outbound',
            quantity: 1,
            costCents: 0,
            metadata: { channel, template: !!templateName },
          });
        } catch (e) {
          // never block sends on billing telemetry
        }
      }

      return res.json({ ok: true, messageId: result.messageId });
    } catch (err: any) {
      console.error('[Channels] send:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * PATCH /api/v1/channels/conversations/:id
   * Update Kanban stage, priority, or isOpen for a conversation.
   */
  router.patch('/conversations/:id', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      const { id } = req.params;
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data: convo } = await supabaseAdmin
        .from('channel_conversations')
        .select('id, campaignId')
        .eq('id', id)
        .single();

      if (!convo || convo.campaignId !== campaignId) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const { stage, priority, isOpen } = req.body as Partial<{
        stage: string; priority: string; isOpen: boolean;
      }>;

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (stage !== undefined) updates.stage = stage;
      if (priority !== undefined) updates.priority = priority;
      if (isOpen !== undefined) updates.isOpen = isOpen;

      const { error } = await supabaseAdmin
        .from('channel_conversations')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[Channels] update conversation:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/v1/channels/conversations/:id/suggest
   * AI response suggestion or thread summary — all AI calls server-side.
   * mode: 'reply' (default) | 'summarize'
   */
  router.post('/conversations/:id/suggest', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      // Verify conversation belongs to this campaign before generating a suggestion
      const { data: convo } = await supabaseAdmin
        .from('channel_conversations')
        .select('id, campaignId')
        .eq('id', req.params.id)
        .single();
      if (!convo || convo.campaignId !== campaignId) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      if (!OPENAI_API_KEY) return res.status(503).json({ error: 'AI não configurada' });

      const { messages: msgHistory, contact, mode = 'reply' } = req.body as {
        messages: Array<{ direction: string; body: string }>;
        contact?: { name?: string; number?: string };
        mode?: 'reply' | 'summarize';
      };

      const contactLabel = contact?.name || contact?.number || 'eleitor(a)';

      let systemPrompt: string;
      let userContent: string;

      if (mode === 'summarize') {
        systemPrompt = 'Você é um assistente político. Resuma o seguinte histórico de conversa em até 5 pontos objetivos em português do Brasil.';
        userContent = (msgHistory ?? [])
          .map(m => `[${m.direction === 'inbound' ? 'Eleitor' : 'Assessor'}]: ${m.body}`)
          .join('\n');
      } else {
        systemPrompt = `Você é um assessor político respondendo mensagens de ${contactLabel} em nome da campanha. Seja cordial, objetivo e profissional. Responda em português do Brasil. Máximo 3 frases.`;
        userContent = 'Sugira a próxima resposta baseada no histórico abaixo:\n' +
          (msgHistory ?? []).slice(-8)
            .map(m => `[${m.direction === 'inbound' ? 'Eleitor' : 'Assessor'}]: ${m.body}`)
            .join('\n');
      }

      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.AI_MODEL_CHAT_FAST || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          max_tokens: mode === 'summarize' ? 400 : 200,
          temperature: 0.7,
        }),
      });

      if (!aiRes.ok) throw new Error(`OpenAI error ${aiRes.status}`);
      const json = await aiRes.json() as any;
      const suggestion = json.choices?.[0]?.message?.content ?? '';

      return res.json({ suggestion });
    } catch (err: any) {
      console.error('[Channels] suggest:', err);
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
