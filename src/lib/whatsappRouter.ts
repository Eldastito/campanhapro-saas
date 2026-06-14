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
import { classifyMessage, ClassificationResult, RoutingIntent } from './whatsappClassifier';

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

const LOCK_TTL_MIN = 10;
const CONFIDENCE_THRESHOLD = 0.7;

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
  void supabase.from('whatsapp_routing_log').insert({
    campaignId, remoteJid, message: message.slice(0, 500),
    decision,
    classification: classification || null,
    latencyMs,
  });
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
    await log(supabase, campaignId, remoteJid, text, 'aurora', undefined, Date.now() - t0);
    return { handled: false, decision: 'aurora' }; // libera o voterBot existente
  }

  // 4) Classificador IA
  const classification = await classifyMessage(text, cfg.voterAgentTopics, process.env.GEMINI_API_KEY);

  // 5) Decisão
  if (classification.intent === 'politica' && classification.confidence >= CONFIDENCE_THRESHOLD) {
    await setLock(supabase, campaignId, remoteJid, 'aurora');
    await log(supabase, campaignId, remoteJid, text, 'aurora', classification, Date.now() - t0);
    return { handled: false, decision: 'aurora', classification }; // voterBot trata
  }

  if (classification.intent === 'negocio' && classification.confidence >= CONFIDENCE_THRESHOLD) {
    if (cfg.zapflowForwardUrl) {
      const ok = await forwardToZapflow(cfg.zapflowForwardUrl, cfg.zapflowForwardSecret, originalPayload);
      if (ok) {
        await setLock(supabase, campaignId, remoteJid, 'terra');
        await log(supabase, campaignId, remoteJid, text, 'forwarded_zapflow', classification, Date.now() - t0);
        return { handled: true, decision: 'forwarded_zapflow', classification };
      }
    }
    // sem URL ou forward falhou: Aurora pede pra acionar Terra
    if (apiKey) {
      void sendText(instanceName, apiKey, phone,
        `Acho que você queria falar com a Terra sobre o negócio. ` +
        `Diga "${cfg.zapflowWakeWord}" no início da próxima mensagem que ela te atende. ` +
        `Aqui sou a ${cfg.voterAgentName}, atendimento da campanha.`);
    }
    await log(supabase, campaignId, remoteJid, text, 'silence', classification, Date.now() - t0);
    return { handled: true, decision: 'silence', classification };
  }

  // Indefinido ou baixa confiança → pergunta de volta (e fica no lock 'disambiguation')
  if (apiKey) {
    void sendText(instanceName, apiKey, phone,
      `Oi! Sou a ${cfg.voterAgentName}, da campanha. Posso te ajudar com qualquer dúvida sobre o candidato, propostas e eleição. ` +
      `Se for sobre negócio/pedido, diga "${cfg.zapflowWakeWord}" que a outra IA assume.`);
  }
  await setLock(supabase, campaignId, remoteJid, 'disambiguation');
  await log(supabase, campaignId, remoteJid, text, 'disambiguation', classification, Date.now() - t0);
  return { handled: true, decision: 'disambiguation', classification };
}
