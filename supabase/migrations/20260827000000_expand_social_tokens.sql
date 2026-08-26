-- Expande `social_tokens` para o contrato Social Intelligence (§14/§15 do PRD)
-- sem quebrar o schema atual — todas as colunas novas são NULLABLE ou têm
-- DEFAULT. Nenhuma coluna existente é removida ou renomeada.
--
-- CRIPTOGRAFIA: mantemos as colunas `access_token`/`refresh_token` (TEXT)
-- porque o fieldCrypto do projeto usa um formato SELF-DESCRIBING (prefixo
-- `enc:v1:...`). O `SocialCredentialService` grava cifrado in-place; leituras
-- de linhas legadas em plaintext continuam funcionando via `decryptField`
-- (migração suave — padrão já usado em CPF/CNPJ/RG, `settingsRouter`,
-- `teamMembersRouter`, `contractsRouter`).
--
-- Portanto ESTA migration é 100% aditiva: PR 3 (adapters) vai começar a
-- gravar cifrado; PR futuro vai backfillear linhas legadas via endpoint
-- `/api/v1/social/migrate-encrypt` (padrão do `settings/migrate-encrypt`).
--
-- ADR-01 (SOCIAL-GAP-MATRIX §17): decidimos EXPANDIR ao invés de renomear
-- para `social_connections`. Preservando `sql/07_social_integration.sql`
-- policy e evitando `search_path` broken em produção.

-- ── Campos de identidade e escopo ──────────────────────────────────────
-- providerAccountId: external ID (X user id, LI URN, IG business account id, etc.)
-- handle: @username público — útil pra UI de "Redes conectadas" (§104)
-- scopes: array de escopos OAuth concedidos (jsonb para permitir strings arbitrárias)
ALTER TABLE social_tokens
  ADD COLUMN IF NOT EXISTS "providerAccountId" TEXT NULL;

ALTER TABLE social_tokens
  ADD COLUMN IF NOT EXISTS handle TEXT NULL;

ALTER TABLE social_tokens
  ADD COLUMN IF NOT EXISTS scopes JSONB NULL;

-- ── Ciclo de vida da conexão ──────────────────────────────────────────
-- granted_at: momento em que o usuário deu consent (≠ createdAt que pode ter
-- sido migração de dado antigo)
-- revoked_at: quando a conexão foi explicitamente desconectada
-- status: 'active' | 'expired' | 'revoked' | 'error'. Enum-like text com CHECK
--         para não travar migração futura.
ALTER TABLE social_tokens
  ADD COLUMN IF NOT EXISTS granted_at TIMESTAMPTZ NULL;

ALTER TABLE social_tokens
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ NULL;

ALTER TABLE social_tokens
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_tokens_status_check'
  ) THEN
    ALTER TABLE social_tokens
      ADD CONSTRAINT social_tokens_status_check
      CHECK (status IN ('active', 'expired', 'revoked', 'error', 'requires_reauth'));
  END IF;
END $$;

-- ── Diagnóstico de falha ──────────────────────────────────────────────
-- last_error_code: código curto (rate_limited, auth_expired, api_change, ...)
--                  para o dashboard de saúde (§86) — texto humano vai em
--                  audit_logs, aqui só o slug para agrupamento.
ALTER TABLE social_tokens
  ADD COLUMN IF NOT EXISTS last_error_code TEXT NULL;

-- ── Índices auxiliares ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS social_tokens_status_idx
  ON social_tokens ("campaignId", status)
  WHERE status <> 'revoked';

CREATE INDEX IF NOT EXISTS social_tokens_provider_account_idx
  ON social_tokens (provider, "providerAccountId")
  WHERE "providerAccountId" IS NOT NULL;

NOTIFY pgrst, 'reload schema';
