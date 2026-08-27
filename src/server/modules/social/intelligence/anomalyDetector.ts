/**
 * AnomalyDetector — §44 do PRD Social Intelligence.
 *
 * 7 categorias de anomalia:
 *   1. follower_spike         — followers +X% num window curto
 *   2. follower_drop          — followers -X%
 *   3. engagement_spike       — likes+comments+shares +X%
 *   4. comment_spike          — só comments +X% (indicador de controvérsia)
 *   5. negative_sentiment_spike — % negative dobrou vs baseline
 *   6. viral_post             — 1 post com engajamento >K× média do feed
 *   7. sudden_topic_growth    — 1 tópico saltou N pontos vs baseline
 *
 * REGRA §39 aplicada: DETERMINÍSTICO. Cada anomalia carrega hipótese
 * (nunca "os eleitores estão revoltados", sempre "comment count +300%
 * vs baseline — pode indicar interesse OU controvérsia").
 *
 * REGRA §45 herdada de trendDetector: quando não há histórico, retorna
 * `insufficient_history` como state em cada anomalia (não como skip
 * silencioso — o consumer precisa saber que não é ausência).
 *
 * Módulo puro — sem I/O. Recebe estruturas normalizadas, devolve lista
 * de `AnomalyEvent[]`.
 */

// ── Tipos ────────────────────────────────────────────────────────────

export type AnomalyKind =
  | 'follower_spike'
  | 'follower_drop'
  | 'engagement_spike'
  | 'comment_spike'
  | 'negative_sentiment_spike'
  | 'viral_post'
  | 'sudden_topic_growth';

export type AnomalyState = 'detected' | 'insufficient_history';

/**
 * Severity — informativa aqui; o Signal Bus (PR futuro §48-§49) decide
 * severity final combinando com contexto (proximidade eleição, campanha
 * ativa etc.). Aqui expressamos SÓ o significance interno da anomalia.
 */
export type AnomalySeverity = 'info' | 'attention' | 'risk';

export interface AnomalyEvent {
  kind: AnomalyKind;
  state: AnomalyState;
  severity: AnomalySeverity;
  /** Sentença factual — nunca hipótese. Ex.: "followers +37% (12000→16440)". */
  summary: string;
  /** Hipóteses que a IA/humano pode explorar. Nunca afirmação. */
  hypotheses: string[];
  /** Valor observado + baseline usados. */
  observed: number;
  baseline: number | null;
  /** Confidence 0-1. Determinístico teta em 0.9. */
  confidence: number;
  /** Metadata específico da anomalia. */
  metadata?: Record<string, unknown>;
  detectorVersion: string;
}

// ── Config default ──────────────────────────────────────────────────

export interface AnomalyDetectorConfig {
  /** Delta absoluto pra follower spike/drop. Default 0.15 (15%). */
  followerDeltaThreshold: number;
  /** Delta absoluto pra engagement/comment spike. Default 0.50 (50%). */
  engagementDeltaThreshold: number;
  /** Delta absoluto pra sentiment (proporção negative). Default 1.5 (150% do baseline). */
  sentimentDeltaThreshold: number;
  /** Multiplicador pra viral post (post > K× média do feed). Default 5. */
  viralMultiplier: number;
  /** Min interações absolutas para o viral post contar (evita 1 like × 5 = 5). Default 50. */
  viralMinAbsolute: number;
  /** Delta absoluto pra topic growth. Default 1.0 (dobrou). */
  topicGrowthDeltaThreshold: number;
  /** Min amostras por lado para state=detected. Menos → insufficient_history. Default 3. */
  minSamplesPerSide: number;
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyDetectorConfig = Object.freeze({
  followerDeltaThreshold: 0.15,
  engagementDeltaThreshold: 0.50,
  sentimentDeltaThreshold: 1.5,
  viralMultiplier: 5,
  viralMinAbsolute: 50,
  topicGrowthDeltaThreshold: 1.0,
  minSamplesPerSide: 3,
});

export const ANOMALY_DETECTOR_VERSION = '2026-08-27.v1';

// ── Inputs ──────────────────────────────────────────────────────────

export interface FollowerSnapshot {
  /** Contagem observada AGORA. */
  current: number;
  /** Baseline (medição prévia). null → insufficient_history. */
  baseline: number | null;
}

export interface EngagementSnapshot {
  /** Soma de likes+comments+shares na janela atual. */
  current: number;
  /** Mesmo na janela imediatamente anterior. */
  baseline: number | null;
  /** Só de comments — pra detectar comment_spike independente. */
  currentComments: number;
  baselineComments: number | null;
}

export interface SentimentSnapshot {
  /** Proporção negative na janela atual, 0-1. null se não classificado. */
  currentNegRatio: number | null;
  /** Idem baseline. */
  baselineNegRatio: number | null;
  /** Total de comments classificados na janela atual. */
  currentClassifiedCount: number;
  baselineClassifiedCount: number;
}

export interface PostSnapshot {
  externalId: string;
  provider: string;
  engagement: number; // likes + comments + shares somados
  publishedAt: Date;
}

export interface TopicSnapshot {
  topic: string;
  /** Menções na janela atual. */
  current: number;
  /** Menções na janela imediatamente anterior. */
  baseline: number | null;
}

// ── Detectors ───────────────────────────────────────────────────────

function detectFollowerAnomalies(
  snap: FollowerSnapshot,
  cfg: AnomalyDetectorConfig,
): AnomalyEvent[] {
  if (snap.baseline === null || snap.baseline === 0) {
    return [{
      kind: 'follower_spike',
      state: 'insufficient_history',
      severity: 'info',
      summary: 'Sem baseline de followers — não é possível calcular delta.',
      hypotheses: [],
      observed: snap.current,
      baseline: snap.baseline,
      confidence: 0,
      detectorVersion: ANOMALY_DETECTOR_VERSION,
    }];
  }
  const delta = (snap.current - snap.baseline) / snap.baseline;
  const absDelta = Math.abs(delta);
  if (absDelta < cfg.followerDeltaThreshold) return [];

  const isRising = delta > 0;
  return [{
    kind: isRising ? 'follower_spike' : 'follower_drop',
    state: 'detected',
    severity: isRising ? 'attention' : 'risk',
    summary: `Followers ${isRising ? '+' : ''}${(delta * 100).toFixed(1)}% (${snap.baseline} → ${snap.current})`,
    hypotheses: isRising
      ? [
          'Conteúdo recente viralizou',
          'Ganho por crossposting ou parceria',
          'Migração de audiência de outra rede',
        ]
      : [
          'Reação negativa a conteúdo recente',
          'Limpeza de bots pelo provider',
          'Bloqueio ou banimento parcial',
        ],
    observed: snap.current,
    baseline: snap.baseline,
    confidence: Math.min(0.9, 0.5 + absDelta * 0.5),
    detectorVersion: ANOMALY_DETECTOR_VERSION,
  }];
}

function detectEngagementAnomalies(
  snap: EngagementSnapshot,
  cfg: AnomalyDetectorConfig,
): AnomalyEvent[] {
  const events: AnomalyEvent[] = [];

  // engagement_spike (agregado)
  if (snap.baseline === null || snap.baseline === 0) {
    if (snap.baseline === null) {
      events.push({
        kind: 'engagement_spike',
        state: 'insufficient_history',
        severity: 'info',
        summary: 'Sem baseline de engagement — não é possível calcular delta.',
        hypotheses: [],
        observed: snap.current,
        baseline: null,
        confidence: 0,
        detectorVersion: ANOMALY_DETECTOR_VERSION,
      });
    }
  } else {
    const delta = (snap.current - snap.baseline) / snap.baseline;
    if (delta >= cfg.engagementDeltaThreshold) {
      events.push({
        kind: 'engagement_spike',
        state: 'detected',
        severity: 'attention',
        summary: `Engagement +${(delta * 100).toFixed(1)}% (${snap.baseline} → ${snap.current})`,
        hypotheses: [
          'Post recente virou tema',
          'Ação coordenada de apoiadores/detratores',
        ],
        observed: snap.current,
        baseline: snap.baseline,
        confidence: Math.min(0.9, 0.5 + delta * 0.3),
        detectorVersion: ANOMALY_DETECTOR_VERSION,
      });
    }
  }

  // comment_spike (isolado — sinal de controvérsia)
  if (snap.baselineComments === null || snap.baselineComments === 0) {
    if (snap.baselineComments === null) {
      events.push({
        kind: 'comment_spike',
        state: 'insufficient_history',
        severity: 'info',
        summary: 'Sem baseline de comments — não é possível calcular delta.',
        hypotheses: [],
        observed: snap.currentComments,
        baseline: null,
        confidence: 0,
        detectorVersion: ANOMALY_DETECTOR_VERSION,
      });
    }
  } else {
    const delta = (snap.currentComments - snap.baselineComments) / snap.baselineComments;
    if (delta >= cfg.engagementDeltaThreshold) {
      events.push({
        kind: 'comment_spike',
        state: 'detected',
        severity: 'attention',
        summary: `Comments +${(delta * 100).toFixed(1)}% (${snap.baselineComments} → ${snap.currentComments})`,
        hypotheses: [
          'Assunto polêmico atraiu discussão',
          'Comentário fixado de outra fonte trouxe volume',
          'Bot brigade — verificar autores',
        ],
        observed: snap.currentComments,
        baseline: snap.baselineComments,
        confidence: Math.min(0.9, 0.5 + delta * 0.3),
        detectorVersion: ANOMALY_DETECTOR_VERSION,
      });
    }
  }
  return events;
}

function detectSentimentAnomaly(
  snap: SentimentSnapshot,
  cfg: AnomalyDetectorConfig,
): AnomalyEvent[] {
  if (snap.currentNegRatio === null || snap.baselineNegRatio === null) {
    return [{
      kind: 'negative_sentiment_spike',
      state: 'insufficient_history',
      severity: 'info',
      summary: 'Sentiment não classificado em uma das janelas.',
      hypotheses: [],
      observed: snap.currentClassifiedCount,
      baseline: snap.baselineClassifiedCount,
      confidence: 0,
      detectorVersion: ANOMALY_DETECTOR_VERSION,
    }];
  }
  if (snap.currentClassifiedCount < cfg.minSamplesPerSide ||
      snap.baselineClassifiedCount < cfg.minSamplesPerSide) {
    return [{
      kind: 'negative_sentiment_spike',
      state: 'insufficient_history',
      severity: 'info',
      summary: `Amostra pequena (${snap.currentClassifiedCount}/${snap.baselineClassifiedCount}).`,
      hypotheses: [],
      observed: snap.currentClassifiedCount,
      baseline: snap.baselineClassifiedCount,
      confidence: 0,
      detectorVersion: ANOMALY_DETECTOR_VERSION,
    }];
  }
  if (snap.baselineNegRatio === 0) {
    // Baseline sem negatividade, mas current tem → sinal
    if (snap.currentNegRatio > 0.2) {
      return [{
        kind: 'negative_sentiment_spike',
        state: 'detected',
        severity: 'risk',
        summary: `Negatividade surgiu do zero — ${(snap.currentNegRatio * 100).toFixed(1)}% da amostra atual (0% baseline).`,
        hypotheses: [
          'Novo assunto polêmico',
          'Post específico atraiu críticas — cruzar com viral_post',
        ],
        observed: snap.currentClassifiedCount,
        baseline: snap.baselineClassifiedCount,
        confidence: 0.7,
        detectorVersion: ANOMALY_DETECTOR_VERSION,
      }];
    }
    return [];
  }
  const ratio = snap.currentNegRatio / snap.baselineNegRatio;
  if (ratio >= cfg.sentimentDeltaThreshold) {
    return [{
      kind: 'negative_sentiment_spike',
      state: 'detected',
      severity: 'risk',
      summary: `Negatividade estimada ${ratio.toFixed(2)}× o baseline (${(snap.baselineNegRatio * 100).toFixed(1)}% → ${(snap.currentNegRatio * 100).toFixed(1)}%).`,
      hypotheses: [
        'Reação a decisão/declaração recente',
        'Campanha adversária ampliou críticas',
        'Cruzar com viral_post para identificar o pivô',
      ],
      observed: snap.currentClassifiedCount,
      baseline: snap.baselineClassifiedCount,
      confidence: Math.min(0.85, 0.5 + (ratio - 1) * 0.15),
      detectorVersion: ANOMALY_DETECTOR_VERSION,
    }];
  }
  return [];
}

function detectViralPost(
  posts: PostSnapshot[],
  cfg: AnomalyDetectorConfig,
): AnomalyEvent[] {
  if (posts.length < cfg.minSamplesPerSide) return [];
  const engagements = posts.map(p => p.engagement).filter(n => n >= 0);
  if (!engagements.length) return [];
  const avg = engagements.reduce((s, n) => s + n, 0) / engagements.length;
  if (avg === 0) return [];

  const events: AnomalyEvent[] = [];
  for (const post of posts) {
    const ratio = post.engagement / avg;
    if (ratio >= cfg.viralMultiplier && post.engagement >= cfg.viralMinAbsolute) {
      events.push({
        kind: 'viral_post',
        state: 'detected',
        severity: 'attention',
        summary: `Post ${post.externalId} (${post.provider}) com ${post.engagement} interações — ${ratio.toFixed(1)}× a média do feed (${avg.toFixed(0)}).`,
        hypotheses: [
          'Conteúdo tocou em nervo — aproveitar como amostra pra Studio',
          'Amplificado por perfil grande — checar quem compartilhou',
          'Se sentimento associado é negativo, cruzar com negative_sentiment_spike',
        ],
        observed: post.engagement,
        baseline: Math.round(avg),
        confidence: Math.min(0.9, 0.5 + Math.log10(ratio) * 0.2),
        metadata: {
          postExternalId: post.externalId,
          provider: post.provider,
          publishedAt: post.publishedAt.toISOString(),
          ratioToAverage: Number(ratio.toFixed(2)),
        },
        detectorVersion: ANOMALY_DETECTOR_VERSION,
      });
    }
  }
  return events;
}

function detectTopicGrowth(
  topics: TopicSnapshot[],
  cfg: AnomalyDetectorConfig,
): AnomalyEvent[] {
  const events: AnomalyEvent[] = [];
  for (const t of topics) {
    if (t.baseline === null || t.baseline === 0) {
      // Novo tópico — só é anomalia se current tem massa mínima
      if (t.baseline === null) continue;
      if (t.current >= 5) {
        events.push({
          kind: 'sudden_topic_growth',
          state: 'detected',
          severity: 'attention',
          summary: `Tópico "${t.topic}" surgiu do zero com ${t.current} menções.`,
          hypotheses: [
            'Assunto novo entrou na pauta',
            'Cruzar com detectTrend por provider pra ver onde começou',
          ],
          observed: t.current,
          baseline: 0,
          confidence: Math.min(0.85, 0.5 + Math.log10(t.current + 1) * 0.15),
          metadata: { topic: t.topic },
          detectorVersion: ANOMALY_DETECTOR_VERSION,
        });
      }
      continue;
    }
    const delta = (t.current - t.baseline) / t.baseline;
    if (delta >= cfg.topicGrowthDeltaThreshold) {
      events.push({
        kind: 'sudden_topic_growth',
        state: 'detected',
        severity: 'attention',
        summary: `Tópico "${t.topic}" cresceu ${(delta * 100).toFixed(0)}% (${t.baseline} → ${t.current}).`,
        hypotheses: [
          'Tema entrou em pauta — considerar conteúdo dedicado',
          'Cruzar com detectAllWindows(topic) para ver se é durável',
        ],
        observed: t.current,
        baseline: t.baseline,
        confidence: Math.min(0.9, 0.5 + delta * 0.2),
        metadata: { topic: t.topic, deltaPct: Number(delta.toFixed(2)) },
        detectorVersion: ANOMALY_DETECTOR_VERSION,
      });
    }
  }
  return events;
}

// ── API pública ─────────────────────────────────────────────────────

export interface DetectAnomaliesInput {
  followers?: FollowerSnapshot;
  engagement?: EngagementSnapshot;
  sentiment?: SentimentSnapshot;
  /** Feed atual (só últimos posts — a comparação é intra-feed pra viral). */
  currentPosts?: PostSnapshot[];
  topics?: TopicSnapshot[];
  config?: Partial<AnomalyDetectorConfig>;
}

export function detectAnomalies(input: DetectAnomaliesInput): AnomalyEvent[] {
  const cfg: AnomalyDetectorConfig = { ...DEFAULT_ANOMALY_CONFIG, ...(input.config ?? {}) };
  const events: AnomalyEvent[] = [];

  if (input.followers) events.push(...detectFollowerAnomalies(input.followers, cfg));
  if (input.engagement) events.push(...detectEngagementAnomalies(input.engagement, cfg));
  if (input.sentiment) events.push(...detectSentimentAnomaly(input.sentiment, cfg));
  if (input.currentPosts) events.push(...detectViralPost(input.currentPosts, cfg));
  if (input.topics) events.push(...detectTopicGrowth(input.topics, cfg));

  return events;
}
