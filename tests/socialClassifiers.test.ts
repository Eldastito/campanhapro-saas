/**
 * Testes do PR 9 do PRD Social Intelligence — TopicClassifier +
 * SentimentClassifier (determinísticos, §39-§42).
 *
 * Cobre:
 *   - Taxonomia oficial §40 (todos os 15 temas + 'outros')
 *   - Sentiment espectro §41 (positive/neutral/negative/mixed/unknown)
 *   - Negação inverte polaridade
 *   - Intensificadores dobram peso
 *   - `unknown` explícito (§13: nunca confundir com neutral)
 *   - Confidence never > 0.85 no determinístico (deixa espaço pra IA)
 *   - Edge cases: input vazio, texto ambíguo, acento/case
 *   - matches expostos pra drill-down (§58)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyTopics,
  SOCIAL_TOPICS,
  TOPIC_CLASSIFIER_VERSION,
  type SocialTopic,
} from '../src/server/modules/social/intelligence/topicClassifier';
import {
  classifySentiment,
  SENTIMENT_CLASSIFIER_MODEL,
  SENTIMENT_CLASSIFIER_VERSION,
} from '../src/server/modules/social/intelligence/sentimentClassifier';

// ── TopicClassifier ──────────────────────────────────────────────────

describe('TopicClassifier — taxonomia §40', () => {
  test('exporta 16 tópicos (15 + outros) na ordem canônica', () => {
    assert.equal(SOCIAL_TOPICS.length, 16);
    assert.equal(SOCIAL_TOPICS[0], 'saude');
    assert.equal(SOCIAL_TOPICS[SOCIAL_TOPICS.length - 1], 'outros');
  });

  test('empty input → outros com confidence=0', () => {
    const r1 = classifyTopics('');
    const r2 = classifyTopics(null);
    const r3 = classifyTopics(undefined);
    for (const r of [r1, r2, r3]) {
      assert.deepEqual(r.topics, ['outros']);
      assert.equal(r.confidence, 0);
      assert.equal(r.classifierVersion, TOPIC_CLASSIFIER_VERSION);
    }
  });

  test('texto sem match → outros com confidence baixa (não 0)', () => {
    const r = classifyTopics('não sei o que dizer sobre isso, prefiro ficar quieto');
    assert.deepEqual(r.topics, ['outros']);
    assert.ok(r.confidence > 0 && r.confidence <= 0.2);
  });

  test('cada tema tem pelo menos 1 keyword que dispara', () => {
    const sampleByTopic: Record<Exclude<SocialTopic, 'outros'>, string> = {
      saude: 'Falta médico na UPA hoje',
      seguranca: 'Assalto no ponto de ônibus, polícia demorou',
      educacao: 'A escola do bairro está sem professor de matemática',
      transporte: 'A tarifa do ônibus subiu de novo',
      emprego: 'Estou desempregado há 6 meses',
      economia: 'A inflação está corroendo meu salário',
      saneamento: 'Sem água há dois dias, cadê o saneamento?',
      enchentes: 'Alagamento na região norte, defesa civil no local',
      transito: 'Buraco na rua causou acidente ontem',
      habitacao: 'Sonho da casa própria vira pesadelo com aluguel alto',
      assistencia_social: 'Fila enorme no CRAS pra recadastro do Bolsa Família',
      servicos_publicos: 'Lâmpada queimada há semanas na praça',
      meio_ambiente: 'Poluição no rio está piorando com desmatamento',
      esporte: 'A quadra pública está fechada há meses',
      cultura: 'Teatro municipal precisa de reforma urgente',
    };
    for (const [topic, sample] of Object.entries(sampleByTopic)) {
      const r = classifyTopics(sample);
      assert.ok(r.topics.includes(topic as SocialTopic),
        `${topic} não bateu em "${sample}" — got ${r.topics.join(',')}`);
    }
  });

  test('múltiplos temas: ordenados por número de matches', () => {
    // 3 matches de saúde + 1 de transporte
    const r = classifyTopics('Faltou médico no hospital, a UBS fechou e ainda não tem ônibus pra ir na cidade');
    assert.equal(r.topics[0], 'saude');
    assert.ok(r.topics.includes('transporte'));
    // saude aparece antes por ter mais matches
    assert.ok(r.topics.indexOf('saude') < r.topics.indexOf('transporte'));
  });

  test('matches expostos por tema (drill-down §58)', () => {
    const r = classifyTopics('Enchente na rua, moradores desabrigados');
    const enchentes = r.matches.find(m => m.topic === 'enchentes');
    assert.ok(enchentes, 'enchentes deveria estar nos matches');
    assert.ok(enchentes!.keywords.length > 0);
  });

  test('confidence determinístico teta em 0.9 (§39 deixa espaço pra IA)', () => {
    const r = classifyTopics('escola escola escola escola escola escola escola escola escola escola');
    assert.ok(r.confidence <= 0.9, `${r.confidence} deveria ser <= 0.9`);
  });

  test('acento e case são normalizados', () => {
    const r1 = classifyTopics('SAÚDE');
    const r2 = classifyTopics('saude');
    const r3 = classifyTopics('Saúde');
    for (const r of [r1, r2, r3]) {
      assert.ok(r.topics.includes('saude'), `bateu com case/acento`);
    }
  });

  test('word boundary evita falsos positivos', () => {
    // "curso" contém "urso" mas não deveria bater com nada. Nenhum dos
    // termos aqui está no lexicon, então tudo cai em 'outros'.
    const r = classifyTopics('Fiz um curso de origami no fim de semana');
    assert.deepEqual(r.topics, ['outros']);
  });
});

// ── SentimentClassifier ─────────────────────────────────────────────

describe('SentimentClassifier — espectro §41 e regras §39/§42', () => {
  test('empty input → unknown com confidence=0 (§13: unknown ≠ neutral)', () => {
    for (const input of ['', null, undefined]) {
      const r = classifySentiment(input);
      assert.equal(r.sentiment, 'unknown');
      assert.equal(r.confidence, 0);
      assert.equal(r.model, SENTIMENT_CLASSIFIER_MODEL);
      assert.equal(r.classifierVersion, SENTIMENT_CLASSIFIER_VERSION);
    }
  });

  test('sem termo do lexicon → unknown (não neutral)', () => {
    // Frase totalmente neutra sem palavra emocional
    const r = classifySentiment('A reunião foi às 14h no auditório');
    assert.equal(r.sentiment, 'unknown');
    assert.equal(r.confidence, 0);
  });

  test('positive puro', () => {
    const r = classifySentiment('Adorei o evento, foi excelente');
    assert.equal(r.sentiment, 'positive');
    assert.ok(r.confidence > 0.4 && r.confidence <= 0.85);
    assert.ok(r.matches.positive.length >= 2);
  });

  test('negative puro', () => {
    const r = classifySentiment('Péssimo atendimento, decepção total');
    assert.equal(r.sentiment, 'negative');
    assert.ok(r.confidence > 0.4 && r.confidence <= 0.85);
    assert.ok(r.matches.negative.length >= 2);
  });

  test('mixed: pos e neg juntos', () => {
    const r = classifySentiment('Gostei do hospital, mas o médico foi péssimo');
    assert.equal(r.sentiment, 'mixed');
    // Mixed confidence é baixo por design (§39: precisa IA pra desambiguar)
    assert.ok(r.confidence <= 0.65);
    assert.ok(r.matches.positive.length >= 1);
    assert.ok(r.matches.negative.length >= 1);
  });

  test('negação inverte polaridade', () => {
    // "não gostei" — sem negação seria positive, com negação vira negative
    const withNegation = classifySentiment('Não gostei nada dessa proposta');
    assert.equal(withNegation.sentiment, 'negative',
      `esperava negative, recebi ${withNegation.sentiment} com matches ${JSON.stringify(withNegation.matches)}`);
    assert.ok(withNegation.matches.negations.length > 0);

    // "não péssimo" seria "não péssimo" → positive
    const doubleNeg = classifySentiment('Não achei péssimo, foi ok');
    assert.notEqual(doubleNeg.sentiment, 'negative', 'não péssimo NÃO deveria virar negative');
  });

  test('intensificador dobra peso', () => {
    const plain = classifySentiment('gostei');
    const emphatic = classifySentiment('gostei muito');
    // muito+gostei deveria ter score maior → confidence >
    assert.ok(emphatic.confidence >= plain.confidence);
    assert.ok(emphatic.matches.intensifiers.includes('muito'));
  });

  test('confidence teta em 0.85 (determinístico nunca "certeza plena")', () => {
    const many = classifySentiment('Excelente maravilhoso incrivel perfeito adorei amei parabens');
    assert.ok(many.confidence <= 0.85, `${many.confidence} deveria ser <= 0.85`);
  });

  test('acento e case são normalizados', () => {
    const r1 = classifySentiment('PÉSSIMO');
    const r2 = classifySentiment('pessimo');
    const r3 = classifySentiment('Péssimo');
    for (const r of [r1, r2, r3]) {
      assert.equal(r.sentiment, 'negative', `bateu case/acento`);
    }
  });

  test('matches.negations e matches.intensifiers expostos', () => {
    const r = classifySentiment('não gostei muito da proposta');
    assert.ok(r.matches.negations.length > 0);
    assert.ok(r.matches.intensifiers.length > 0);
  });

  test('modelo e versão preservados no output', () => {
    const r = classifySentiment('bom');
    assert.equal(r.model, SENTIMENT_CLASSIFIER_MODEL);
    assert.equal(r.classifierVersion, SENTIMENT_CLASSIFIER_VERSION);
  });

  test('político real: revoltada com o hospital', () => {
    // Frase estilo comment IG do candidato do bairro
    const r = classifySentiment('Estou revoltada, o hospital não atendeu minha mãe');
    assert.equal(r.sentiment, 'negative');
  });

  test('político real: parabéns pela reforma da praça', () => {
    const r = classifySentiment('Parabéns pela reforma da praça, ficou linda');
    assert.equal(r.sentiment, 'positive');
  });
});

// ── Integração leve entre os dois classifiers ────────────────────────

describe('Integração — Topic + Sentiment num mesmo comentário', () => {
  test('rotula tema=saude e sentiment=negative com confidence real', () => {
    const text = 'Péssimo atendimento na UPA, esperei 3 horas por um médico';
    const topics = classifyTopics(text);
    const sentiment = classifySentiment(text);

    assert.ok(topics.topics.includes('saude'));
    assert.equal(sentiment.sentiment, 'negative');
    assert.ok(topics.confidence > 0);
    assert.ok(sentiment.confidence > 0);
  });

  test('rotula tema=transporte e sentiment=positive', () => {
    const text = 'A nova linha de ônibus está excelente, muito bom o serviço';
    const topics = classifyTopics(text);
    const sentiment = classifySentiment(text);

    assert.ok(topics.topics.includes('transporte'));
    assert.equal(sentiment.sentiment, 'positive');
  });
});
