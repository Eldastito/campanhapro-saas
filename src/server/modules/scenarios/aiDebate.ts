/**
 * Motor de DEBATE por IA (estilo MiroFish, versão enxuta) — Cenários.
 *
 * Transforma os nós do grafo em AGENTES com persona gerada por IA e simula um
 * debate por turnos sobre um cenário ("e se..."): a cada turno os agentes reagem
 * ao acontecimento e às falas dos vizinhos, geram um argumento curto e atualizam
 * a opinião (-1 oposição … +1 apoio). No fim, um agente relator sintetiza.
 *
 * Decisão de custo: cada turno é UMA chamada de LLM (batch de todos os agentes),
 * não uma por agente — mantém a simulação fiel mas acessível. Âncoras (candidato/
 * adversário) não trocam de lado; conduzem o debate.
 */
import { chatCompletion } from '../ai/chatCompletion';

// IA PADRÃO desta aba = ChatGPT (OpenAI), por decisão de produto. Cai pro Claude
// só se a chave da OpenAI não existir (chatCompletion trata o fallback). Modelo
// padrão gpt-4o-mini (barato/rápido, ótimo p/ debate multi-agente); overridável
// por AI_MODEL_SCENARIO_OPENAI. NÃO forçar um id de modelo da Anthropic aqui —
// foi o que causou o 'personas_failed' antes.
const SCENARIO_AI = {
  preferProvider: 'openai' as const,
  // Só fixa o modelo da OpenAI se a chave existir; senão deixa undefined p/ o
  // Claude usar o default dele (evita mandar id da OpenAI pra API da Anthropic).
  model: process.env.OPENAI_API_KEY ? (process.env.AI_MODEL_SCENARIO_OPENAI || 'gpt-4o-mini') : undefined,
};

export interface AgentSpec {
  id: string;
  label: string;
  type: string; // candidate | opponent | leader | voter_group | ally
  stubborn?: boolean;
  opinion?: number;
}
export interface Persona extends AgentSpec {
  persona: string;
  opinion: number;
  voteIntention?: string;
}
export interface TurnAgent { id: string; utterance: string; opinion: number; }
export interface DebateTurn { turn: number; agents: TurnAgent[]; }

const TYPE_PT: Record<string, string> = {
  candidate: 'o próprio candidato da campanha',
  opponent: 'um candidato adversário',
  leader: 'uma liderança/apoiador da campanha',
  voter_group: 'um grupo de eleitores (segmento)',
  ally: 'um aliado político',
};

function clampOpinion(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

const SYSTEM =
  'Você é um simulador de opinião pública eleitoral brasileiro. Cria personas realistas e ' +
  'plausíveis e simula como elas reagem a acontecimentos políticos. Escreve em português do ' +
  'Brasil, tom natural. NUNCA inventa fatos sobre pessoas reais como se fossem verdade — é uma ' +
  'simulação hipotética para uso interno de estratégia, não pesquisa eleitoral.';

/** Gera personas para cada agente, ancoradas no contexto da campanha. */
export async function generatePersonas(
  agents: AgentSpec[],
  campaignContext: string,
): Promise<Persona[]> {
  const list = agents.map((a) => `- id "${a.id}": ${a.label} (${TYPE_PT[a.type] ?? a.type})`).join('\n');
  const user =
    `Contexto da campanha:\n${campaignContext}\n\n` +
    `Agentes a personificar:\n${list}\n\n` +
    `Para CADA agente, crie uma persona curta (2 frases: valores, tom, o que move o voto) e ` +
    `defina a opinião inicial sobre o candidato da campanha de -1 (oposição forte) a +1 (apoio forte), ` +
    `e a intenção de voto em uma palavra. Responda JSON: ` +
    `{"personas":[{"id":"...","persona":"...","opinion":0.0,"voteIntention":"..."}]}`;

  const raw = await chatCompletion({ system: SYSTEM, user, jsonMode: true, maxTokens: 1400, temperature: 0.8, ...SCENARIO_AI });
  const parsed = safeParse<{ personas: Array<Record<string, unknown>> }>(raw, { personas: [] });
  const byId = new Map(parsed.personas.map((p) => [String(p.id), p]));
  return agents.map((a) => {
    const p = byId.get(a.id);
    return {
      ...a,
      persona: p?.persona ? String(p.persona) : `${a.label}: cidadão típico deste perfil.`,
      opinion: a.opinion != null ? clampOpinion(a.opinion) : clampOpinion(p?.opinion),
      voteIntention: p?.voteIntention ? String(p.voteIntention) : undefined,
    };
  });
}

/** Roda UM turno do debate (batch de todos os agentes numa chamada). */
export async function runDebateTurn(
  personas: Persona[],
  scenario: string,
  prior: DebateTurn | null,
  turnNumber: number,
): Promise<TurnAgent[]> {
  const priorMap = new Map((prior?.agents ?? []).map((a) => [a.id, a]));
  const roster = personas.map((p) => {
    const last = priorMap.get(p.id);
    const cur = last ? last.opinion : p.opinion;
    const lastSpoke = last ? ` Última fala: "${last.utterance}"` : '';
    const anchor = p.stubborn ? ' [ÂNCORA: mantém o lado, não muda de opinião]' : '';
    return `- id "${p.id}" (${p.label}): ${p.persona} Opinião atual: ${cur.toFixed(2)}.${lastSpoke}${anchor}`;
  }).join('\n');

  const user =
    `CENÁRIO em debate: ${scenario}\n\n` +
    `Turno ${turnNumber}. Agentes (com persona, opinião atual e última fala):\n${roster}\n\n` +
    `Simule este turno: cada agente faz UMA fala curta (1–2 frases, em 1ª pessoa, no seu tom) ` +
    `reagindo ao cenário e ao clima do debate, e atualiza sua opinião (-1 a +1). Âncoras mantêm o lado. ` +
    `Mudanças devem ser graduais e plausíveis. Responda JSON: ` +
    `{"agents":[{"id":"...","utterance":"...","opinion":0.0}]}`;

  const raw = await chatCompletion({ system: SYSTEM, user, jsonMode: true, maxTokens: 1600, temperature: 0.85, ...SCENARIO_AI });
  const parsed = safeParse<{ agents: Array<Record<string, unknown>> }>(raw, { agents: [] });
  const byId = new Map(parsed.agents.map((a) => [String(a.id), a]));
  return personas.map((p) => {
    const a = byId.get(p.id);
    const prevOpinion = priorMap.get(p.id)?.opinion ?? p.opinion;
    return {
      id: p.id,
      utterance: a?.utterance ? String(a.utterance) : '(em silêncio)',
      opinion: p.stubborn ? prevOpinion : (a ? clampOpinion(a.opinion) : prevOpinion),
    };
  });
}

/** Agente relator: sintetiza o debate em um relatório acionável (markdown). */
export async function generateReport(
  scenario: string,
  personas: Persona[],
  transcript: DebateTurn[],
): Promise<string> {
  const start = personas.map((p) => `${p.label}: ${p.opinion.toFixed(2)}`).join(', ');
  const last = transcript[transcript.length - 1];
  const end = (last?.agents ?? []).map((a) => {
    const p = personas.find((x) => x.id === a.id);
    return `${p?.label ?? a.id}: ${a.opinion.toFixed(2)}`;
  }).join(', ');
  const highlights = transcript.map((t) =>
    `Turno ${t.turn}:\n` + t.agents.map((a) => {
      const p = personas.find((x) => x.id === a.id);
      return `  ${p?.label ?? a.id}: "${a.utterance}"`;
    }).join('\n')).join('\n\n');

  const user =
    `Cenário simulado: ${scenario}\n\n` +
    `Opinião inicial: ${start}\nOpinião final: ${end}\n\n` +
    `Transcrição do debate:\n${highlights}\n\n` +
    `Escreva um relatório de estratégia em markdown (PT-BR), com as seções: ` +
    `**Resumo**, **Como a opinião migrou**, **Riscos**, **Narrativa vencedora**, **Recomendações** ` +
    `(3-5 bullets acionáveis). Seja conciso e direto.`;

  return chatCompletion({ system: SYSTEM, user, jsonMode: false, maxTokens: 1200, temperature: 0.6, ...SCENARIO_AI });
}

/** Conversa 1–1 com uma persona simulada (depois do debate). */
export async function chatWithAgent(
  persona: Persona,
  scenario: string,
  history: Array<{ role: 'user' | 'agent'; text: string }>,
  message: string,
): Promise<string> {
  const hist = history.slice(-6).map((h) => `${h.role === 'user' ? 'Estrategista' : persona.label}: ${h.text}`).join('\n');
  const user =
    `Você está incorporando esta persona simulada:\n${persona.label} — ${persona.persona}\n` +
    `Opinião atual sobre o candidato: ${persona.opinion.toFixed(2)} (-1 oposição … +1 apoio).\n` +
    `Cenário em discussão: ${scenario}\n\n` +
    (hist ? `Conversa até agora:\n${hist}\n\n` : '') +
    `Mensagem do estrategista: "${message}"\n\n` +
    `Responda EM 1ª PESSOA, no tom da persona, curto (1-3 frases). Não saia do personagem.`;

  return chatCompletion({ system: SYSTEM, user, jsonMode: false, maxTokens: 400, temperature: 0.9, ...SCENARIO_AI });
}
