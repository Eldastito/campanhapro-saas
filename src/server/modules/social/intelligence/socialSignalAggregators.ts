/**
 * socialSignalAggregators — cola pura entre stored posts/comments
 * (SocialIngestionService) e o SocialSignalsPipeline.
 *
 * Este módulo NÃO faz I/O. Recebe `StoredSocialPost[]` e
 * `StoredSocialComment[]` (já lidos do Supabase) e produz `ProviderInput`
 * do pipeline. O caller (SocialIngestionService, cron, adhoc) fica com
 * responsabilidade de ler; nós reduzimos.
 *
 * Aggregators por dimensão:
 *   1. `aggregateTopicSeries` — classifica cada post e produz TimestampedCount[]
 *      por topic. Bin implícito por data do post (§43).
 *   2. `buildEngagementSnapshot` — soma likes+comments+shares em janela
 *      current vs baseline (§44 engagement_spike + comment_spike).
 *   3. `buildSentimentSnapshot` — usa sentimentClassifier em comments do
 *      current + baseline; calcula proporção negative (§44 negative_sentiment_spike).
 *   4. `buildCurrentPosts` — PostSnapshot[] pra viral detection.
 *   5. `buildTopicSnapshots` — mentions per topic current vs baseline
 *      (§44 sudden_topic_growth).
 *   6. `aggregateProviderInput` — combina os 5 acima num único ProviderInput.
 *
 * REGRA §39: 100% determinístico. Classifiers usados são também
 * determinísticos. Nada de IA aqui.
 *
 * REGRA §42: sentimento retorna proporção (0-1) — chamamos "estimated
 * negative ratio", nunca "verdade sobre o eleitor".
 *
 * O que NÃO faz:
 *   - Não lê Supabase (o wiring PR fará essa ponte).
 *   - Não trata followers (não temos snapshot de followers em social_posts;
 *     essa dimensão precisa de outra tabela — fica para PR futuro).
 *   - Não agrupa comments por post (viral post cuida do post-level; sentiment
 *     agrega comments do feed inteiro na janela).
 */

import type {
  StoredSocialPost,
  StoredSocialComment,
} from '../socialIngestionService.js';
import type { SocialProvider } from '../contracts/socialProvider.js';
import type {
  TimestampedCount,
} from './trendDetector.js';
import type {
  EngagementSnapshot,
  SentimentSnapshot,
  PostSnapshot,
  TopicSnapshot,
} from './anomalyDetector.js';
import type { ProviderInput } from './socialSignalsPipeline.js';
import { classifyTopics, type SocialTopic } from './topicClassifier.js';
import { classifySentiment } from './sentimentClassifier.js';

// ── Config ──────────────────────────────────────────────────────────

export interface AggregatorConfig {
  /** Momento de referência. Necessário pra definir current vs baseline. */
  now: Date;
  /** Duração da janela current (e da baseline). Default 24h em ms. */
  windowMs?: number;
  /** Filtro opcional de topics a monitorar — reduz fan-out.
   *  Se omitido, todos os topics classificados em posts/comments contam. */
  focusTopics?: readonly SocialTopic[];
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;  // 24h

// ── Helpers internos ────────────────────────────────────────────────

function windowRanges(cfg: AggregatorConfig) {
  const win = cfg.windowMs ?? DEFAULT_WINDOW_MS;
  const currentEnd = cfg.now.getTime();
  const currentStart = currentEnd - win;
  const baselineEnd = currentStart;
  const baselineStart = currentStart - win;
  return { currentStart, currentEnd, baselineStart, baselineEnd };
}

function inRange(iso: string, start: number, end: number): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t >= start && t < end;
}

function postEngagement(p: StoredSocialPost): number {
  const m = p.metrics as { likes?: number; comments?: number; shares?: number } | null;
  if (!m) return 0;
  return (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0);
}

function postCommentsMetric(p: StoredSocialPost): number {
  const m = p.metrics as { comments?: number } | null;
  return m?.comments ?? 0;
}

// ── Aggregators ─────────────────────────────────────────────────────

/**
 * Percorre posts e classifica topics. Para cada (post, topic) match,
 * emite um TimestampedCount com `at = publishedAt` e `count = 1`.
 * Múltiplas menções ao mesmo topic no mesmo post → 1 count (não polui).
 * Posts sem text são pulados.
 *
 * Retorna `Record<topic, TimestampedCount[]>` pronto pro TrendDetector.
 */
export function aggregateTopicSeries(
  posts: StoredSocialPost[],
  focusTopics?: readonly SocialTopic[],
): Record<string, TimestampedCount[]> {
  const focusSet = focusTopics && focusTopics.length > 0 ? new Set(focusTopics) : null;
  const bins = new Map<string, TimestampedCount[]>();

  for (const p of posts) {
    if (!p.text) continue;
    const cls = classifyTopics(p.text);
    // Dedup topics do mesmo post (defensivo — classifyTopics já dedup)
    const uniqueTopics = new Set(cls.topics);
    for (const topic of uniqueTopics) {
      if (focusSet && !focusSet.has(topic)) continue;
      const at = new Date(p.publishedAt);
      if (Number.isNaN(at.getTime())) continue;
      const arr = bins.get(topic) ?? [];
      arr.push({ at, count: 1 });
      bins.set(topic, arr);
    }
  }

  const out: Record<string, TimestampedCount[]> = {};
  for (const [t, series] of bins) out[t] = series;
  return out;
}

/**
 * Engagement current vs baseline. `currentComments` e `baselineComments`
 * são apenas a fatia de comments (usada pelo detectAnomalies pra
 * `comment_spike` independente).
 *
 * Fonte:
 *   - agrega post.metrics.likes + comments + shares (posts)
 *   - comments-only usa post.metrics.comments (não a tabela social_comments —
 *     evita drift entre feed e amostra de comments)
 */
export function buildEngagementSnapshot(
  posts: StoredSocialPost[],
  cfg: AggregatorConfig,
): EngagementSnapshot | undefined {
  const r = windowRanges(cfg);
  let current = 0;
  let currentComments = 0;
  let baseline = 0;
  let baselineComments = 0;
  let currentHits = 0;
  let baselineHits = 0;

  for (const p of posts) {
    if (inRange(p.publishedAt, r.currentStart, r.currentEnd)) {
      current += postEngagement(p);
      currentComments += postCommentsMetric(p);
      currentHits += 1;
    } else if (inRange(p.publishedAt, r.baselineStart, r.baselineEnd)) {
      baseline += postEngagement(p);
      baselineComments += postCommentsMetric(p);
      baselineHits += 1;
    }
  }

  if (currentHits === 0 && baselineHits === 0) return undefined;

  return {
    current,
    baseline: baselineHits > 0 ? baseline : null,
    currentComments,
    baselineComments: baselineHits > 0 ? baselineComments : null,
  };
}

/**
 * Proporção negative por janela usando sentimentClassifier em comments.
 * Comments sem texto ou classificados como 'unknown' são ignorados.
 *
 * currentNegRatio: 0-1 (nulo se não houver comments classificados no
 * current). baselineNegRatio idem pro baseline.
 */
export function buildSentimentSnapshot(
  comments: StoredSocialComment[],
  cfg: AggregatorConfig,
): SentimentSnapshot | undefined {
  const r = windowRanges(cfg);
  let curNeg = 0, curClassified = 0;
  let baseNeg = 0, baseClassified = 0;

  for (const c of comments) {
    if (!c.text) continue;
    const cls = classifySentiment(c.text);
    if (cls.sentiment === 'unknown') continue;
    const isNeg = cls.sentiment === 'negative';
    if (inRange(c.publishedAt, r.currentStart, r.currentEnd)) {
      curClassified += 1;
      if (isNeg) curNeg += 1;
    } else if (inRange(c.publishedAt, r.baselineStart, r.baselineEnd)) {
      baseClassified += 1;
      if (isNeg) baseNeg += 1;
    }
  }

  if (curClassified === 0 && baseClassified === 0) return undefined;

  return {
    currentNegRatio: curClassified > 0 ? curNeg / curClassified : null,
    baselineNegRatio: baseClassified > 0 ? baseNeg / baseClassified : null,
    currentClassifiedCount: curClassified,
    baselineClassifiedCount: baseClassified,
  };
}

/**
 * PostSnapshot[] só do current window — usado pra viral_post detection.
 */
export function buildCurrentPosts(
  provider: SocialProvider,
  posts: StoredSocialPost[],
  cfg: AggregatorConfig,
): PostSnapshot[] {
  const r = windowRanges(cfg);
  const out: PostSnapshot[] = [];
  for (const p of posts) {
    if (!inRange(p.publishedAt, r.currentStart, r.currentEnd)) continue;
    const eng = postEngagement(p);
    const pub = new Date(p.publishedAt);
    if (Number.isNaN(pub.getTime())) continue;
    out.push({
      externalId: p.externalId,
      provider,
      engagement: eng,
      publishedAt: pub,
    });
  }
  return out;
}

/**
 * TopicSnapshot[] — mentions per topic no current vs baseline. Consumido
 * por detectTopicGrowth. Reusa o classifyTopics em posts (mesmo shape
 * que aggregateTopicSeries, mas contando total por window).
 */
export function buildTopicSnapshots(
  posts: StoredSocialPost[],
  cfg: AggregatorConfig,
): TopicSnapshot[] {
  const focusSet = cfg.focusTopics && cfg.focusTopics.length > 0
    ? new Set(cfg.focusTopics)
    : null;
  const r = windowRanges(cfg);
  const currentMap = new Map<string, number>();
  const baselineMap = new Map<string, number>();

  for (const p of posts) {
    if (!p.text) continue;
    const inCur = inRange(p.publishedAt, r.currentStart, r.currentEnd);
    const inBase = inRange(p.publishedAt, r.baselineStart, r.baselineEnd);
    if (!inCur && !inBase) continue;

    const cls = classifyTopics(p.text);
    const uniqueTopics = new Set(cls.topics);
    for (const topic of uniqueTopics) {
      if (focusSet && !focusSet.has(topic)) continue;
      if (inCur) currentMap.set(topic, (currentMap.get(topic) ?? 0) + 1);
      else baselineMap.set(topic, (baselineMap.get(topic) ?? 0) + 1);
    }
  }

  const allTopics = new Set([...currentMap.keys(), ...baselineMap.keys()]);
  const out: TopicSnapshot[] = [];
  for (const topic of allTopics) {
    const current = currentMap.get(topic) ?? 0;
    const baseline = baselineMap.get(topic) ?? 0;
    out.push({
      topic,
      current,
      // baseline=0 significa "não tinha antes"; o detector interpreta
      // pra decidir se é sudden_topic_growth ou insufficient
      baseline: baseline === 0 && current === 0 ? null : baseline,
    });
  }
  return out;
}

// ── Composição ──────────────────────────────────────────────────────

export interface AggregateProviderInputArgs {
  provider: SocialProvider;
  posts: StoredSocialPost[];
  comments: StoredSocialComment[];
  cfg: AggregatorConfig;
}

/**
 * Recebe stored posts/comments de UM provider e devolve um `ProviderInput`
 * pronto pra alimentar o pipeline. Campos ausentes (ex.: engagement
 * sem posts na janela) ficam undefined — o pipeline lida com isso.
 */
export function aggregateProviderInput(args: AggregateProviderInputArgs): ProviderInput {
  const { provider, posts, comments, cfg } = args;

  const topicSeries = aggregateTopicSeries(posts, cfg.focusTopics);
  const engagement = buildEngagementSnapshot(posts, cfg);
  const sentiment = buildSentimentSnapshot(comments, cfg);
  const currentPosts = buildCurrentPosts(provider, posts, cfg);
  const topicSnapshots = buildTopicSnapshots(posts, cfg);

  return {
    provider,
    topicSeries: Object.keys(topicSeries).length > 0 ? topicSeries : undefined,
    engagement,
    sentiment,
    currentPosts: currentPosts.length > 0 ? currentPosts : undefined,
    topicSnapshots: topicSnapshots.length > 0 ? topicSnapshots : undefined,
    // followers: NÃO temos snapshot de followers em social_posts.
    // Adição futura via nova tabela ou coluna dedicada.
  };
}

export const SOCIAL_SIGNAL_AGGREGATORS_VERSION = '2026-08-27.v1';
