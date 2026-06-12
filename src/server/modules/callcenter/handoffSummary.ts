/**
 * Transição Invisível (portado do exaforgeStudio/HandoffSummaryService).
 *
 * No momento em que a conversa passa da IA para um humano, gera um resumo em
 * tópicos do atendimento e grava na conversa (+ histórico em
 * conversation_summaries). O operador que assume vê o contexto direto na tela —
 * o eleitor nunca precisa repetir a história.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { callAgent } from '../../../lib/aiCallAgent';

/** Monta o resumo a partir de um histórico já carregado (rápido, sem reconsultar). */
export async function summaryFromHistory(
  supabase: SupabaseClient,
  campaignId: string,
  history: { role: string; text: string }[],
  currentMessage?: string,
): Promise<string> {
  const linhas = history.map((m) => `${m.role}: ${m.text}`);
  if (currentMessage) linhas.push(`Eleitor: ${currentMessage}`);
  if (linhas.length === 0) return '';
  const prompt = `Você é o assistente que está PASSANDO este atendimento para um colega humano.
Resuma em tópicos curtos para o atendente assumir sem que o eleitor precise repetir nada.
Inclua: o que o eleitor quer, o problema principal, o que já foi feito/respondido e o próximo passo sugerido.
Seja objetivo (máx. 6 tópicos).

Conversa:
${linhas.join('\n')}

Resumo para o atendente:`;
  try {
    const ai = await callAgent(supabase, 'crm', prompt, {
      campaignId, complexity: 'cheap', maxTokens: 400,
    });
    return (ai.text || '').trim();
  } catch (e: any) {
    console.error('[Handoff] Falha ao gerar resumo:', e?.message || e);
    return '';
  }
}

/** Carrega as últimas mensagens da conversa e resume (usado no handoff manual). */
export async function summaryFromConversation(
  supabase: SupabaseClient, campaignId: string, conversationId: string,
): Promise<string> {
  const { data: rows } = await supabase.from('channel_messages')
    .select('direction, body')
    .eq('conversationId', conversationId)
    .order('createdAt', { ascending: false })
    .limit(20);
  const history = (rows || []).reverse().map((r: any) => ({
    role: r.direction === 'inbound' ? 'Eleitor' : 'Assistente',
    text: r.body || '',
  }));
  return summaryFromHistory(supabase, campaignId, history);
}

/** Persiste o resumo na conversa (+ histórico) e devolve o texto. */
export async function saveSummary(
  supabase: SupabaseClient, campaignId: string, conversationId: string,
  summary: string, reason?: string,
): Promise<void> {
  if (!summary) return;
  try {
    await supabase.from('channel_conversations').update({
      handoffSummary: summary,
      ...(reason ? { handoffReason: reason } : {}),
      updatedAt: new Date().toISOString(),
    }).eq('id', conversationId);
    await supabase.from('conversation_summaries').insert({
      campaignId, conversationId, summaryText: summary,
    });
  } catch (e: any) {
    console.error('[Handoff] Falha ao salvar resumo:', e?.message || e);
  }
}
