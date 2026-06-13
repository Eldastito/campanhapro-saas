/**
 * Compliance do Atendimento ao Eleitor (camada obrigatória do bot — #71).
 *
 * Centraliza as regras legais/éticas que QUALQUER mensagem automática a eleitor
 * precisa respeitar antes de ir ao ar (#70). Nada aqui fala com o eleitor por si
 * só — é a "trava de segurança" que o bot consome:
 *   - identificar-se como assistente automatizado (não se passar pelo candidato)
 *   - consentimento/opt-out (LGPD)
 *   - regras TSE de propaganda (não prometer indevido, não disparar massa)
 *   - escalonar para humano em temas sensíveis
 *   - jamais produzir desinformação
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Texto de identificação enviado na 1ª mensagem (LGPD + TSE: transparência). */
export const DISCLOSURE =
  'Olá! Sou o assistente virtual (atendimento automatizado) da campanha. ' +
  'Posso tirar dúvidas sobre as propostas. A qualquer momento responda SAIR para não receber mais mensagens, ou PESSOA para falar com um humano.';

/** Bloco de regras fixas anexado ao system prompt do bot (não-negociável). */
export const COMPLIANCE_PREAMBLE = `# REGRAS OBRIGATÓRIAS (COMPLIANCE — NÃO VIOLE NUNCA)
1. IDENTIDADE: você é um ASSISTENTE VIRTUAL AUTOMATIZADO da campanha. NUNCA se passe pelo candidato nem por um ser humano. Se perguntarem, assuma que é uma IA.
2. VERDADE: responda APENAS com base no ARGUMENTÁRIO/contexto fornecido. Se não houver base, diga que vai encaminhar para um humano — NUNCA invente fato, número, promessa ou data.
3. SEM PROMESSAS INDEVIDAS: não prometa cargos, dinheiro, empregos, favores ou qualquer vantagem (vedado pela lei eleitoral). Fale de propostas e do programa, não de barganha.
4. RESPEITO: nada de ataque pessoal, discurso de ódio, conteúdo difamatório ou desinformação. Rebata adversário só com fato/proposta, sem ofensa.
5. LGPD: respeite quem pediu para sair. Não peça dados sensíveis (CPF, religião, saúde, etc.).
6. ESCALONAMENTO: em tema sensível (denúncia, ameaça, jurídico, imprensa, crise, pedido de dinheiro, assunto fora do programa), NÃO improvise — informe que vai encaminhar para a equipe humana.
7. FOCO: seja cordial e objetivo; conduza a conversa para apresentar propostas e converter apoio, sem ser invasivo.`;

/**
 * Monta o system prompt completo e seguro do atendimento ao eleitor.
 * `playbookContext` vem do RAG (Argumentário de Conversão) — a fonte da verdade.
 */
export function buildVoterBotSystemPrompt(opts: {
  candidato?: string; campaignName?: string; cargo?: string; playbookContext?: string;
  areaPersona?: string;
}): string {
  const quem = opts.candidato || 'o candidato';
  const cargo = opts.cargo ? ` (${opts.cargo})` : '';
  return [
    `Você é o assistente virtual de atendimento ao eleitor da campanha de ${quem}${cargo}.`,
    `Seu objetivo é informar sobre as propostas e, com cordialidade, conquistar o apoio do eleitor com argumentos verdadeiros e comparativos onde nosso candidato leva vantagem.`,
    COMPLIANCE_PREAMBLE,
    // Persona da ÁREA de atendimento escolhida (Call Center F3), se houver — dá
    // o tom/escopo daquele setor sem afrouxar nenhuma regra de compliance acima.
    opts.areaPersona
      ? `\n# ÁREA DE ATENDIMENTO (seu papel neste atendimento)\n${opts.areaPersona}`
      : '',
    opts.playbookContext
      ? `\n# ARGUMENTÁRIO (sua ÚNICA fonte de fatos — não vá além disto)\n${opts.playbookContext}`
      : `\n# ATENÇÃO: nenhum argumentário disponível. Limite-se a saudar e encaminhar para um humano.`,
    `\nResponda em no máximo 2 parágrafos curtos, tom de WhatsApp, em português.`,
  ].filter(Boolean).join('\n\n');
}

/** Gatilhos que exigem handoff humano (tema sensível / fora do escopo). */
export const ESCALATION_TRIGGERS = [
  'advogad', 'process', 'justiça', 'denúnci', 'denunci', 'ameaç', 'imprensa', 'jornalist',
  'dinheiro', 'pix', 'pagar', 'pagamento', 'emprego', 'vaga', 'cargo', 'suborno', 'propina',
  'urgente', 'socorro', 'morte', 'arma', 'crime',
];

/** Comandos de opt-out / pedido de humano (LGPD + transparência). */
export const OPT_OUT_WORDS = ['sair', 'parar', 'descadastr', 'remover', 'stop', 'cancelar'];
export const HUMAN_WORDS = ['pessoa', 'humano', 'atendente', 'falar com alguém', 'falar com alguem'];

const norm = (s: string) => (s || '').toLowerCase();

export function isOptOut(message: string): boolean {
  const m = norm(message).trim();
  return OPT_OUT_WORDS.some((w) => m === w || m.startsWith(w));
}
export function wantsHuman(message: string): boolean {
  const m = norm(message);
  return HUMAN_WORDS.some((w) => m.includes(w));
}
export function needsHumanHandoff(message: string): boolean {
  const m = norm(message);
  return wantsHuman(message) || ESCALATION_TRIGGERS.some((t) => m.includes(t));
}

// --- Consentimento (LGPD) -------------------------------------------------

export async function getConsent(
  supabaseAdmin: SupabaseClient, campaignId: string, phone: string
): Promise<'opt_in' | 'opt_out' | null> {
  try {
    const { data } = await supabaseAdmin.from('voter_bot_consent')
      .select('status').eq('campaignId', campaignId).eq('phone', phone).maybeSingle();
    return (data as any)?.status ?? null;
  } catch { return null; }
}

export async function setConsent(
  supabaseAdmin: SupabaseClient, campaignId: string, phone: string, status: 'opt_in' | 'opt_out'
): Promise<void> {
  try {
    await supabaseAdmin.from('voter_bot_consent')
      .upsert({ campaignId, phone, status, updatedAt: new Date().toISOString(), lastInteractionAt: new Date().toISOString() },
        { onConflict: 'campaignId,phone' });
  } catch { /* best-effort */ }
}

/** Decisão central que o bot consulta ANTES de gerar resposta automática. */
export interface ComplianceDecision { action: 'block_opt_out' | 'escalate_human' | 'proceed'; reason?: string; disclosure?: boolean; }

export async function evaluateInbound(
  supabaseAdmin: SupabaseClient, campaignId: string, phone: string, message: string
): Promise<ComplianceDecision> {
  if (isOptOut(message)) {
    await setConsent(supabaseAdmin, campaignId, phone, 'opt_out');
    return { action: 'block_opt_out', reason: 'eleitor pediu para sair' };
  }
  const consent = await getConsent(supabaseAdmin, campaignId, phone);
  if (consent === 'opt_out') return { action: 'block_opt_out', reason: 'opt-out registrado' };
  if (needsHumanHandoff(message)) return { action: 'escalate_human', reason: 'tema sensível / pedido de humano' };
  return { action: 'proceed', disclosure: consent === null }; // 1ª interação → manda disclosure
}
