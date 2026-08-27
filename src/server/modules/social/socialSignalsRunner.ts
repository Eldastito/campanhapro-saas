/**
 * socialSignalsRunner — wiring entre stored data (Supabase) e o
 * SocialSignalsPipeline (PR 13).
 *
 * FLUXO:
 *   queryStoredPosts + queryStoredComments (por campaign, com lookback)
 *      ↓
 *   agrupa por provider
 *      ↓
 *   aggregateProviderInput por provider (PR 14)
 *      ↓
 *   runSocialSignalsPipeline (PR 13)
 *      ↓
 *   PipelineResult
 *
 * PORQUÊ FICOU EM MÓDULO SEPARADO (não em socialIngestionService):
 *   O ingestion service tem uma responsabilidade clara — trazer dados
 *   de fora pra dentro. Computar signals a partir do que já está dentro
 *   é o INVERSO (usar o que foi ingerido). Manter separado deixa o dep
 *   graph mais fácil de raciocinar.
 *
 * REGRA §39: DETERMINÍSTICO. As decisões continuam determinísticas —
 * este módulo só faz I/O de leitura em Supabase e delega tudo pros
 * aggregators + pipeline puros.
 *
 * REGRA §35: ISOLAMENTO POR CAMPANHA. `campaignId` obrigatório;
 * queryStoredPosts/Comments já filtra por campaignId antes de qualquer
 * agregação. Cross-tenant é IMPOSSÍVEL aqui.
 *
 * O que este módulo NÃO faz:
 *   - Não persiste `SocialSignal[]` em Postgres (fica pro próximo PR).
 *   - Não dispara notificação (Slack/email/push).
 *   - Não faz OAuth / refresh de token — só lê o que já foi ingerido.
 *   - Não trata followers (aggregator não tem essa dimensão — fica pra
 *     PR futuro com nova tabela ou coluna).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SocialProvider } from './contracts/socialProvider.js';
import {
  queryStoredPosts,
  queryStoredComments,
  type StoredSocialPost,
  type StoredSocialComment,
} from './socialIngestionService.js';
import type {
  ProviderInput,
  PipelineInput,
  PipelineResult,
} from './intelligence/socialSignalsPipeline.js';
import { runSocialSignalsPipeline } from './intelligence/socialSignalsPipeline.js';
import { aggregateProviderInput } from './intelligence/socialSignalAggregators.js';
import type { AggregatorConfig } from './intelligence/socialSignalAggregators.js';
import type { SocialTopic } from './intelligence/topicClassifier.js';
import type { TrendWindow, DetectTrendOptions } from './intelligence/trendDetector.js';
import type { AnomalyDetectorConfig } from './intelligence/anomalyDetector.js';
import type { CorrelateNetworksOptions } from './intelligence/crossNetworkCorrelator.js';
import type { SignalBusOptions } from './intelligence/socialSignalBus.js';
import { isSocialProvider } from './contracts/socialProvider.js';
import { persistSignals, type PersistSignalsResult } from './socialSignalStore.js';
import {
  broadcastSignals,
  broadcastConfigFromEnv,
  type BroadcastConfig,
  type BroadcastResult,
} from './socialSignalsBroadcaster.js';

// ── Config ──────────────────────────────────────────────────────────

export interface ComputeCampaignSignalsOptions {
  /** Momento de referência (default: new Date()). Passar explícito para determinismo em testes. */
  now?: Date;

  /** Filtra os providers a considerar. Se omitido, usa TODOS os providers com dados. */
  providers?: readonly SocialProvider[];

  /** Filtra topics a monitorar (§40). Se omitido, todos que aparecerem. */
  focusTopics?: readonly SocialTopic[];

  /** Duração da janela (current e baseline) em ms. Default 24h. */
  windowMs?: number;

  /** Data mínima de post/comment a considerar. Default: now - 4*windowMs
   *  (2 windows atrás + folga). */
  postsSince?: Date;

  /** Limite de posts a puxar do banco. Default 500. */
  postsLimit?: number;
  /** Limite de comments a puxar do banco. Default 1000. */
  commentsLimit?: number;

  /** Windows passados pro pipeline (default ['24h']). */
  windows?: TrendWindow[];

  anomalyConfig?: Partial<AnomalyDetectorConfig>;
  trendOptions?: Omit<DetectTrendOptions, 'now' | 'window' | 'series'>;
  correlateOptions?: CorrelateNetworksOptions;
  busOptions?: SignalBusOptions;

  /**
   * Se true, grava (upsert) os signals resultantes em `social_signals`
   * — idempotente por UNIQUE(campaignId, dedupKey). Default false para
   * preservar o contrato original do runner: consumer que só quer
   * "ver" os signals não paga custo de escrita.
   */
  persist?: boolean;

  /**
   * Se true, broadcasta os signals no canal
   * `campaign:<campaignId>:social_signals` via /realtime/v1/api/broadcast
   * (CLAUDE.md — Broadcast, não postgres_changes). Default false.
   * Config vem de `broadcastConfig` (injetado) ou das env vars
   * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
   * Sem env válido → skip silencioso (reason='skipped_no_env').
   */
  broadcast?: boolean;

  /**
   * Config explícito para broadcast — supabaseUrl, serviceRoleKey e
   * fetchImpl (útil pra tests). Se omitido e broadcast=true, lê das
   * env vars via broadcastConfigFromEnv().
   */
  broadcastConfig?: BroadcastConfig;
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_POSTS_LIMIT = 500;
const DEFAULT_COMMENTS_LIMIT = 1000;

// ── API pública ─────────────────────────────────────────────────────

/**
 * Extensão do PipelineResult quando `persist: true` e/ou `broadcast: true`
 * foram passados ao runner — carrega o outcome de cada operação.
 * Compatível com quem não setou (os campos ficam ausentes).
 */
export type ComputeCampaignSignalsResult = PipelineResult & {
  persist?: PersistSignalsResult;
  broadcast?: BroadcastResult;
};

/**
 * Roda a cadeia inteira de intelligence pra UMA campanha. Lê apenas os
 * dados dessa campanha (§35). Consumidor típico: cron horário do Pulso
 * Digital, webhook de post-ingest, endpoint on-demand de dashboard.
 *
 * Por default NÃO grava — o consumer decide o que fazer com o result.
 * Passe `opts.persist = true` para upsert em `social_signals` (PR 16 —
 * idempotente por UNIQUE(campaignId, dedupKey)).
 */
export async function computeCampaignSocialSignals(
  supabase: SupabaseClient,
  campaignId: string,
  opts: ComputeCampaignSignalsOptions = {},
): Promise<ComputeCampaignSignalsResult> {
  if (!campaignId) throw new Error('computeCampaignSocialSignals: campaignId obrigatório');

  const now = opts.now ?? new Date();
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const postsSince = opts.postsSince ?? new Date(now.getTime() - 4 * windowMs);

  const providersFilter = opts.providers && opts.providers.length > 0
    ? new Set<SocialProvider>(opts.providers)
    : null;

  // Buscamos TUDO da campanha desde `postsSince` e filtramos providers
  // em memória. Isso evita N chamadas ao Supabase (uma por provider) —
  // vale a pena porque temos apenas 7 providers máx no PRD.
  const [allPosts, allComments] = await Promise.all([
    queryStoredPosts(supabase, campaignId, {
      since: postsSince,
      limit: opts.postsLimit ?? DEFAULT_POSTS_LIMIT,
    }),
    queryStoredComments(supabase, campaignId, {
      since: postsSince,
      limit: opts.commentsLimit ?? DEFAULT_COMMENTS_LIMIT,
    }),
  ]);

  // Agrupa por provider validado (§32 — providers desconhecidos são
  // ignorados no pipeline; podem existir no banco por causa de
  // seed/migração antiga)
  const postsByProvider = new Map<SocialProvider, StoredSocialPost[]>();
  const commentsByProvider = new Map<SocialProvider, StoredSocialComment[]>();

  const consider = (p: string): p is SocialProvider => {
    if (!isSocialProvider(p)) return false;
    if (providersFilter && !providersFilter.has(p)) return false;
    return true;
  };

  for (const post of allPosts) {
    if (!consider(post.provider)) continue;
    const arr = postsByProvider.get(post.provider) ?? [];
    arr.push(post);
    postsByProvider.set(post.provider, arr);
  }
  for (const cmt of allComments) {
    if (!consider(cmt.provider)) continue;
    const arr = commentsByProvider.get(cmt.provider) ?? [];
    arr.push(cmt);
    commentsByProvider.set(cmt.provider, arr);
  }

  // Une conjunto de providers vistos (posts ou comments) — assim mesmo
  // um provider que só tem comments (raro, mas possível) entra no pipeline.
  const providersSeen = new Set<SocialProvider>();
  for (const p of postsByProvider.keys()) providersSeen.add(p);
  for (const p of commentsByProvider.keys()) providersSeen.add(p);

  const aggCfg: AggregatorConfig = {
    now,
    windowMs,
    focusTopics: opts.focusTopics,
  };

  const perProvider: ProviderInput[] = [];
  for (const provider of providersSeen) {
    perProvider.push(aggregateProviderInput({
      provider,
      posts: postsByProvider.get(provider) ?? [],
      comments: commentsByProvider.get(provider) ?? [],
      cfg: aggCfg,
    }));
  }

  const pipelineInput: PipelineInput = {
    now,
    windows: opts.windows,
    perProvider,
    anomalyConfig: opts.anomalyConfig,
    trendOptions: opts.trendOptions,
    correlateOptions: opts.correlateOptions,
    busOptions: opts.busOptions,
  };

  const pipelineResult = runSocialSignalsPipeline(pipelineInput);

  const result: ComputeCampaignSignalsResult = { ...pipelineResult };

  if (opts.persist) {
    result.persist = await persistSignals(supabase, campaignId, pipelineResult.signals);
  }

  if (opts.broadcast) {
    const cfg = opts.broadcastConfig ?? broadcastConfigFromEnv();
    if (cfg) {
      result.broadcast = await broadcastSignals(cfg, campaignId, pipelineResult.signals);
    } else {
      result.broadcast = {
        attempted: pipelineResult.signals.length,
        broadcast: 0,
        reason: 'skipped_no_env',
      };
    }
  }

  return result;
}

export const SOCIAL_SIGNALS_RUNNER_VERSION = '2026-08-27.v1';
