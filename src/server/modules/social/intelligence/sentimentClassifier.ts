/**
 * SentimentClassifier — §41 do PRD Social Intelligence.
 *
 * REGRA §39: DETERMINÍSTICO PRIMEIRO. Este módulo é a passada baseline
 * com lexicon PT-BR + regras de polaridade. IA vem depois como
 * enrichment (não substituto).
 *
 * REGRA §42: NUNCA usar sentimento como verdade absoluta. Rotular na UI
 * como "Sentimento estimado" — nunca "O eleitor pensa X". Este módulo
 * devolve `confidence` para o consumidor decidir se mostra ou não.
 *
 * Espectro (§41): positive / neutral / negative / mixed / unknown.
 *
 * Regras determinísticas usadas:
 *   1. Match de tokens contra lexicon PT-BR (positivos + negativos)
 *   2. Negação (`não`, `nunca`, `jamais`) inverte polaridade do próximo termo
 *   3. Intensificadores (`muito`, `super`, `extremamente`) dobram peso
 *   4. Se pos > 0 E neg > 0 dentro do mesmo texto → `mixed`
 *   5. Sem matches → `unknown` (não `neutral`!) — §13 do PRD
 *   6. Só pos ou só neg → decide pela contagem
 *
 * O que NÃO faz:
 *   - Não detecta ironia/sarcasmo (impossível determinístico)
 *   - Não pesa emojis (feature futura)
 *   - Não distingue sentiment sobre entidades diferentes ("gostei do
 *     hospital, odiei o médico")
 */

// ── Tipos ────────────────────────────────────────────────────────────

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'mixed' | 'unknown';

export interface SentimentClassification {
  sentiment: Sentiment;
  /** 0-1. Determinístico teta em 0.85 — reserva espaço pra IA elevar. */
  confidence: number;
  /** Modelo/regra usada. Consumers usam pra invalidar cache. */
  model: string;
  /** Versão do lexicon — bump quando adicionar/remover termos. */
  classifierVersion: string;
  /** Detalhes pro drill-down §58: tokens positivos e negativos encontrados. */
  matches: {
    positive: string[];
    negative: string[];
    negations: string[];
    intensifiers: string[];
  };
}

export const SENTIMENT_CLASSIFIER_MODEL = 'ptbr-lexicon-deterministic';
export const SENTIMENT_CLASSIFIER_VERSION = '2026-08-27.v1';

// ── Lexicons PT-BR ──────────────────────────────────────────────────
//
// Curados pra política brasileira / redes sociais. Cada termo é uma
// palavra ou expressão comum — não expande morfologicamente.

const POSITIVE_LEXICON: readonly string[] = Object.freeze([
  'otimo', 'ótimo', 'otima', 'ótima', 'excelente', 'maravilhos',
  'perfeito', 'perfeita', 'incrivel', 'incrível', 'sensacional',
  'top', 'melhor', 'bom', 'boa', 'bacana', 'legal', 'gostei',
  'adorei', 'amei', 'amoo', 'parabens', 'parabéns',
  'sucesso', 'vitoria', 'vitória', 'conquista', 'aprovado',
  'aprovada', 'apoio', 'apoiei', 'apoiar', 'obrigado', 'obrigada',
  'ajudou', 'ajudei', 'agradeco', 'agradeço',
  'esperanca', 'esperança', 'feliz', 'felicidade',
  'orgulho', 'orgulhos',
]);

const NEGATIVE_LEXICON: readonly string[] = Object.freeze([
  'pessimo', 'péssimo', 'pessima', 'péssima', 'horrivel', 'horrível',
  'ruim', 'pior', 'porcaria', 'lixo', 'droga', 'terrivel', 'terrível',
  'triste', 'tristeza', 'chateado', 'chateada', 'decepcionado',
  'decepcionada', 'decepcao', 'decepção', 'revoltado', 'revoltada',
  'indignado', 'indignada', 'nojo', 'nojento', 'nojenta',
  'errado', 'errada', 'errou', 'falha', 'falhou', 'fracasso',
  'reprovado', 'reprovada', 'critica', 'crítica', 'critico', 'crítico',
  'protesto', 'protestos', 'reclamacao', 'reclamação', 'reclamando',
  'furia', 'fúria', 'raiva', 'odio', 'ódio', 'odeio',
  'insatisfeito', 'insatisfeita', 'insatisfacao', 'insatisfação',
  'roubo', 'roub', 'corrupt', 'ladra', 'mentiroso', 'mentirosa',
  'mentira', 'mentiras',
]);

// Negadores — invertem polaridade do TOKEN SEGUINTE (janela de 3 palavras)
const NEGATIONS: readonly string[] = Object.freeze([
  'nao', 'não', 'nunca', 'jamais', 'nenhum', 'nenhuma',
  'ninguem', 'ninguém', 'nada',
]);

// Intensificadores — dobram peso do TOKEN SEGUINTE
const INTENSIFIERS: readonly string[] = Object.freeze([
  'muito', 'muita', 'super', 'extremamente', 'totalmente',
  'completamente', 'demais', 'demais', 'absurdamente', 'tao', 'tão',
]);

// ── Utils ────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(normalized: string): string[] {
  if (!normalized) return [];
  return normalized.split(' ').filter(Boolean);
}

// ── API pública ─────────────────────────────────────────────────────

export function classifySentiment(rawText: string | null | undefined): SentimentClassification {
  const text = (rawText ?? '').trim();

  const baseMatches = {
    positive: [] as string[],
    negative: [] as string[],
    negations: [] as string[],
    intensifiers: [] as string[],
  };

  if (!text) {
    return {
      sentiment: 'unknown',
      confidence: 0,
      model: SENTIMENT_CLASSIFIER_MODEL,
      classifierVersion: SENTIMENT_CLASSIFIER_VERSION,
      matches: baseMatches,
    };
  }

  const normalized = normalize(text);
  const tokens = tokenize(normalized);
  if (!tokens.length) {
    return {
      sentiment: 'unknown',
      confidence: 0,
      model: SENTIMENT_CLASSIFIER_MODEL,
      classifierVersion: SENTIMENT_CLASSIFIER_VERSION,
      matches: baseMatches,
    };
  }

  const positiveSet = new Set(POSITIVE_LEXICON.map(normalize));
  const negativeSet = new Set(NEGATIVE_LEXICON.map(normalize));
  const negationSet = new Set(NEGATIONS.map(normalize));
  const intensifierSet = new Set(INTENSIFIERS.map(normalize));

  let positiveScore = 0;
  let negativeScore = 0;

  const NEGATION_WINDOW = 3;
  const INTENSIFIER_WINDOW = 2;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    // Detecta negador na janela anterior (só faz sentido antes: "não gostei").
    let negated = false;
    let intensified = 1;
    for (let j = 1; j <= NEGATION_WINDOW; j++) {
      const prev = tokens[i - j];
      if (!prev) break;
      if (negationSet.has(prev)) { negated = true; baseMatches.negations.push(prev); break; }
    }
    // Detecta intensificador em ambas direções (PT-BR aceita "muito bom" E "gostei muito").
    for (let j = 1; j <= INTENSIFIER_WINDOW; j++) {
      const prev = tokens[i - j];
      if (prev && intensifierSet.has(prev)) { intensified = 2; baseMatches.intensifiers.push(prev); break; }
      const next = tokens[i + j];
      if (next && intensifierSet.has(next)) { intensified = 2; baseMatches.intensifiers.push(next); break; }
    }

    // Também aceita match parcial via startsWith — capturamos "revoltad", "chateado"
    // com "revoltado", "revoltada", "revoltados" etc. Usa o próprio lexicon curado
    // (que já tem raízes curtas como "revoltad" para casos assim).
    const positiveHit = positiveSet.has(tok) || [...positiveSet].some(kw => kw.length >= 5 && tok.startsWith(kw));
    const negativeHit = negativeSet.has(tok) || [...negativeSet].some(kw => kw.length >= 5 && tok.startsWith(kw));

    if (positiveHit) {
      if (negated) {
        negativeScore += intensified;
        baseMatches.negative.push(`neg(${tok})`);
      } else {
        positiveScore += intensified;
        baseMatches.positive.push(tok);
      }
    } else if (negativeHit) {
      if (negated) {
        positiveScore += intensified;
        baseMatches.positive.push(`neg(${tok})`);
      } else {
        negativeScore += intensified;
        baseMatches.negative.push(tok);
      }
    }
  }

  // Decisão
  let sentiment: Sentiment;
  let confidence: number;

  if (positiveScore === 0 && negativeScore === 0) {
    sentiment = 'unknown';
    confidence = 0;
  } else if (positiveScore > 0 && negativeScore > 0) {
    sentiment = 'mixed';
    // Confidence baixa por default — mixed é sinal de que precisa passar por IA
    const total = positiveScore + negativeScore;
    confidence = Math.min(0.65, 0.3 + total * 0.05);
  } else if (positiveScore > negativeScore) {
    sentiment = 'positive';
    confidence = Math.min(0.85, 0.4 + positiveScore * 0.1);
  } else if (negativeScore > positiveScore) {
    sentiment = 'negative';
    confidence = Math.min(0.85, 0.4 + negativeScore * 0.1);
  } else {
    // Empate impossível (cai no mixed acima), mas TypeScript exige branch
    sentiment = 'neutral';
    confidence = 0.5;
  }

  return {
    sentiment,
    confidence,
    model: SENTIMENT_CLASSIFIER_MODEL,
    classifierVersion: SENTIMENT_CLASSIFIER_VERSION,
    matches: baseMatches,
  };
}
