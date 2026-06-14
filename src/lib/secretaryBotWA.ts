/**
 * Secretária IA via WhatsApp (#119 parte 2).
 *
 * Espelha exatamente o que o botão "Voz" do AgendaPanel faz (chamada ao
 * /api/agents/secretary), mas pelo WhatsApp:
 *
 *   Candidato manda áudio "Amanhã 14h reunião com prefeito no gabinete"
 *   → webhook detecta que veio do candidatePhone, baixa o áudio do Evolution
 *   → Whisper transcreve pra texto
 *   → secretary agent extrai os 5 campos (title, starts_at, location,
 *     with_whom, priority) e devolve action='confirm_pending' + speech_response
 *   → Bot manda mensagem confirmando e pedindo "OK"
 *   → Candidato responde "OK" → cria evento em agenda_events
 *
 * Estado conversacional vive em channel_conversations.metadata:
 *   { pendingEvent?: {...}, extracted?: {...}, awaitingFields?: [...], stage?: '...' }
 *
 * Esse handler NUNCA quebra o webhook — todos os erros são logados e
 * o usuário recebe uma mensagem genérica.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { callAgent, BudgetExceededError } from './aiCallAgent';
import { sendText } from '../server/modules/integrations/evolutionApiClient';
import { SECRETARY_AGENT_INSTRUCTION } from './agentInstructions';

export interface SecretaryInboundOpts {
  campaignId: string;
  instanceName: string;
  apiKey: string | null;
  /** Telefone (só dígitos) do candidato — quem enviou a mensagem. */
  phone: string;
  /** Texto da mensagem (já transcrito se veio áudio). */
  text: string;
}

const OK_REGEX = /^\s*(ok|okay|confirmo|confirmar|sim|isso|s\b|👍|✅)\s*[.!]?\s*$/i;
const CANCEL_REGEX = /^\s*(cancela(r|do)?|n[ãa]o|nao|errado|esquece|💩|❌)\s*[.!]?\s*$/i;

/** Carrega/cria conversation no canal WhatsApp e devolve metadata atual. */
async function loadConvo(supabase: SupabaseClient, campaignId: string, phone: string) {
  const { data } = await supabase
    .from('channel_conversations')
    .select('id, metadata')
    .eq('campaignId', campaignId)
    .eq('channel', 'whatsapp')
    .eq('externalId', phone)
    .eq('isGroup', false)
    .maybeSingle();
  return data as { id: string; metadata: any } | null;
}

async function saveConvoState(supabase: SupabaseClient, convoId: string, state: any) {
  await supabase
    .from('channel_conversations')
    .update({ metadata: state, updatedAt: new Date().toISOString() })
    .eq('id', convoId);
}

/** Manda resposta via Evolution. Best-effort — só loga em caso de erro. */
async function reply(opts: SecretaryInboundOpts, body: string) {
  if (!opts.apiKey || !body) return;
  try {
    await sendText(opts.instanceName, opts.apiKey, opts.phone, body);
  } catch (e: any) {
    console.warn('[secretaryWA] falha enviando reply:', e?.message);
  }
}

export async function handleInboundForSecretary(
  supabase: SupabaseClient,
  opts: SecretaryInboundOpts,
): Promise<void> {
  const userText = String(opts.text || '').trim();
  if (!userText) return;

  try {
    const convo = await loadConvo(supabase, opts.campaignId, opts.phone);
    const state = (convo?.metadata?.secretary || {}) as any;

    // 1) Se tem pendingEvent E usuário disse "OK" — salva o evento.
    if (state.pendingEvent && OK_REGEX.test(userText)) {
      const ev = state.pendingEvent;
      const required = ['title', 'starts_at', 'location', 'with_whom', 'priority'];
      const missing = required.filter(k => !ev[k] || String(ev[k]).trim() === '');
      if (missing.length > 0) {
        await reply(opts, `Ainda faltam alguns dados pra salvar: ${missing.join(', ')}. Pode me passar?`);
        return;
      }
      const validPrios = ['critica', 'alta', 'media', 'baixa'];
      const prio = validPrios.includes(ev.priority) ? ev.priority : 'media';
      const { error: insErr } = await supabase.from('agenda_events').insert({
        campaignId: opts.campaignId,
        title: String(ev.title).slice(0, 200),
        startsAt: ev.starts_at,
        endsAt: ev.ends_at || null,
        location: String(ev.location).slice(0, 200),
        withWhom: String(ev.with_whom).slice(0, 200),
        priority: prio,
        category: ev.category || 'outro',
        description: ev.description || null,
        reminderMinutesBefore: typeof ev.reminder_minutes_before === 'number' ? ev.reminder_minutes_before : 30,
        status: 'confirmado',
      });
      if (insErr) {
        await reply(opts, `Tive um problema ao salvar 😕. Tente de novo daqui a pouco.`);
        console.error('[secretaryWA] insert agenda_events falhou:', insErr.message);
        return;
      }
      // Limpa estado
      if (convo) await saveConvoState(supabase, convo.id, { ...convo.metadata, secretary: null });
      const dt = new Date(ev.starts_at);
      const dia = dt.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
      const hora = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      await reply(opts, `✅ Compromisso salvo na sua agenda!\n\n📅 ${ev.title}\n🕐 ${dia} às ${hora}\n📍 ${ev.location}\n👤 ${ev.with_whom}`);
      return;
    }

    // 2) Se tem pendingEvent E usuário disse "cancelar" — limpa.
    if (state.pendingEvent && CANCEL_REGEX.test(userText)) {
      if (convo) await saveConvoState(supabase, convo.id, { ...convo.metadata, secretary: null });
      await reply(opts, `Beleza, cancelei. Quando quiser agendar é só me chamar.`);
      return;
    }

    // 3) Chama o LLM (mesmo prompt do endpoint HTTP — multi-turn aware).
    const nowIso = new Date().toISOString();
    let prompt = `AGORA: ${nowIso}\nFUSO: America/Sao_Paulo\n\n`;
    if (state.pendingEvent) {
      prompt += `EVENTO PENDENTE (aguardando confirmação):\n${JSON.stringify(state.pendingEvent, null, 2)}\n\nRESPOSTA DO USUÁRIO:\n"${userText}"`;
    } else if (state.extracted) {
      prompt += `DADOS JÁ EXTRAÍDOS (turno anterior):\n${JSON.stringify(state.extracted, null, 2)}\n\nCAMPOS QUE FALTAVAM: ${(state.awaitingFields || []).join(', ')}\n\nNOVA INFORMAÇÃO DO USUÁRIO:\n"${userText}"`;
    } else {
      prompt += `COMANDO DO USUÁRIO:\n"${userText}"`;
    }

    let ai;
    try {
      ai = await callAgent(supabase, 'secretary', prompt, {
        campaignId: opts.campaignId,
        systemInstruction: SECRETARY_AGENT_INSTRUCTION,
      });
    } catch (err: any) {
      if (err instanceof BudgetExceededError) {
        await reply(opts, `⚠️ Cota mensal de IA atingida. Fala com o admin pra liberar.`);
        return;
      }
      console.error('[secretaryWA] callAgent falhou:', err?.message);
      await reply(opts, `Tive um problema com a IA agora 😕. Tenta de novo daqui a pouco.`);
      return;
    }

    // Parse JSON tolerante
    let cleaned = ai.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const fi = cleaned.indexOf('{'); const li = cleaned.lastIndexOf('}');
    if (fi >= 0 && li > fi) cleaned = cleaned.slice(fi, li + 1);
    let parsed: any = {};
    try { parsed = JSON.parse(cleaned); } catch (e) {
      console.warn('[secretaryWA] JSON inválido da IA:', ai.text.slice(0, 200));
      await reply(opts, `Hmm, não entendi direito. Pode reformular?`);
      return;
    }

    const speech = String(parsed.speech_response || parsed.message || '').trim();

    // Atualiza estado conversacional baseado na ação
    let newState: any = null;
    if (parsed.action === 'confirm_pending' && parsed.event) {
      newState = { pendingEvent: parsed.event, stage: 'awaiting_ok' };
    } else if (parsed.action === 'need_more_info') {
      newState = { extracted: parsed.extracted || {}, awaitingFields: parsed.missing_fields || [], stage: 'collecting' };
    } else if (parsed.action === 'cancel' || parsed.action === 'idle') {
      newState = null;
    }

    if (convo) {
      await saveConvoState(supabase, convo.id, { ...convo.metadata, secretary: newState });
    }

    // Resposta default se o LLM não devolveu speech_response
    const finalText = speech || (
      newState?.pendingEvent
        ? `📅 ${newState.pendingEvent.title || 'Compromisso'} — confirma? Digite OK pra salvar.`
        : `Pode me dizer mais detalhes? Preciso de: quando, com quem, onde.`
    );
    await reply(opts, finalText);
  } catch (e: any) {
    console.error('[secretaryWA] erro inesperado:', e?.message || e);
    await reply(opts, `Tive um problema agora 😕. Tenta de novo daqui a pouco.`);
  }
}
