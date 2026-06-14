/**
 * Classificador semântico leve para roteamento WhatsApp 2-IAs (#125).
 *
 * Decide se uma mensagem é sobre POLÍTICA (Aurora responde), NEGÓCIO
 * (forward pro ZappFlow), ou INDEFINIDO (Aurora pergunta de volta).
 *
 * Modelo: Gemini Flash (mais barato, latência ~500ms, custo ~$0.0001/msg).
 * Fallback: heurística por keywords se a IA falhar (não bloqueia o fluxo).
 *
 * NÃO usa callAgent pra não pagar overhead de RAG/auto-persist — é um
 * decision puro, não conteúdo gerado pro usuário.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

export type RoutingIntent = 'politica' | 'negocio' | 'indefinido';

export interface ClassificationResult {
  intent: RoutingIntent;
  confidence: number; // 0..1
  reason?: string;
  source: 'ai' | 'heuristic';
  latencyMs: number;
}

const POLITICA_KEYWORDS = [
  'voto', 'votar', 'candidato', 'campanha', 'eleicao', 'eleição',
  'urna', 'apoiar', 'apoio', 'governo', 'prefeito', 'vereador',
  'deputado', 'senador', 'plataforma', 'proposta', 'pauta',
  'comicio', 'comício', 'debate', 'partido',
];

const NEGOCIO_KEYWORDS = [
  // Comercial genérico
  'comprar', 'compra', 'preço', 'preco', 'valor', 'quanto custa', 'quanto é',
  'orçamento', 'orcamento', 'estoque', 'vendi', 'vendido', 'pedido', 'pedir',
  'frete', 'entrega', 'entregar', 'produto', 'mercadoria',
  'serviço', 'servico', 'agendar', 'agendamento', 'horário', 'horario',
  'consulta', 'reserva', 'reservar',
  // Gestão/relatórios (quando dono pergunta pro próprio sistema)
  'relatório', 'relatorio', 'balanço', 'balanco', 'movimentação',
  'movimentacao', 'caixa', 'fatura', 'nota fiscal',
  // Produtos comuns de varejo/lanchonete/restaurante
  'bolo', 'pão', 'pao', 'doce', 'salgado', 'lanche', 'almoço', 'almoco',
  'jantar', 'café', 'cafe', 'pizza', 'hambúrguer', 'hamburguer', 'açaí', 'acai',
  'bebida', 'cerveja', 'refrigerante', 'água', 'agua', 'suco',
  // Operacional comercial
  'aberto', 'fechado', 'funcionamento', 'atendimento', 'delivery', 'tele entrega',
  'cardápio', 'cardapio', 'menu', 'promoção', 'promocao', 'desconto', 'cupom',
  'pagamento', 'pix', 'cartão', 'cartao', 'parcela', 'parcelar', 'boleto',
  'reclamação', 'reclamacao', 'troca', 'devolução', 'devolucao',
  // "vocês têm", "vc tem" etc — padrão de pergunta de compra. Sem "tem" sozinho
  // pra não pegar "tem proposta sobre saúde?".
  'vocês têm', 'voces tem', 'vc tem',
];

function heuristic(text: string): ClassificationResult {
  const start = Date.now();
  const lower = text.toLowerCase();
  let polHits = 0, negHits = 0;
  for (const k of POLITICA_KEYWORDS) if (lower.includes(k)) polHits++;
  for (const k of NEGOCIO_KEYWORDS) if (lower.includes(k)) negHits++;
  let intent: RoutingIntent = 'indefinido';
  let confidence = 0.4;
  if (polHits > 0 && polHits > negHits) { intent = 'politica'; confidence = Math.min(0.9, 0.5 + polHits * 0.15); }
  else if (negHits > 0 && negHits > polHits) { intent = 'negocio'; confidence = Math.min(0.9, 0.5 + negHits * 0.15); }
  return {
    intent, confidence,
    reason: `heuristic: pol=${polHits} neg=${negHits}`,
    source: 'heuristic',
    latencyMs: Date.now() - start,
  };
}

const CLASSIFY_TIMEOUT_MS = 4000;

/**
 * Classifica uma mensagem WhatsApp em política / negócio / indefinido.
 *
 * @param text       Mensagem do usuário
 * @param topics     Tópicos políticos da campanha (vindos de campaign_configs)
 * @param apiKey     GEMINI_API_KEY (do env)
 */
export async function classifyMessage(
  text: string,
  topics: string[],
  apiKey?: string | null,
): Promise<ClassificationResult> {
  if (!apiKey || !text || text.length < 3) return heuristic(text);

  const start = Date.now();
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.0, maxOutputTokens: 60 },
    });

    const topicsLine = topics?.length
      ? `Tópicos políticos relevantes pra esta campanha: ${topics.join(', ')}.`
      : 'Tópicos políticos incluem: voto, candidato, plataforma, eleição, governo.';

    const prompt = `Você é um classificador de mensagens WhatsApp. Responda APENAS com JSON.

Decida se a mensagem do usuário é sobre:
- "politica": pergunta sobre o candidato, plataforma, eleição, voto, governo, política
- "negocio": pedido/compra de produto, serviço, agendamento comercial, vendas, relatório de loja
- "indefinido": cumprimento, saudação, dúvida geral, qualquer outro

${topicsLine}

Mensagem do usuário: """${text.slice(0, 500)}"""

Responda APENAS com JSON neste formato: {"intent":"politica"|"negocio"|"indefinido","confidence":0.0-1.0}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CLASSIFY_TIMEOUT_MS);
    const result = await model.generateContent(prompt);
    clearTimeout(timer);

    const raw = result.response.text().trim();
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) throw new Error('no_json_in_response');
    const parsed = JSON.parse(match[0]);
    const intent: RoutingIntent = ['politica', 'negocio', 'indefinido'].includes(parsed.intent)
      ? parsed.intent
      : 'indefinido';
    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;
    return {
      intent, confidence,
      reason: 'ai',
      source: 'ai',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    console.warn('[classifier] AI falhou, usando heurística:', (err as Error).message);
    return heuristic(text);
  }
}
