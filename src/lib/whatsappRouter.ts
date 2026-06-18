/**
 * Roteador 2-IAs no WhatsApp (#125).
 *
 * Decide quem responde uma mensagem inbound: Aurora (CampanhaPro),
 * Terra (ZappFlow), Orquestrador (coordenador autorizado), ou ninguém.
 *
 * Ordem de decisão:
 *  1) Wake word do ORQUESTRADOR + telefone autorizado → dispara orquestrador
 *  2) Wake word do ZAPFLOW → forward HTTP pro endpoint configurado
 *  3) Lock ativo pra essa conversa → segue na mesma IA do lock
 *  4) Classificador IA leve → política / negócio / indefinido
 *  5) Decide:
 *     - politica c/ conf ≥0.7 → Aurora (handleInboundForBot)
 *     - negocio c/ conf ≥0.7  → forward pro ZappFlow
 *     - indefinido ou conf <0.7 → Aurora pergunta "campanha ou negócio?"
 *
 * Retorna 'handled' quando o roteador já fez a decisão (chamador faz continue).
 * Retorna 'pass_through' quando deve seguir fluxo legado (voterBot existente).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { sendText } from '../server/modules/integrations/evolutionApiClient';
import { fireOrchestration } from './orchestrationTriggers';
import { classifyMessage, ClassificationResult } from './whatsappClassifier';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { retrieveContext } from '../server/modules/rag/knowledgeIngest';
import { isCampaignPaused } from './campaignPauseGate';

/**
 * Aurora responde inline via Gemini Flash. Antes: tinha regra "se não sabe,
 * diga 'vou anotar pra responder'" que virou comportamento padrão (Aurora
 * prometia voltar mas nunca voltava). Refatorado:
 *   - Busca contexto no RAG da campanha (Argumentário, dossiês, propostas)
 *   - Prompt PROÍBE prometer voltar depois — responde SEMPRE na hora
 *   - Se não sabe específico: reconhece tema + pergunta o que interessa
 *   - Tom WhatsApp, 2-4 frases
 */
async function respondAsAurora(opts: {
  supabase: SupabaseClient;
  apiKey: string;
  instanceName: string;
  campaignId: string;
  phone: string;
  voterAgentName: string;
  voterAgentTopics: string[];
  zapflowWakeWord: string;
  userMessage: string;
  candidatoNome?: string | null;
  cargo?: string | null;
}): Promise<void> {
  try {
    // Busca RAG em paralelo com setup do Gemini — best-effort, max 3s.
    const ragPromise = Promise.race([
      retrieveContext(opts.supabase, opts.campaignId, opts.userMessage, 4),
      new Promise<string>((res) => setTimeout(() => res(''), 3000)),
    ]).catch(() => '');

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      await sendText(opts.instanceName, opts.apiKey, opts.phone,
        `Recebi sua mensagem! Sobre o que da campanha você quer falar — ${opts.voterAgentTopics.slice(0, 4).join(', ')}? Me dá um detalhe que eu te respondo. 🤝`);
      return;
    }

    const ragContext = await ragPromise;
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
    });

    const candidatoLine = opts.candidatoNome ? `Candidato: ${opts.candidatoNome}.` : '';
    const cargoLine = opts.cargo ? ` Cargo: ${opts.cargo}.` : '';
    const ragSection = ragContext
      ? `\n\nCONTEXTO DA CAMPANHA (use APENAS esses fatos, não invente):\n${ragContext}`
      : '\n\n(Nenhum material da campanha ainda — responda só com posicionamento geral sobre o tema, sem inventar propostas concretas.)';

    const systemPrompt = `Você é ${opts.voterAgentName}, assistente AUTOMATIZADO da campanha eleitoral.
${candidatoLine}${cargoLine}
Tópicos: ${opts.voterAgentTopics.join(', ')}.

REGRAS INVIOLÁVEIS:

1. RESPONDA SEMPRE NA HORA. NUNCA prometa voltar depois. NUNCA diga "vou anotar", "vou pesquisar", "trago em alguns minutos", "deixa eu verificar". Você responde JÁ.

2. Se a pergunta é sobre tema POLÍTICO mas você não tem dado específico no contexto:
   - Reconheça a importância do tema em 1 frase
   - Faça UMA pergunta específica pra entender o que a pessoa quer ("qual aspecto te preocupa mais?")
   - NUNCA invente propostas, números ou compromissos concretos

3. Se a pergunta é sobre algo PESSOAL do candidato (família, religião, gostos) que você não sabe:
   - Diga que pra esse tipo de assunto é melhor falar com o time humano
   - Não invente

4. Se a pergunta é sobre NEGÓCIO/PRODUTO/VENDA/PEDIDO/AGENDAMENTO comercial:
   - Diga: "Aqui no canal da campanha eu cuido só de política. Pra negócio/pedido, manda uma mensagem nova começando com '${opts.zapflowWakeWord}' que a outra IA te atende."

5. TOM: WhatsApp natural, 2-4 frases curtas. 1 emoji opcional. Direto ao ponto.

6. COMPLIANCE TSE: se perguntarem "você é robô/IA?", responda: "Sim, sou assistente automatizado da campanha. Pra atendimento humano posso te conectar com o time."${ragSection}

Mensagem do eleitor: "${opts.userMessage}"

Sua resposta (curta, direta, NA HORA):`;

    const result = await model.generateContent(systemPrompt);
    let textOut = result.response.text().trim().slice(0, 1000);
    // Defesa adicional: se ainda assim a IA prometeu voltar, troca por
    // pergunta de detalhe (acontece raro mas previne UX ruim).
    const promiseRx = /(vou (anotar|pesquisar|verificar|trazer|consultar|buscar)|trago em|volto em|aguarda um (minuto|segundo|momento))/i;
    if (promiseRx.test(textOut)) {
      textOut = `Sobre "${opts.userMessage.slice(0, 60)}" — me dá um detalhe a mais do que você quer saber? Posso te dar nosso posicionamento sobre o tema. 🙂`;
    }
    if (textOut) {
      await sendText(opts.instanceName, opts.apiKey, opts.phone, textOut);
    }
  } catch (err: any) {
    console.warn('[aurora] resposta falhou, fallback genérico:', err?.message);
    try {
      await sendText(opts.instanceName, opts.apiKey, opts.phone,
        `Tô aqui pra falar sobre a campanha (${opts.voterAgentTopics.slice(0, 3).join(', ')}). Me dá um detalhe específico do que você quer saber? 🙂`);
    } catch {}
  }
}

export type RouteDecision =
  | 'orchestrator'
  | 'aurora'
  | 'forwarded_zapflow'
  | 'disambiguation'
  | 'silence'
  | 'wake_unauthorized'
  | 'no_classifier'
  | 'pass_through';

export interface RouteResult {
  handled: boolean;
  decision: RouteDecision;
  classification?: ClassificationResult;
}

interface RoutingConfig {
  enabled: boolean;
  voterAgentName: string;
  voterAgentTopics: string[];
  orchestratorWakeWord: string | null;
  orchestratorAuthorizedPhones: string[];
  zapflowWakeWord: string;
  zapflowForwardUrl: string | null;
  zapflowForwardSecret: string | null;
}

const LOCK_TTL_MIN = 5;
// Thresholds assimétricos: Aurora é o default da campanha (mais permissiva).
// Forward pro Zapp exige confiança maior pra não silenciar eleitores por engano.
const AURORA_CONFIDENCE_THRESHOLD = 0.55;
const ZAPP_CONFIDENCE_THRESHOLD = 0.75;

// Saudações simples que NUNCA viram disambiguation — Aurora puxa conversa.
const GREETING_RX = /^(oi|olá|ola|hi|hey|opa|alô|alo|bom dia|boa tarde|boa noite|tudo bem|tudo certo|e ai|e aí|salve)[\s!?.,]*$/i;
function isGreeting(text: string): boolean {
  return GREETING_RX.test(text.trim().slice(0, 80));
}

function normPhone(s: string | null | undefined): string {
  return String(s || '').replace(/\D+/g, '');
}

function matchesWakeWord(text: string, word: string | null): boolean {
  if (!word) return false;
  const lower = text.toLowerCase().trim();
  const w = word.toLowerCase().trim();
  if (!w) return false;
  // Aceita "Word, " / "Word:" / "Word " / "Word!" no início, ou só "Word"
  return lower === w || lower.startsWith(w + ' ') || lower.startsWith(w + ',') ||
    lower.startsWith(w + ':') || lower.startsWith(w + '!') || lower.startsWith(w + '?');
}

async function loadConfig(supabase: SupabaseClient, campaignId: string): Promise<RoutingConfig | null> {
  const { data } = await supabase
    .from('campaign_configs')
    .select(
      'whatsappRoutingEnabled, voterAgentName, voterAgentTopics, ' +
      'orchestratorWakeWord, orchestratorAuthorizedPhones, ' +
      'zapflowWakeWord, zapflowForwardUrl, zapflowForwardSecret',
    )
    .eq('id', campaignId)
    .maybeSingle();
  if (!data) return null;
  const r = data as any;
  return {
    enabled: !!r.whatsappRoutingEnabled,
    voterAgentName: r.voterAgentName || 'Aurora',
    voterAgentTopics: Array.isArray(r.voterAgentTopics) ? r.voterAgentTopics : [],
    orchestratorWakeWord: r.orchestratorWakeWord || null,
    orchestratorAuthorizedPhones: Array.isArray(r.orchestratorAuthorizedPhones)
      ? r.orchestratorAuthorizedPhones.map(normPhone) : [],
    zapflowWakeWord: r.zapflowWakeWord || 'Zapp',
    zapflowForwardUrl: r.zapflowForwardUrl || null,
    zapflowForwardSecret: r.zapflowForwardSecret || null,
  };
}

async function getLock(supabase: SupabaseClient, campaignId: string, remoteJid: string): Promise<string | null> {
  const { data } = await supabase
    .from('whatsapp_routing_lock')
    .select('ia, "expiresAt"')
    .eq('campaignId', campaignId)
    .eq('remoteJid', remoteJid)
    .maybeSingle();
  if (!data) return null;
  if (new Date((data as any).expiresAt).getTime() < Date.now()) return null;
  return (data as any).ia;
}

async function setLock(
  supabase: SupabaseClient,
  campaignId: string,
  remoteJid: string,
  ia: 'aurora' | 'terra' | 'orchestrator' | 'disambiguation',
) {
  const expiresAt = new Date(Date.now() + LOCK_TTL_MIN * 60_000).toISOString();
  await supabase.from('whatsapp_routing_lock').upsert({
    campaignId, remoteJid, ia, expiresAt,
    updatedAt: new Date().toISOString(),
  }, { onConflict: 'campaignId,remoteJid' });
}

async function log(
  supabase: SupabaseClient,
  campaignId: string,
  remoteJid: string,
  message: string,
  decision: RouteDecision,
  classification: ClassificationResult | undefined,
  latencyMs: number,
) {
  // CUIDADO: builders supabase-js são thenables — sem await/then NÃO disparam
  // a HTTP request. Usar try/catch pra não derrubar o fluxo principal.
  try {
    await supabase.from('whatsapp_routing_log').insert({
      campaignId, remoteJid, message: message.slice(0, 500),
      decision,
      classification: classification || null,
      latencyMs,
    });
  } catch (err: any) {
    console.warn('[router] log insert falhou:', err?.message || err);
  }
}

async function forwardToZapflow(
  url: string, secret: string | null, payload: any,
): Promise<boolean> {
  try {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) {
      const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
      headers['x-campanhapro-signature'] = sig;
    }
    headers['x-routed-from'] = 'campanhapro';
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch (err: any) {
    console.warn('[router] forward zapflow falhou:', err?.message || err);
    return false;
  }
}

export interface RouteInput {
  supabase: SupabaseClient;
  campaignId: string;
  text: string;
  phone: string;          // só dígitos (já normalizado)
  remoteJid: string;      // jid completo
  instanceName: string;
  apiKey: string | null;
  originalPayload: any;   // payload original do Evolution (pro forward)
}

/**
 * Decisão central. Chamada pelo evolutionWebhookRouter ANTES do fluxo legado.
 */
export async function routeIncomingMessage(input: RouteInput): Promise<RouteResult> {
  const t0 = Date.now();
  const { supabase, campaignId, text, phone, remoteJid, instanceName, apiKey, originalPayload } = input;

  // Modo Campanha Pausada (#137): nem o roteador 2-IAs roda
  if (await isCampaignPaused(supabase, campaignId)) {
    return { handled: true, decision: 'silence' };
  }

  const cfg = await loadConfig(supabase, campaignId);
  if (!cfg || !cfg.enabled) {
    return { handled: false, decision: 'pass_through' };
  }

  // 1) Wake word do ORQUESTRADOR + permissão
  if (cfg.orchestratorWakeWord && matchesWakeWord(text, cfg.orchestratorWakeWord)) {
    const isAuthorized = cfg.orchestratorAuthorizedPhones.includes(phone);
    if (!isAuthorized) {
      await log(supabase, campaignId, remoteJid, text, 'wake_unauthorized', undefined, Date.now() - t0);
      return { handled: true, decision: 'wake_unauthorized' };
    }
    const intent = text.replace(new RegExp(`^${cfg.orchestratorWakeWord}\\s*[,:!?]?\\s*`, 'i'), '').trim()
      || 'Me dá um resumo do estado da campanha agora';
    fireOrchestration(supabase, {
      campaignId,
      intent: `[Solicitação via WhatsApp do coordenador ${phone}]\n\n${intent}\n\nResponda de forma concisa (máx 5 frases) — vai sair via WhatsApp.`,
      source: `whatsapp_orchestrator:${phone}`,
    });
    if (apiKey) {
      void sendText(instanceName, apiKey, phone, `Ok, estou processando: "${intent.slice(0, 80)}". Volto em alguns segundos com o resultado.`);
    }
    await setLock(supabase, campaignId, remoteJid, 'orchestrator');
    await log(supabase, campaignId, remoteJid, text, 'orchestrator', undefined, Date.now() - t0);
    return { handled: true, decision: 'orchestrator' };
  }

  // 2) Wake word do ZAPFLOW → forward
  if (cfg.zapflowForwardUrl && matchesWakeWord(text, cfg.zapflowWakeWord)) {
    const ok = await forwardToZapflow(cfg.zapflowForwardUrl, cfg.zapflowForwardSecret, originalPayload);
    if (ok) {
      await setLock(supabase, campaignId, remoteJid, 'terra');
      await log(supabase, campaignId, remoteJid, text, 'forwarded_zapflow', undefined, Date.now() - t0);
      return { handled: true, decision: 'forwarded_zapflow' };
    }
    // se forward falhou, segue pro classificador (não fica em silêncio)
  }

  // 3) Lock ativo → mantém na mesma IA
  const lockIa = await getLock(supabase, campaignId, remoteJid);
  if (lockIa === 'terra' && cfg.zapflowForwardUrl) {
    const ok = await forwardToZapflow(cfg.zapflowForwardUrl, cfg.zapflowForwardSecret, originalPayload);
    if (ok) {
      await log(supabase, campaignId, remoteJid, text, 'forwarded_zapflow', undefined, Date.now() - t0);
      return { handled: true, decision: 'forwarded_zapflow' };
    }
  }
  if (lockIa === 'aurora') {
    // Aurora responde inline — não delegamos pro voterBot (que pode estar desligado)
    if (apiKey) {
      await respondAsAurora({
        supabase, campaignId,
        apiKey, instanceName, phone,
        voterAgentName: cfg.voterAgentName,
        voterAgentTopics: cfg.voterAgentTopics,
        zapflowWakeWord: cfg.zapflowWakeWord,
        userMessage: text,
      });
    }
    await log(supabase, campaignId, remoteJid, text, 'aurora', undefined, Date.now() - t0);
    return { handled: true, decision: 'aurora' };
  }

  // 4) Saudação simples (oi/bom dia/etc) → cumprimenta + lock aurora
  if (isGreeting(text)) {
    if (apiKey) {
      await sendText(instanceName, apiKey, phone,
        `Oi! Aqui é ${cfg.voterAgentName} 👋\n\nPosso te ajudar com qualquer dúvida sobre o candidato, propostas e a eleição. Manda sua pergunta!`);
    }
    await setLock(supabase, campaignId, remoteJid, 'aurora');
    await log(supabase, campaignId, remoteJid, text, 'aurora', undefined, Date.now() - t0);
    return { handled: true, decision: 'aurora' };
  }

  // 5) Classificador IA
  const classification = await classifyMessage(text, cfg.voterAgentTopics, process.env.GEMINI_API_KEY);

  // 6) Forward pro Zapp: só com confiança ALTA (evita silenciar eleitor por engano)
  if (classification.intent === 'negocio' && classification.confidence >= ZAPP_CONFIDENCE_THRESHOLD) {
    if (cfg.zapflowForwardUrl) {
      const ok = await forwardToZapflow(cfg.zapflowForwardUrl, cfg.zapflowForwardSecret, originalPayload);
      if (ok) {
        await setLock(supabase, campaignId, remoteJid, 'terra');
        await log(supabase, campaignId, remoteJid, text, 'forwarded_zapflow', classification, Date.now() - t0);
        return { handled: true, decision: 'forwarded_zapflow', classification };
      }
    }
    // Sem URL ou forward falhou: Aurora explica e oferece passar pro Zapp
    if (apiKey) {
      void sendText(instanceName, apiKey, phone,
        `Pelo que entendi, você queria falar sobre negócio/produto. Aqui no número da campanha quem cuida disso é o ${cfg.zapflowWakeWord}. ` +
        `Manda uma mensagem nova começando com "${cfg.zapflowWakeWord}" que ele te atende. ` +
        `\n\nAqui é o ${cfg.voterAgentName}, da campanha — se for sobre o candidato, eleição ou propostas, é comigo. 🤝`);
    }
    await log(supabase, campaignId, remoteJid, text, 'silence', classification, Date.now() - t0);
    return { handled: true, decision: 'silence', classification };
  }

  // 7) Política OU baixa confiança OU lock=disambiguation → Aurora ASSUME (não pergunta de novo)
  //    Aurora é o default — chato repetir disambiguação. Se errar, usuário corrige com wake word.
  const wasDisambiguating = lockIa === 'disambiguation';
  const isPolitica = classification.intent === 'politica';
  const auroraAssume = isPolitica || wasDisambiguating ||
    classification.confidence < AURORA_CONFIDENCE_THRESHOLD ||
    classification.intent === 'indefinido';

  if (auroraAssume) {
    // Aurora responde inline (sem depender do voterBot legado)
    if (apiKey) {
      await respondAsAurora({
        supabase, campaignId,
        apiKey, instanceName, phone,
        voterAgentName: cfg.voterAgentName,
        voterAgentTopics: cfg.voterAgentTopics,
        zapflowWakeWord: cfg.zapflowWakeWord,
        userMessage: text,
      });
    }
    await setLock(supabase, campaignId, remoteJid, 'aurora');
    await log(supabase, campaignId, remoteJid, text, 'aurora', classification, Date.now() - t0);
    return { handled: true, decision: 'aurora', classification };
  }

  // Caso EXTREMAMENTE raro (negocio com confiança 0.55-0.75 e SEM lock anterior): pede esclarecimento UMA vez
  if (apiKey) {
    void sendText(instanceName, apiKey, phone,
      `Oi! Aqui é o ${cfg.voterAgentName}, da campanha 👋\n\n` +
      `Você quer falar sobre **a campanha** (candidato, propostas, eleição) ou sobre **negócio/produto**? ` +
      `Se for negócio, diga "${cfg.zapflowWakeWord}" no início da próxima mensagem.`);
  }
  await setLock(supabase, campaignId, remoteJid, 'disambiguation');
  await log(supabase, campaignId, remoteJid, text, 'disambiguation', classification, Date.now() - t0);
  return { handled: true, decision: 'disambiguation', classification };
}
