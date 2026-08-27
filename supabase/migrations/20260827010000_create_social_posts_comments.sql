-- Ingestion Engine (§33-§37 do PRD Social Intelligence).
--
-- Duas tabelas normalizadas onde os adapters (PR 3-7) despejam via
-- SocialIngestionService: `social_posts` e `social_comments`. Ambas com
-- UNIQUE constraint que garante IDEMPOTÊNCIA no sync (§34): "mesmo webhook
-- recebido 5 vezes → processado uma vez".
--
-- SEPARADAS de `social_metrics_daily` (que é snapshot AGREGADO diário do
-- perfil). Aqui é grão POST/COMMENT individual — necessário para
-- Intelligence Engine (§38+), Cross-network correlator (§46) e drill-down
-- de evidências no Pulso Digital (§58).
--
-- Provenance (§37) é obrigatória — jsonb NOT NULL. Sem provenance, não
-- podemos dizer se um dado é observado, agregado ou inferido; e não
-- podemos exibir a fonte no drill-down.
--
-- 100% aditivo: nenhuma tabela existente é modificada.

-- ── social_posts ─────────────────────────────────────────────────────
--
-- Uma row por post orgânico do candidato no provider. `metrics` jsonb
-- permite evoluir sem migration (novos campos como reach, saves etc.).
-- `provenance` obrigatória — sem ela não podemos exibir a fonte.

CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" TEXT NOT NULL,
  provider TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "accountExternalId" TEXT NOT NULL,
  "publishedAt" TIMESTAMPTZ NOT NULL,
  "contentType" TEXT NOT NULL,
  text TEXT NULL,
  permalink TEXT NULL,
  metrics JSONB NULL,
  "rawMetadata" JSONB NULL,
  provenance JSONB NOT NULL,
  "ingestedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("campaignId", provider, "externalId"),
  CONSTRAINT social_posts_content_type_check
    CHECK ("contentType" IN ('text', 'image', 'video', 'short', 'carousel', 'other'))
);

CREATE INDEX IF NOT EXISTS social_posts_lookup_idx
  ON social_posts ("campaignId", provider, "publishedAt" DESC);

CREATE INDEX IF NOT EXISTS social_posts_account_idx
  ON social_posts ("campaignId", "accountExternalId");

CREATE INDEX IF NOT EXISTS social_posts_published_idx
  ON social_posts ("publishedAt" DESC);

ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_posts_read_own' AND tablename = 'social_posts') THEN
    CREATE POLICY social_posts_read_own ON social_posts
      FOR SELECT
      USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_posts_service_all' AND tablename = 'social_posts') THEN
    CREATE POLICY social_posts_service_all ON social_posts
      FOR ALL
      TO service_role
      USING (TRUE)
      WITH CHECK (TRUE);
  END IF;
END $$;

-- ── social_comments ─────────────────────────────────────────────────
--
-- Uma row por comentário — próprio ou público terceirizado (Meta libera
-- só contagem de terceiros, mas o adapter injeta o texto onde tem).
-- postExternalId aponta pro `externalId` de `social_posts` — sem foreign
-- key porque o comment pode chegar antes do post (§33 fluxo assíncrono).

CREATE TABLE IF NOT EXISTS social_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" TEXT NOT NULL,
  provider TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "postExternalId" TEXT NOT NULL,
  "authorPublicId" TEXT NULL,
  text TEXT NULL,
  "publishedAt" TIMESTAMPTZ NOT NULL,
  likes INTEGER NULL,
  replies INTEGER NULL,
  provenance JSONB NOT NULL,
  "ingestedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("campaignId", provider, "externalId")
);

CREATE INDEX IF NOT EXISTS social_comments_lookup_idx
  ON social_comments ("campaignId", provider, "publishedAt" DESC);

CREATE INDEX IF NOT EXISTS social_comments_by_post_idx
  ON social_comments ("campaignId", provider, "postExternalId");

CREATE INDEX IF NOT EXISTS social_comments_published_idx
  ON social_comments ("publishedAt" DESC);

ALTER TABLE social_comments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_comments_read_own' AND tablename = 'social_comments') THEN
    CREATE POLICY social_comments_read_own ON social_comments
      FOR SELECT
      USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_comments_service_all' AND tablename = 'social_comments') THEN
    CREATE POLICY social_comments_service_all ON social_comments
      FOR ALL
      TO service_role
      USING (TRUE)
      WITH CHECK (TRUE);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
