/**
 * SocialCredentialService — encriptação em repouso de credenciais OAuth
 * dos providers sociais. §14 do PRD Social Intelligence.
 *
 * REUSA `fieldCrypto` (mesmo módulo que já protege CPF/CNPJ/RG/PIX). Formato
 * self-describing (`enc:v1:...`), então:
 *   - grava sempre CIFRADO (encryptField é idempotente — não recifra)
 *   - lê descriptografando (decryptField deixa plaintext passar sem tocar,
 *     migração suave — linhas legadas continuam funcionando)
 *
 * PR 2 apenas INTRODUZ o módulo isolado (ninguém consome ainda). PR 3
 * (wrappers X/LI/Kwai) e PR 5 (Meta OAuth completo) vão trocar as escritas
 * atuais em `social_tokens` por chamadas aqui.
 *
 * Backfill das linhas legadas (que estão em plaintext na coluna access_token)
 * vem num PR separado via endpoint `/api/v1/social/migrate-encrypt` — padrão
 * já estabelecido em `settingsRouter.migrate-encrypt` e em `teamMembersRouter`.
 *
 * SEGURANÇA:
 *   - Nada nesta API retorna access_token/refresh_token como campo de dado.
 *     Se precisar dos tokens para uma chamada HTTP a um provider, use
 *     `revealTokens()` — método explicitamente marcado como server-side only
 *     e o log/audit deve registrar o motivo.
 *   - `describe()` devolve metadata segura (handle, provider, status, expiresAt)
 *     — é o que a UI recebe.
 *   - Tenant isolation é responsabilidade do CALLER: sempre passar campaignId
 *     vindo de `tenantCampaignId(req)`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptField, decryptField } from '../../lib/fieldCrypto.js';
import type { SocialProvider } from './contracts/socialProvider.js';

/** Status persistidos em `social_tokens.status` (CHECK constraint na migration). */
export type SocialConnectionStatus =
  | 'active'
  | 'expired'
  | 'revoked'
  | 'error'
  | 'requires_reauth';

/** View segura da conexão — nunca inclui os tokens brutos. É o que a UI recebe. */
export interface SocialConnectionDescriptor {
  id: string;
  campaignId: string;
  provider: string;
  providerAccountId: string | null;
  handle: string | null;
  scopes: string[];
  status: SocialConnectionStatus;
  expiresAt: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
  lastErrorCode: string | null;
  hasRefreshToken: boolean;
}

/** Input para `saveCredentials`. Tokens em plaintext — o serviço cifra. */
export interface SaveCredentialsInput {
  campaignId: string;
  provider: SocialProvider | string; // aceita string para providers ainda não na union
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | string | null;
  providerAccountId?: string | null;
  handle?: string | null;
  scopes?: readonly string[] | null;
  settings?: Record<string, unknown> | null;
}

/** Tokens em plaintext — retorno restrito de `revealTokens`. */
export interface RevealedTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  providerAccountId: string | null;
}

// ── Row shape (subset) ────────────────────────────────────────────────
interface SocialTokenRow {
  id: string;
  campaignId: string;
  provider: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  providerAccountId: string | null;
  handle: string | null;
  scopes: string[] | null;
  status: SocialConnectionStatus | null;
  granted_at: string | null;
  revoked_at: string | null;
  last_error_code: string | null;
  settings: Record<string, unknown> | null;
}

function toDescriptor(row: SocialTokenRow): SocialConnectionDescriptor {
  return {
    id: row.id,
    campaignId: row.campaignId,
    provider: row.provider,
    providerAccountId: row.providerAccountId ?? null,
    handle: row.handle ?? null,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    status: (row.status ?? 'active') as SocialConnectionStatus,
    expiresAt: row.expires_at,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
    lastErrorCode: row.last_error_code,
    hasRefreshToken: !!row.refresh_token,
  };
}

const SELECT_ALL_COLS =
  'id, "campaignId", provider, access_token, refresh_token, expires_at, "providerAccountId", handle, scopes, status, granted_at, revoked_at, last_error_code, settings';

const SELECT_DESCRIPTOR_COLS =
  'id, "campaignId", provider, "providerAccountId", handle, scopes, status, expires_at, granted_at, revoked_at, last_error_code, refresh_token';

// ── Public API ────────────────────────────────────────────────────────

/**
 * Grava (upsert) credenciais para (campaignId, provider). Tokens sempre
 * cifrados. Idempotente — chamar de novo com mesmos dados só atualiza o row.
 *
 * onConflict: (campaignId, provider) — já existe UNIQUE em social_tokens.
 */
export async function saveCredentials(
  supabase: SupabaseClient,
  input: SaveCredentialsInput,
): Promise<SocialConnectionDescriptor> {
  if (!input.campaignId) throw new Error('campaignId obrigatório');
  if (!input.provider) throw new Error('provider obrigatório');
  if (!input.accessToken) throw new Error('accessToken obrigatório');

  const encryptedAccess = encryptField(input.accessToken);
  const encryptedRefresh = input.refreshToken ? encryptField(input.refreshToken) : null;

  const expiresIso = input.expiresAt
    ? input.expiresAt instanceof Date
      ? input.expiresAt.toISOString()
      : new Date(input.expiresAt).toISOString()
    : null;

  const payload = {
    campaignId: input.campaignId,
    provider: input.provider,
    access_token: encryptedAccess,
    refresh_token: encryptedRefresh,
    expires_at: expiresIso,
    providerAccountId: input.providerAccountId ?? null,
    handle: input.handle ?? null,
    scopes: input.scopes ? [...input.scopes] : null,
    settings: input.settings ?? null,
    status: 'active' as SocialConnectionStatus,
    granted_at: new Date().toISOString(),
    revoked_at: null,
    last_error_code: null,
    updatedAt: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('social_tokens')
    .upsert(payload, { onConflict: 'campaignId,provider' })
    .select(SELECT_ALL_COLS)
    .single();

  if (error) throw new Error(`saveCredentials failed: ${error.message}`);
  return toDescriptor(data as SocialTokenRow);
}

/**
 * Descreve a conexão sem expor tokens. Devolve `null` se não existir.
 * Este é o método que a UI/rotas de status devem usar.
 */
export async function describeConnection(
  supabase: SupabaseClient,
  campaignId: string,
  provider: SocialProvider | string,
): Promise<SocialConnectionDescriptor | null> {
  const { data, error } = await supabase
    .from('social_tokens')
    .select(SELECT_DESCRIPTOR_COLS)
    .eq('campaignId', campaignId)
    .eq('provider', provider)
    .maybeSingle();

  if (error) throw new Error(`describeConnection failed: ${error.message}`);
  if (!data) return null;
  return toDescriptor(data as SocialTokenRow);
}

/**
 * Lista conexões de uma campanha, sem tokens. Ordenado por provider.
 */
export async function listConnections(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<SocialConnectionDescriptor[]> {
  const { data, error } = await supabase
    .from('social_tokens')
    .select(SELECT_DESCRIPTOR_COLS)
    .eq('campaignId', campaignId)
    .order('provider', { ascending: true });

  if (error) throw new Error(`listConnections failed: ${error.message}`);
  return (data ?? []).map(r => toDescriptor(r as SocialTokenRow));
}

/**
 * SERVER-SIDE ONLY. Devolve os tokens em plaintext para chamar a API do
 * provider (refresh, sync, publish). O caller é responsável por:
 *   - NÃO retornar isto ao cliente
 *   - registrar o motivo em audit_logs quando apropriado
 *   - descartar da memória rapidamente
 *
 * Devolve `null` se a conexão não existe. Se estiver revogada, ainda devolve
 * (para permitir refresh — mas o caller deve checar `status` primeiro).
 */
export async function revealTokens(
  supabase: SupabaseClient,
  campaignId: string,
  provider: SocialProvider | string,
): Promise<RevealedTokens | null> {
  const { data, error } = await supabase
    .from('social_tokens')
    .select('access_token, refresh_token, expires_at, "providerAccountId"')
    .eq('campaignId', campaignId)
    .eq('provider', provider)
    .maybeSingle();

  if (error) throw new Error(`revealTokens failed: ${error.message}`);
  if (!data) return null;

  const accessPlain = decryptField(data.access_token);
  const refreshPlain = data.refresh_token ? decryptField(data.refresh_token) : null;

  if (accessPlain === null || accessPlain === undefined) {
    throw new Error(`access_token indisponível para (${campaignId}, ${provider})`);
  }

  return {
    accessToken: String(accessPlain),
    refreshToken: refreshPlain != null ? String(refreshPlain) : null,
    expiresAt: data.expires_at,
    providerAccountId: (data as any).providerAccountId ?? null,
  };
}

/**
 * Atualiza os tokens após refresh OAuth. Preserva metadados (handle, scopes,
 * providerAccountId) — só troca o par de tokens e recalcula expiresAt.
 */
export async function updateTokensAfterRefresh(
  supabase: SupabaseClient,
  campaignId: string,
  provider: SocialProvider | string,
  next: {
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: Date | string | null;
  },
): Promise<void> {
  const encryptedAccess = encryptField(next.accessToken);
  const encryptedRefresh =
    next.refreshToken !== undefined
      ? next.refreshToken
        ? encryptField(next.refreshToken)
        : null
      : undefined; // undefined = não mexer

  const expiresIso = next.expiresAt
    ? next.expiresAt instanceof Date
      ? next.expiresAt.toISOString()
      : new Date(next.expiresAt).toISOString()
    : null;

  const update: Record<string, unknown> = {
    access_token: encryptedAccess,
    expires_at: expiresIso,
    status: 'active' as SocialConnectionStatus,
    last_error_code: null,
    updatedAt: new Date().toISOString(),
  };
  if (encryptedRefresh !== undefined) {
    update.refresh_token = encryptedRefresh;
  }

  const { error } = await supabase
    .from('social_tokens')
    .update(update)
    .eq('campaignId', campaignId)
    .eq('provider', provider);

  if (error) throw new Error(`updateTokensAfterRefresh failed: ${error.message}`);
}

/**
 * Marca a conexão como revogada. NÃO apaga a linha (histórico + auditoria).
 * O caller pode chamar disconnect no provider antes; falha lá não deve
 * bloquear a marcação local.
 */
export async function markRevoked(
  supabase: SupabaseClient,
  campaignId: string,
  provider: SocialProvider | string,
): Promise<void> {
  const { error } = await supabase
    .from('social_tokens')
    .update({
      status: 'revoked' as SocialConnectionStatus,
      revoked_at: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .eq('campaignId', campaignId)
    .eq('provider', provider);

  if (error) throw new Error(`markRevoked failed: ${error.message}`);
}

/**
 * Registra que uma chamada falhou. Não muda o status para 'error'
 * indiscriminadamente — só quando explicitamente pedido (via `escalate=true`),
 * para não flip-flopar entre 'active' e 'error' a cada glitch de rede.
 */
export async function markError(
  supabase: SupabaseClient,
  campaignId: string,
  provider: SocialProvider | string,
  errorCode: string,
  opts: { escalate?: boolean } = {},
): Promise<void> {
  const update: Record<string, unknown> = {
    last_error_code: errorCode.slice(0, 120),
    updatedAt: new Date().toISOString(),
  };
  if (opts.escalate) update.status = 'error' as SocialConnectionStatus;

  const { error } = await supabase
    .from('social_tokens')
    .update(update)
    .eq('campaignId', campaignId)
    .eq('provider', provider);

  if (error) throw new Error(`markError failed: ${error.message}`);
}

/**
 * Marca que o refresh não é mais possível — o usuário precisa reautenticar.
 * Usado quando o refresh_token expirou ou foi revogado pelo provider.
 */
export async function markRequiresReauth(
  supabase: SupabaseClient,
  campaignId: string,
  provider: SocialProvider | string,
  errorCode: string,
): Promise<void> {
  const { error } = await supabase
    .from('social_tokens')
    .update({
      status: 'requires_reauth' as SocialConnectionStatus,
      last_error_code: errorCode.slice(0, 120),
      updatedAt: new Date().toISOString(),
    })
    .eq('campaignId', campaignId)
    .eq('provider', provider);

  if (error) throw new Error(`markRequiresReauth failed: ${error.message}`);
}
