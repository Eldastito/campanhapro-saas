/**
 * SocialProviderAdapter — contrato único que todos os providers sociais
 * implementam. §11 do PRD.
 *
 * F1 cria apenas o contrato. Os wrappers (X, LinkedIn, Kwai, Instagram)
 * entram em PRs subsequentes (PR 3 e PR 4 do roadmap em
 * docs/social/SOCIAL-GAP-MATRIX.md §19). Publicação e webhooks são
 * opcionais no contrato porque nem todo provider suporta.
 *
 * Um adapter é STATELESS por instância — recebe `connectionId` em cada
 * chamada e resolve o token/refresh internamente via `SocialCredentialService`
 * (que também entra em F1 mas neste PR ficou fora — está em ADR-01 pendente
 * sobre encrypt at rest de `social_tokens`).
 */

import type { SocialProvider } from './socialProvider.js';
import type {
  SocialCapabilities,
  SocialProviderCapabilitySnapshot,
} from './socialCapabilities.js';

/** Input opaco de OAuth callback — cada provider decide o formato. */
export interface ConnectInput {
  campaignId: string;
  /** Payload cru vindo do OAuth callback (code, state, code_verifier, etc.)
   *  ou de conexão manual (token colado no hub). O adapter valida. */
  payload: Record<string, unknown>;
}

/** Resultado padronizado de uma conexão bem-sucedida. */
export interface ConnectionResult {
  connectionId: string;
  externalAccountId: string;
  displayName: string;
  handle?: string;
  scopes: string[];
  expiresAt?: Date;
}

/** Perfil normalizado — subset comum entre providers. */
export interface NormalizedSocialProfile {
  provider: SocialProvider;
  externalId: string;
  handle?: string;
  displayName?: string;
  bio?: string;
  followers: number | null;
  following: number | null;
  postsCount: number | null;
  avatarUrl?: string;
  raw?: Record<string, unknown>;
}

export interface GetPostsParams {
  since?: Date;
  limit?: number;
}

/** Post normalizado — §35 do PRD. Métricas `null` em vez de `0` quando
 *  não expostas pela API (§20/§103). */
export interface NormalizedSocialPost {
  provider: SocialProvider;
  externalId: string;
  accountExternalId: string;
  publishedAt: Date;
  contentType: 'text' | 'image' | 'video' | 'short' | 'carousel' | 'other';
  text?: string;
  permalink?: string;
  metrics: {
    views: number | null;
    reach: number | null;
    impressions: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    watchTime: number | null;
  };
  rawMetadata?: Record<string, unknown>;
}

export interface GetCommentsParams {
  postExternalId?: string;
  since?: Date;
  limit?: number;
}

/** Comentário normalizado — §36 do PRD. */
export interface NormalizedSocialComment {
  provider: SocialProvider;
  externalId: string;
  postExternalId: string;
  authorPublicId?: string;
  text?: string;
  publishedAt: Date;
  likes: number | null;
  replies: number | null;
  provenance: SocialProvenance;
}

/** §37 do PRD — proveniência obrigatória de todo dado ingerido. */
export interface SocialProvenance {
  provider: SocialProvider;
  sourceType: 'owned' | 'public' | 'listening_provider';
  collectedAt: Date;
  sourceUrl?: string;
  dataAvailability: 'observed' | 'provider_aggregated' | 'inferred';
}

export interface MetricsParams {
  since?: Date;
  until?: Date;
}

export interface NormalizedSocialMetrics {
  provider: SocialProvider;
  windowStart: Date;
  windowEnd: Date;
  followers: number | null;
  impressions: number | null;
  engagement: number | null;
  reach: number | null;
  raw?: Record<string, unknown>;
}

export interface PublishPayload {
  text?: string;
  imageUrls?: string[];
  videoUrl?: string;
  scheduledAt?: Date;
}

export interface PublishResult {
  externalPostId: string;
  permalink?: string;
  publishedAt: Date;
  status: 'published' | 'scheduled';
  raw?: Record<string, unknown>;
}

/**
 * O contrato. Métodos opcionais são anotados — a maioria dos providers hoje
 * não expõe `publish` nem `getMentions`, e o registry (§12) reflete isso.
 */
export interface SocialProviderAdapter {
  readonly provider: SocialProvider;

  /** Snapshot estático de capabilities. Não faz I/O — vem do registry. */
  getCapabilities(): SocialProviderCapabilitySnapshot;

  /** Cria conexão a partir de callback OAuth ou paste manual. */
  connect(input: ConnectInput): Promise<ConnectionResult>;

  /** Revoga a conexão no provider (quando suportado) e apaga localmente. */
  disconnect(connectionId: string): Promise<void>;

  /** Roda refresh do access_token se aplicável. */
  refreshCredentials(connectionId: string): Promise<void>;

  /** Leituras — cada uma pode lançar se a capability não for `supported`.
   *  O caller deve checar `getCapabilities()` antes. */
  getProfile(connectionId: string): Promise<NormalizedSocialProfile>;
  getPosts(connectionId: string, params?: GetPostsParams): Promise<NormalizedSocialPost[]>;
  getComments(connectionId: string, params?: GetCommentsParams): Promise<NormalizedSocialComment[]>;
  getMetrics(connectionId: string, params?: MetricsParams): Promise<NormalizedSocialMetrics>;

  /** Opcional: menções ao candidato (via Listening Provider ou API nativa). */
  getMentions?(connectionId: string, since?: Date): Promise<NormalizedSocialComment[]>;

  /** Opcional: publicação. §70 do PRD — o adapter é executado APENAS depois
   *  da aprovação humana enforced pelo Publisher. Nunca chamar direto. */
  publish?(connectionId: string, payload: PublishPayload): Promise<PublishResult>;
}

/**
 * Helper para determinar se uma capability pode ser chamada agora.
 * `permission_required` e `not_configured` são recuperáveis mas hoje,
 * neste momento, a capability NÃO está disponível — o helper devolve `false`.
 */
export function isCapabilityAvailable(caps: SocialCapabilities, key: keyof SocialCapabilities): boolean {
  return caps[key] === 'supported';
}
