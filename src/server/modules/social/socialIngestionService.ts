/**
 * SocialIngestionService — cola entre `SocialProviderAdapter` (PR 3-7) e as
 * tabelas normalizadas `social_posts` / `social_comments` (§33-§37 do PRD).
 *
 * Fluxo (§33):
 *   provider payload
 *        ↓ (adapter.getPosts / getComments)
 *   schema validation (feito pelo adapter — Normalized* types)
 *        ↓
 *   dedup + upsert (UNIQUE(campaignId, provider, externalId))
 *        ↓
 *   persistência
 *        ↓
 *   [classificação queue vem em PR futuro — Intelligence Engine]
 *
 * IDEMPOTÊNCIA (§34): mesmo webhook recebido 5 vezes → processado 1 vez.
 * Garantida por UNIQUE constraint + `.upsert(..., { onConflict: '...' })`.
 * Upsert atualiza `metrics` e `updatedAt`; NÃO sobrescreve `ingestedAt`
 * (histórico de primeira coleta preservado).
 *
 * TOLERÂNCIA A CAPABILITY FALTANDO: se `adapter.getPosts` lança
 * `SocialCapabilityNotAvailableError` (o provider não suporta essa
 * capability no momento — ex.: TikTok comments), o ingestor devolve
 * `{ ingested: 0, skipped: 0, reason: 'unavailable' }` sem propagar.
 * Isso permite rodar em loop pra TODOS os providers conectados sem
 * quebrar quando um deles não implementou algo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  NormalizedSocialPost,
  NormalizedSocialComment,
  SocialProviderAdapter,
  GetPostsParams,
  GetCommentsParams,
} from './contracts/socialProviderAdapter.js';
import type { SocialProvider } from './contracts/socialProvider.js';
import { SocialCapabilityNotAvailableError } from './adapters/errors.js';

// ── Tipos ────────────────────────────────────────────────────────────

export interface IngestionResult {
  provider: SocialProvider;
  attempted: number;
  ingested: number;
  skipped: number;
  reason?: 'ok' | 'unavailable' | 'connection_not_found' | 'error';
  errorMessage?: string;
}

export interface StoredSocialPost {
  id: string;
  campaignId: string;
  provider: string;
  externalId: string;
  accountExternalId: string;
  publishedAt: string;
  contentType: string;
  text: string | null;
  permalink: string | null;
  metrics: NormalizedSocialPost['metrics'] | null;
  provenance: Record<string, unknown>;
  ingestedAt: string;
  updatedAt: string;
}

export interface StoredSocialComment {
  id: string;
  campaignId: string;
  provider: string;
  externalId: string;
  postExternalId: string;
  authorPublicId: string | null;
  text: string | null;
  publishedAt: string;
  likes: number | null;
  replies: number | null;
  provenance: Record<string, unknown>;
  ingestedAt: string;
  updatedAt: string;
}

export interface QueryPostsParams {
  provider?: SocialProvider;
  since?: Date;
  limit?: number;
}

export interface QueryCommentsParams {
  provider?: SocialProvider;
  postExternalId?: string;
  since?: Date;
  limit?: number;
}

// ── Internos ─────────────────────────────────────────────────────────

function serializeProvenance(p: NormalizedSocialPost extends { provenance: infer P }
  ? P
  : NormalizedSocialComment['provenance']): Record<string, unknown> {
  // Já é um objeto simples — só converte Date pra ISO string pra travar
  // shape no jsonb (Postgres não tem tipo Date).
  return {
    ...(p as any),
    collectedAt: (p as any).collectedAt instanceof Date
      ? (p as any).collectedAt.toISOString()
      : (p as any).collectedAt,
  };
}

function postToRow(campaignId: string, post: NormalizedSocialPost, provenance: Record<string, unknown>) {
  return {
    campaignId,
    provider: post.provider,
    externalId: post.externalId,
    accountExternalId: post.accountExternalId,
    publishedAt: post.publishedAt.toISOString(),
    contentType: post.contentType,
    text: post.text ?? null,
    permalink: post.permalink ?? null,
    metrics: post.metrics,
    rawMetadata: post.rawMetadata ?? null,
    provenance,
    updatedAt: new Date().toISOString(),
  };
}

function commentToRow(campaignId: string, comment: NormalizedSocialComment) {
  return {
    campaignId,
    provider: comment.provider,
    externalId: comment.externalId,
    postExternalId: comment.postExternalId,
    authorPublicId: comment.authorPublicId ?? null,
    text: comment.text ?? null,
    publishedAt: comment.publishedAt.toISOString(),
    likes: comment.likes ?? null,
    replies: comment.replies ?? null,
    provenance: serializeProvenance(comment.provenance),
    updatedAt: new Date().toISOString(),
  };
}

// ── Public API — ingestão ────────────────────────────────────────────

/**
 * Roda `adapter.getPosts` para o `connectionId`, dedup+upsert em
 * `social_posts`. Tolera SocialCapabilityNotAvailableError (skip silencioso).
 *
 * `provenanceOverride` permite o caller estabelecer proveniência quando o
 * post é ingerido por outra rota que não a normalização default (ex.: um
 * post republicado por webhook). Default: `{provider, sourceType:'owned',
 * collectedAt:new Date(), dataAvailability:'observed'}`.
 */
export async function ingestPosts(
  supabase: SupabaseClient,
  adapter: SocialProviderAdapter,
  campaignId: string,
  connectionId: string,
  params?: GetPostsParams,
  provenanceOverride?: Partial<NormalizedSocialPost extends { provenance?: infer P } ? P : never>,
): Promise<IngestionResult> {
  if (!campaignId) throw new Error('ingestPosts: campaignId obrigatório');
  if (!connectionId) throw new Error('ingestPosts: connectionId obrigatório');

  let posts: NormalizedSocialPost[];
  try {
    posts = await adapter.getPosts(connectionId, params);
  } catch (err: unknown) {
    if (err instanceof SocialCapabilityNotAvailableError) {
      return {
        provider: adapter.provider,
        attempted: 0,
        ingested: 0,
        skipped: 0,
        reason: 'unavailable',
        errorMessage: err.message,
      };
    }
    // ConnectionNotFound e outros → propagar com marca
    return {
      provider: adapter.provider,
      attempted: 0,
      ingested: 0,
      skipped: 0,
      reason: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  if (!posts.length) {
    return { provider: adapter.provider, attempted: 0, ingested: 0, skipped: 0, reason: 'ok' };
  }

  const defaultProvenance = {
    provider: adapter.provider,
    sourceType: 'owned' as const,
    collectedAt: new Date().toISOString(),
    dataAvailability: 'observed' as const,
    ...provenanceOverride,
  };

  const rows = posts.map(p => postToRow(campaignId, p, defaultProvenance));

  const { error } = await supabase
    .from('social_posts')
    .upsert(rows, { onConflict: 'campaignId,provider,externalId' });

  if (error) {
    return {
      provider: adapter.provider,
      attempted: posts.length,
      ingested: 0,
      skipped: 0,
      reason: 'error',
      errorMessage: `upsert failed: ${error.message}`,
    };
  }

  return {
    provider: adapter.provider,
    attempted: posts.length,
    ingested: posts.length,
    skipped: 0,
    reason: 'ok',
  };
}

/**
 * Idem para comments. `commentToRow` já serializa provenance (que vem do
 * adapter com Date em `collectedAt`).
 */
export async function ingestComments(
  supabase: SupabaseClient,
  adapter: SocialProviderAdapter,
  campaignId: string,
  connectionId: string,
  params?: GetCommentsParams,
): Promise<IngestionResult> {
  if (!campaignId) throw new Error('ingestComments: campaignId obrigatório');
  if (!connectionId) throw new Error('ingestComments: connectionId obrigatório');

  let comments: NormalizedSocialComment[];
  try {
    comments = await adapter.getComments(connectionId, params);
  } catch (err: unknown) {
    if (err instanceof SocialCapabilityNotAvailableError) {
      return {
        provider: adapter.provider,
        attempted: 0,
        ingested: 0,
        skipped: 0,
        reason: 'unavailable',
        errorMessage: err.message,
      };
    }
    return {
      provider: adapter.provider,
      attempted: 0,
      ingested: 0,
      skipped: 0,
      reason: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  if (!comments.length) {
    return { provider: adapter.provider, attempted: 0, ingested: 0, skipped: 0, reason: 'ok' };
  }

  const rows = comments.map(c => commentToRow(campaignId, c));

  const { error } = await supabase
    .from('social_comments')
    .upsert(rows, { onConflict: 'campaignId,provider,externalId' });

  if (error) {
    return {
      provider: adapter.provider,
      attempted: comments.length,
      ingested: 0,
      skipped: 0,
      reason: 'error',
      errorMessage: `upsert failed: ${error.message}`,
    };
  }

  return {
    provider: adapter.provider,
    attempted: comments.length,
    ingested: comments.length,
    skipped: 0,
    reason: 'ok',
  };
}

// ── Public API — leituras (consumers: Intelligence Engine, Pulso Digital) ──

/**
 * Lê posts recentes de uma campanha. Filtro opcional por provider e por
 * `since` (só posts publicados desde essa data).
 *
 * NÃO é read-through: só devolve o que foi ingerido. Chamar isto antes de
 * `ingestPosts` numa fresh campaign retorna `[]` — comportamento correto:
 * o ingestor precisa rodar primeiro.
 */
export async function queryStoredPosts(
  supabase: SupabaseClient,
  campaignId: string,
  params: QueryPostsParams = {},
): Promise<StoredSocialPost[]> {
  let q = supabase
    .from('social_posts')
    .select('*')
    .eq('campaignId', campaignId)
    .order('publishedAt', { ascending: false })
    .limit(params.limit ?? 100);

  if (params.provider) q = q.eq('provider', params.provider);
  if (params.since) q = q.gte('publishedAt', params.since.toISOString());

  const { data, error } = await q;
  if (error) throw new Error(`queryStoredPosts failed: ${error.message}`);
  return (data ?? []) as StoredSocialPost[];
}

export async function queryStoredComments(
  supabase: SupabaseClient,
  campaignId: string,
  params: QueryCommentsParams = {},
): Promise<StoredSocialComment[]> {
  let q = supabase
    .from('social_comments')
    .select('*')
    .eq('campaignId', campaignId)
    .order('publishedAt', { ascending: false })
    .limit(params.limit ?? 100);

  if (params.provider) q = q.eq('provider', params.provider);
  if (params.postExternalId) q = q.eq('postExternalId', params.postExternalId);
  if (params.since) q = q.gte('publishedAt', params.since.toISOString());

  const { data, error } = await q;
  if (error) throw new Error(`queryStoredComments failed: ${error.message}`);
  return (data ?? []) as StoredSocialComment[];
}
