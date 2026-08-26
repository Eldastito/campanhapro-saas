-- Formaliza `social_metrics_daily`. Descoberta como GHOST TABLE no F0 audit
-- (docs/social/SOCIAL-AS-IS.md §6, B1) — usada em código sem migration versionada.
--
-- Grava um snapshot diário por (campaignId, provider). Alimentada por
-- `src/lib/socialSyncRunner.ts:132` (upsert com onConflict acima).
-- Lida em `socialRouter.ts:76` (`GET /metrics/:provider`) e no detector de
-- mudança significativa (`socialSyncRunner.ts:175-178`).
--
-- Schema espelha exatamente o objeto `metricsRow` construído em
-- `socialSyncRunner.ts` para os 3 providers cobertos hoje (x/linkedin/kwai).
-- Colunas nulas para métricas não expostas pela API do provider (§20 do PRD:
-- LinkedIn não devolve engagement7d → coluna fica NULL, nunca 0).

CREATE TABLE IF NOT EXISTS social_metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" TEXT NOT NULL,
  provider TEXT NOT NULL,              -- 'x' | 'linkedin' | 'kwai' hoje; expandir por PR
  "snapshotDate" DATE NOT NULL,
  handle TEXT NULL,
  followers INTEGER NULL,
  following INTEGER NULL,
  "postsCount" INTEGER NULL,
  "impressions7d" INTEGER NULL,
  "engagement7d" INTEGER NULL,
  "topPosts" JSONB NULL,               -- array de posts com métricas normalizadas
  raw JSONB NULL,                       -- payload bruto do provider (auditoria)
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("campaignId", provider, "snapshotDate")
);

CREATE INDEX IF NOT EXISTS social_metrics_daily_lookup_idx
  ON social_metrics_daily ("campaignId", provider, "snapshotDate" DESC);

ALTER TABLE social_metrics_daily ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_metrics_daily_read_own' AND tablename = 'social_metrics_daily') THEN
    CREATE POLICY social_metrics_daily_read_own ON social_metrics_daily
      FOR SELECT
      USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_metrics_daily_service_all' AND tablename = 'social_metrics_daily') THEN
    CREATE POLICY social_metrics_daily_service_all ON social_metrics_daily
      FOR ALL
      TO service_role
      USING (TRUE)
      WITH CHECK (TRUE);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
