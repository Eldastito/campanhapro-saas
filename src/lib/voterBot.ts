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
import { loadActiveAreas, buildAreaMenu, matchAreaChoice } from '../server/modules/callcenter/serviceAreas';

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

    // ---- CALL CENTER: estado da conversa + plano ----
    const { data: convo } = await supabaseAdmin.from('channel_conversations')
      .select('id, "aiPaused", stage, "areaId"')
      .eq('campaignId', p.campaignId).eq('channel', 'whatsapp').eq('externalId', p.phone)
      .maybeSingle();

    // Humano assumiu (aiPaused) → IA NÃO responde; só avisa o painel do operador.
    if ((convo as any)?.aiPaused) {
      const { broadcastCallCenter } = await import('../server/modules/callcenter/callCenterRouter');
      broadcastCallCenter(p.campaignId, 'new_message', { conversationId: (convo as any).id });
      return;
    }

    // Plano: IA-atendente é exclusiva do Total ('completo'). No Estratégico, a
    // mensagem vai DIRETO pra fila humana (estratégia de upgrade) — sem resposta automática.
    const { data: cfg } = await supabaseAdmin.from('campaign_configs')
      .select('"planTier"').eq('id', p.campaignId).maybeSingle();
    if ((cfg as any)?.planTier !== 'completo') {
      if ((convo as any)?.id) {
        await supabaseAdmin.from('channel_conversations').update({
          stage: 'aguardando_humano', updatedAt: new Date().toISOString(),
        }).eq('id', (convo as any).id).in('stage', ['novo_lead', 'ia_atendendo']);
        const { broadcastCallCenter } = await import('../server/modules/callcenter/callCenterRouter');
        broadcastCallCenter(p.campaignId, 'queue_changed', { conversationId: (convo as any).id });
      }
      return;
    }

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
      // TRANSIÇÃO INVISÍVEL: pausa a IA, manda pra fila e deixa o resumo pronto
      // pro operador que assumir (eleitor não repete a história).
      if ((convo as any)?.id) {
        const { summaryFromConversation, saveSummary } = await import('../server/modules/callcenter/handoffSummary');
        const { broadcastCallCenter } = await import('../server/modules/callcenter/callCenterRouter');
        await supabaseAdmin.from('channel_conversations').update({
          aiPaused: true, stage: 'aguardando_humano', updatedAt: new Date().toISOString(),
        }).eq('id', (convo as any).id);
        const summary = await summaryFromConversation(supabaseAdmin, p.campaignId, (convo as any).id);
        await saveSummary(supabaseAdmin, p.campaignId, (convo as any).id, summary, `Escalado pela IA: "${text.slice(0, 120)}"`);
        broadcastCallCenter(p.campaignId, 'queue_changed', { conversationId: (convo as any).id });
      }
    } else {
      // ---- F3: ÁREAS DE ATENDIMENTO (menu no mesmo número + roteamento) ----
      // Se a campanha tem áreas ativas e a conversa ainda não foi roteada,
      // mostra o MENU e espera a escolha. Escolhida a área, a IA responde com a
      // persona dela. Sem áreas → segue o receptivo único (comportamento F2).
      const areas = await loadActiveAreas(supabaseAdmin, p.campaignId);
      let areaPersona: string | undefined;
      let areaGreeting = '';
      if (areas.length > 0) {
        let areaId = (convo as any)?.areaId as string | null;
        if (!areaId) {
          const picked = matchAreaChoice(text, areas);
          if (!picked) {
            // Ainda não escolheu → manda o menu (com disclosure na 1ª vez) e para.
            let menu = buildAreaMenu(areas);
            if (decision.disclosure) menu = `${DISCLOSURE}\n\n${menu}`;
            await setConsent(supabaseAdmin, p.campaignId, p.phone, 'opt_in');
            const sentMenu = await sendText(p.instanceName, p.apiKey, p.phone, menu);
            await recordOutbound(supabaseAdmin, p, menu, sentMenu.messageId || crypto.randomBytes(8).toString('hex'));
            return;
          }
          // Roteia a conversa para a área escolhida + avisa o painel.
          areaId = picked.id;
          if ((convo as any)?.id) {
            await supabaseAdmin.from('channel_conversations')
              .update({ areaId, updatedAt: new Date().toISOString() })
              .eq('id', (convo as any).id);
            const { broadcastCallCenter } = await import('../server/modules/callcenter/callCenterRouter');
            broadcastCallCenter(p.campaignId, 'queue_changed', { conversationId: (convo as any).id });
          }
          areaPersona = picked.persona || undefined;
          areaGreeting = `✅ Você está na área *${picked.name}*. `;
        } else {
          areaPersona = areas.find((a) => a.id === areaId)?.persona || undefined;
        }
      }

      // proceed → resposta ancorada no Argumentário (RAG) + persona da área.
      const ctx = await retrieveContext(supabaseAdmin, p.campaignId, text, 6);
      const system = buildVoterBotSystemPrompt({ candidato: p.candidato || undefined, cargo: p.cargo || undefined, playbookContext: ctx, areaPersona });
      const ai = await callAgent(supabaseAdmin, 'crm', text, {
        campaignId: p.campaignId, systemInstruction: system, complexity: 'cheap', maxTokens: 600,
      });
      reply = (ai.text || '').trim();
      if (!reply) return;
      if (areaGreeting) reply = areaGreeting + reply;
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
    // Bot respondendo → estágio 'ia_atendendo' (sai do novo_lead, entra no funil do call center).
    await supabase.from('channel_conversations').update({ stage: 'ia_atendendo' })
      .eq('id', convo.id).eq('stage', 'novo_lead').then(() => {}, () => {});
    // Tempo real: a resposta da IA aparece na Caixa de Entrada sem dar F5.
    try {
      const { broadcastCallCenter } = await import('../server/modules/callcenter/callCenterRouter');
      broadcastCallCenter(p.campaignId, 'new_message', { conversationId: convo.id });
    } catch { /* best-effort */ }
  } catch (e: any) {
    console.error('[voterBot] recordOutbound:', e?.message || e);
  }
}
