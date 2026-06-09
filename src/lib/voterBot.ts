/**
 * Atendimento ao Eleitor (bot ao vivo — #70).
 *
 * Recebe uma mensagem INBOUND do eleitor (via webhook do WhatsApp/Evolution),
 * passa pela camada de compliance (#71), gera uma resposta ANCORADA no
 * Argumentário (RAG, anti-alucinação) e responde — registrando tudo na Caixa de
 * Entrada Omnichannel. É fire-and-forget: nunca quebra o webhook.
 *
 * Trava de segurança em camadas:
 *   1. só roda se a campanha tiver voterBotEnabled = true (verificado pelo caller)
 *   2. evaluateInbound: opt-out → encerra; tema sensível → escala p/ humano
 *   3. proceed → resposta gerada SÓ com base no Argumentário; 1ª vez manda disclosure
 */
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendText } from '../server/modules/integrations/evolutionApiClient';
import { callAgent } from './aiCallAgent';
import { retrieveContext } from '../server/modules/rag/knowledgeIngest';
import { buildVoterBotSystemPrompt, evaluateInbound, setConsent, DISCLOSURE } from './voterBotCompliance';

export interface VoterBotParams {
  campaignId: string;
  instanceId: string;
  instanceName: string;
  apiKey: string;
  phone: string;            // E.164 sem @
  contactId: string | null;
  text: string;
  candidato?: string | null;
  cargo?: string | null;
}

export async function handleInboundForBot(supabaseAdmin: SupabaseClient, p: VoterBotParams): Promise<void> {
  try {
    if (!p.apiKey || !p.instanceName || !p.phone) return;
    const text = (p.text || '').trim();
    if (!text || text.startsWith('[mídia')) return; // só responde texto

    const decision = await evaluateInbound(supabaseAdmin, p.campaignId, p.phone, text);

    let reply = '';
    if (decision.action === 'block_opt_out') {
      reply = 'Tudo certo! Você não receberá mais mensagens automáticas. Se mudar de ideia, é só escrever de novo. 🙏';
    } else if (decision.action === 'escalate_human') {
      reply = 'Entendi sua mensagem. Vou encaminhar para uma pessoa da nossa equipe, que falará com você em breve. Obrigado! 🙏';
      // Sinaliza para acompanhamento humano na Sala de Guerra.
      await supabaseAdmin.from('war_room_intelligence').insert({
        campaignId: p.campaignId, sourceAgent: 'voter_bot', category: 'Oportunidade', priority: 'Alta',
        insightText: `Atendimento ao eleitor (${p.phone}) precisa de humano: "${text.slice(0, 140)}"`,
      }).then(() => {}, () => {});
    } else {
      // proceed → resposta ancorada no Argumentário (RAG).
      const ctx = await retrieveContext(supabaseAdmin, p.campaignId, text, 6);
      const system = buildVoterBotSystemPrompt({ candidato: p.candidato || undefined, cargo: p.cargo || undefined, playbookContext: ctx });
      const ai = await callAgent(supabaseAdmin, 'crm', text, {
        campaignId: p.campaignId, systemInstruction: system, complexity: 'cheap', maxTokens: 600,
      });
      reply = (ai.text || '').trim();
      if (!reply) return;
      if (decision.disclosure) reply = `${DISCLOSURE}\n\n${reply}`;
      await setConsent(supabaseAdmin, p.campaignId, p.phone, 'opt_in');
    }

    // Envia e registra na Caixa de Entrada.
    const sent = await sendText(p.instanceName, p.apiKey, p.phone, reply);
    await recordOutbound(supabaseAdmin, p, reply, sent.messageId || crypto.randomBytes(8).toString('hex'));
  } catch (e: any) {
    console.error('[voterBot] erro:', e?.message || e);
  }
}

async function recordOutbound(supabase: SupabaseClient, p: VoterBotParams, body: string, providerMessageId: string) {
  try {
    const now = new Date().toISOString();
    const { data: convo } = await supabase.from('channel_conversations')
      .select('id').eq('campaignId', p.campaignId).eq('channel', 'whatsapp').eq('externalId', p.phone).maybeSingle();
    if (!convo?.id) return;
    await supabase.from('channel_messages').insert({
      conversationId: convo.id, campaignId: p.campaignId, direction: 'outbound',
      channel: 'whatsapp', provider: 'evolution', whatsappInstanceId: p.instanceId,
      providerMessageId, body, createdAt: now,
    });
    await supabase.from('channel_conversations').update({ lastMessageAt: now, updatedAt: now }).eq('id', convo.id);
  } catch (e: any) {
    console.error('[voterBot] recordOutbound:', e?.message || e);
  }
}
