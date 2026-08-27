/**
 * TopicClassifier — §40 do PRD Social Intelligence.
 *
 * REGRA §39: DETERMINÍSTICO PRIMEIRO. IA vem depois. Este módulo é a
 * primeira passada — keyword mapping em PT-BR sobre a taxonomia oficial
 * do PRD (15 temas + 'outros'). IA (LLM classifier) entra em PR futuro
 * como enrichment sobre este resultado, não substituto.
 *
 * Por quê determinístico primeiro:
 *   - Zero custo por classificação
 *   - Zero latência
 *   - Zero non-determinismo entre runs
 *   - Auditável (a decisão vem de matches concretos, não de "o modelo achou")
 *   - Serve de baseline quando IA falha ou está fora
 *
 * O que NÃO faz:
 *   - Não expande sinônimos além dos listados (isso é enrichment IA)
 *   - Não faz análise sintática — só busca de keywords com word-boundary
 *   - Não classifica sentiment (esse é outro módulo — sentimentClassifier)
 *
 * O retorno inclui `matches` — os termos que dispararam cada tópico —
 * para permitir explicabilidade no drill-down do Pulso Digital (§58).
 */

// ── Taxonomia canônica (§40) ────────────────────────────────────────

export type SocialTopic =
  | 'saude'
  | 'seguranca'
  | 'educacao'
  | 'transporte'
  | 'emprego'
  | 'economia'
  | 'saneamento'
  | 'enchentes'
  | 'transito'
  | 'habitacao'
  | 'assistencia_social'
  | 'servicos_publicos'
  | 'meio_ambiente'
  | 'esporte'
  | 'cultura'
  | 'outros';

export const SOCIAL_TOPICS: readonly SocialTopic[] = Object.freeze([
  'saude',
  'seguranca',
  'educacao',
  'transporte',
  'emprego',
  'economia',
  'saneamento',
  'enchentes',
  'transito',
  'habitacao',
  'assistencia_social',
  'servicos_publicos',
  'meio_ambiente',
  'esporte',
  'cultura',
  'outros',
] as const);

// ── Dicionários PT-BR ───────────────────────────────────────────────
//
// Cada topic mapeia para keywords que, se encontradas no texto (após
// normalização), disparam o topic. Palavras plurais e com acento são
// incluídas quando o singular/desacentuado não pega o caso comum.
//
// LIMITE INTENCIONAL: só termos NÃO-AMBÍGUOS. "Escola" vai em educação
// mas "curso" NÃO (curso pode ser "curso de água" → meio_ambiente).
// Prefira precisão sobre cobertura — a passada seguinte com IA vai capturar
// os ambíguos.

const TOPIC_KEYWORDS: Record<Exclude<SocialTopic, 'outros'>, readonly string[]> = {
  saude: [
    'saude', 'saúde', 'hospital', 'ubs', 'upa', 'sus', 'medico', 'médico',
    'enfermeiro', 'enfermeira', 'enfermeiros', 'enfermeiras',
    'consulta', 'exame', 'vacina', 'remedio', 'remédio',
    'farmacia', 'farmácia', 'clinica', 'clínica', 'ambulancia', 'ambulância',
    'dengue', 'covid', 'psf', 'agente comunitario',
  ],
  seguranca: [
    'seguranca', 'segurança', 'policia', 'polícia', 'roubo', 'assalto',
    'assassinato', 'assassinatos', 'homicidio', 'homicídio', 'homicidios', 'homicídios',
    'bandido', 'traficante', 'trafico', 'tráfico', 'bandidagem',
    'guarda municipal', 'delegacia', 'boletim de ocorrencia',
    'boletim de ocorrência', 'violencia', 'violência',
  ],
  educacao: [
    'educacao', 'educação', 'escola', 'escolas', 'creche', 'creches',
    'professor', 'professora', 'aluno', 'aluna', 'estudante', 'diretor',
    'diretora', 'merenda', 'universidade', 'faculdade', 'vestibular',
    'enem', 'reforma escolar', 'material escolar', 'transporte escolar',
  ],
  transporte: [
    'onibus', 'ônibus', 'linha de onibus', 'linha de ônibus', 'ponto de onibus',
    'ponto de ônibus', 'metro', 'metrô', 'brt', 'vlt', 'trem', 'bilhete unico',
    'bilhete único', 'tarifa', 'passagem', 'passe livre', 'catraca livre',
  ],
  emprego: [
    'emprego', 'empregos', 'desemprego', 'desempregado', 'desempregada',
    'desempregados', 'desempregadas', 'trabalho', 'trabalhador',
    'trabalhadores', 'trabalhadora', 'salario', 'salário',
    'demissao', 'demissão', 'demissoes', 'demissões',
    'clt', 'carteira assinada', 'informalidade',
    'vaga', 'vagas', 'concurso publico', 'concurso público',
  ],
  economia: [
    'economia', 'inflacao', 'inflação', 'juros', 'selic', 'pib',
    'cambio', 'câmbio', 'dolar', 'dólar', 'crise economica', 'crise econômica',
    'recessao', 'recessão', 'imposto', 'impostos', 'tributo', 'tributos',
    'orcamento', 'orçamento',
  ],
  saneamento: [
    'saneamento', 'esgoto', 'coleta de esgoto', 'agua', 'água',
    'falta de agua', 'falta de água', 'racionamento', 'sabesp', 'cedae',
    'estacao de tratamento', 'estação de tratamento', 'lixo', 'coleta de lixo',
    'reciclagem', 'aterro sanitario', 'aterro sanitário',
  ],
  enchentes: [
    'enchente', 'enchentes', 'alagamento', 'alagamentos',
    'inundacao', 'inundação', 'inundacoes', 'inundações',
    'chuva forte', 'chuvas fortes', 'temporal', 'defesa civil',
    'evacuacao', 'evacuação', 'desabrigado', 'desabrigada',
    'desabrigados', 'desabrigadas', 'desmoronamento', 'desmoronamentos',
    'deslizamento', 'deslizamentos',
  ],
  transito: [
    'transito', 'trânsito', 'acidente', 'acidentes de transito',
    'acidentes de trânsito', 'engarrafamento', 'engarrafamentos',
    'buraco na rua', 'buracos na rua',
    'sinalizacao', 'sinalização', 'semaforo', 'semáforo',
    'radar', 'multa', 'ciclovia', 'faixa exclusiva',
  ],
  habitacao: [
    'moradia', 'habitacao', 'habitação', 'moradias', 'aluguel', 'alugueis',
    'aluguéis', 'imovel', 'imóvel', 'imoveis', 'imóveis', 'casa propria',
    'casa própria', 'minha casa minha vida', 'invasao', 'invasão',
    'ocupacao', 'ocupação', 'favela', 'comunidade', 'regularizacao fundiaria',
  ],
  assistencia_social: [
    'assistencia social', 'assistência social', 'cras', 'creas', 'bolsa familia',
    'bolsa família', 'auxilio brasil', 'auxílio brasil', 'auxilio emergencial',
    'auxílio emergencial', 'cadastro unico', 'cadastro único', 'cad unico',
    'cad único', 'situacao de rua', 'situação de rua',
  ],
  servicos_publicos: [
    'servico publico', 'serviço público', 'servicos publicos', 'serviços públicos',
    'iluminacao publica', 'iluminação pública', 'praca', 'praça', 'poste',
    'lampada queimada', 'lâmpada queimada', 'coleta seletiva',
    'atendimento publico', 'atendimento público',
  ],
  meio_ambiente: [
    'meio ambiente', 'meio-ambiente', 'poluicao', 'poluição',
    'desmatamento', 'desmatamentos', 'preservacao', 'preservação',
    'reserva ambiental', 'unidade de conservacao', 'unidade de conservação',
    'sustentabilidade', 'reflorestamento', 'reflorestamentos',
    'nascente', 'rio poluido', 'rio poluído',
    'lixo em terreno', 'aterro clandestino', 'queimadas',
  ],
  esporte: [
    'esporte', 'esportes', 'quadra', 'quadras', 'campo de futebol',
    'ginasio', 'ginásio', 'piscina publica', 'piscina pública',
    'olimpiada', 'olimpíada', 'atleta', 'atletas', 'academia ao ar livre',
    'atividade fisica', 'atividade física', 'lazer',
  ],
  cultura: [
    'cultura', 'evento cultural', 'eventos culturais', 'show', 'teatro',
    'cinema', 'biblioteca', 'bibliotecas', 'museu', 'museus', 'artista',
    'artistas local', 'lei de fomento', 'lei rouanet', 'ponto de cultura',
    'centro cultural',
  ],
};

// ── API pública ─────────────────────────────────────────────────────

export interface TopicClassification {
  /** Tópicos identificados, ordenados por número de matches (mais → menos). */
  topics: SocialTopic[];
  /** Detalhes por tópico — útil pra drill-down §58 e debug. */
  matches: Array<{ topic: SocialTopic; keywords: string[] }>;
  /** Métrica de confiança 0-1 baseada em quantos matches + em quantos tópicos. */
  confidence: number;
  /** Versão do classificador — bump quando taxonomia ou keywords mudarem. */
  classifierVersion: string;
}

/** Bump manual quando taxonomia ou keywords mudarem. Downstream (Trend,
 *  Anomaly, storage) usa isso pra invalidar cache. */
export const TOPIC_CLASSIFIER_VERSION = '2026-08-27.v1';

// ── Normalização ────────────────────────────────────────────────────

/**
 * Normaliza texto pra matching: lowercase + remove acentos + colapsa
 * espaços. Mantém pontuação → boundary matching funciona.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacritics
    .replace(/\s+/g, ' ')
    .trim();
}

function keywordMatches(normalizedText: string, keyword: string): boolean {
  const normalizedKw = normalize(keyword);
  // Word-boundary aproximado — regex \b não pega bem com Unicode em JS.
  // Usa manual: começo ou espaço/pontuação antes/depois.
  const idx = normalizedText.indexOf(normalizedKw);
  if (idx < 0) return false;
  const before = idx === 0 ? ' ' : normalizedText[idx - 1];
  const after = idx + normalizedKw.length >= normalizedText.length
    ? ' '
    : normalizedText[idx + normalizedKw.length];
  const isWordChar = (c: string) => /[a-z0-9]/i.test(c);
  return !isWordChar(before) && !isWordChar(after);
}

/**
 * Classifica um texto. Retorna sempre — mesmo que só com 'outros'.
 * O confidence reflete quão claro foi o sinal.
 */
export function classifyTopics(rawText: string | null | undefined): TopicClassification {
  const text = (rawText ?? '').trim();
  if (!text) {
    return {
      topics: ['outros'],
      matches: [],
      confidence: 0,
      classifierVersion: TOPIC_CLASSIFIER_VERSION,
    };
  }

  const normalized = normalize(text);
  const perTopic: Array<{ topic: SocialTopic; keywords: string[] }> = [];

  for (const topic of SOCIAL_TOPICS) {
    if (topic === 'outros') continue;
    const kws = TOPIC_KEYWORDS[topic as Exclude<SocialTopic, 'outros'>];
    const hit: string[] = [];
    for (const kw of kws) {
      if (keywordMatches(normalized, kw)) hit.push(kw);
    }
    if (hit.length) perTopic.push({ topic, keywords: hit });
  }

  if (!perTopic.length) {
    return {
      topics: ['outros'],
      matches: [],
      confidence: 0.1, // low but not zero — o texto tinha algo, só não bateu com nada
      classifierVersion: TOPIC_CLASSIFIER_VERSION,
    };
  }

  // Ordena por número de matches, desempate por ordem canônica.
  perTopic.sort((a, b) => {
    if (b.keywords.length !== a.keywords.length) return b.keywords.length - a.keywords.length;
    return SOCIAL_TOPICS.indexOf(a.topic) - SOCIAL_TOPICS.indexOf(b.topic);
  });

  // Confidence: cresce com total de matches, tetada em 0.9 (determinístico
  // nunca "certeza plena" — deixa espaço pra IA elevar depois).
  const totalMatches = perTopic.reduce((s, t) => s + t.keywords.length, 0);
  const confidence = Math.min(0.9, 0.3 + totalMatches * 0.15);

  return {
    topics: perTopic.map(t => t.topic),
    matches: perTopic,
    confidence,
    classifierVersion: TOPIC_CLASSIFIER_VERSION,
  };
}
