-- Social Signals persistência (§48-§49 + §58 do PRD Social Intelligence).
--
-- Onde o `SocialSignalsPipeline` (PR 13) despeja o resultado quando o
-- runner (PR 15) roda com `persist: true`. Consumida pelo Pulso Digital
-- (§53-§59), pelas notificações (Slack/email/push), e por relatórios
-- históricos.
--
-- DEDUP no banco: UNIQUE(campaignId, dedupKey). O bus já dedup em
-- memória, mas persistência precisa ser IDEMPOTENTE — mesma run 2×
-- não deve criar 2 rows do mesmo signal.
--
-- Corpo é o JSON completo em `payload` — reconstruímos o SocialSignal
-- inteiro na leitura. Campos escalares (severity, source, topic,
-- provider array) ficam no top-level para índices, filtros e RLS.
--
-- 100% aditivo: nenhuma tabela existente é modificada.

CREATE TABLE IF NOT EXISTS social_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" TEXT NOT NULL,
  "dedupKey" TEXT NOT NULL,
  source TEXT NOT NULL,
  severity TEXT NOT NULL,
  summary TEXT NOT NULL,
  hypotheses JSONB NOT NULL DEFAULT '[]'::jsonb,
  providers JSONB NOT NULL DEFAULT '[]'::jsonb,
  topic TEXT NULL,
  confidence NUMERIC(4,3) NOT NULL,
  "emittedAt" TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  "busVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("campaignId", "dedupKey"),
  CONSTRAINT social_signals_source_check
    CHECK (source IN ('trend', 'anomaly', 'cross_network_trend', 'cross_network_anomaly')),
  CONSTRAINT social_signals_severity_check
    CHECK (severity IN ('info', 'attention', 'risk', 'crisis')),
  CONSTRAINT social_signals_confidence_range
    CHECK (confidence >= 0 AND confidence <= 1)
);

-- Índices pro Pulso Digital:
--   1. listagem por campanha ordenada por emittedAt DESC (feed)
--   2. filtros por severity (só "risk+")
--   3. filtro por topic (drill-down §58)

CREATE INDEX IF NOT EXISTS social_signals_feed_idx
  ON social_signals ("campaignId", "emittedAt" DESC);

CREATE INDEX IF NOT EXISTS social_signals_severity_idx
  ON social_signals ("campaignId", severity, "emittedAt" DESC);

CREATE INDEX IF NOT EXISTS social_signals_topic_idx
  ON social_signals ("campaignId", topic, "emittedAt" DESC)
  WHERE topic IS NOT NULL;

CREATE INDEX IF NOT EXISTS social_signals_source_idx
  ON social_signals ("campaignId", source, "emittedAt" DESC);

ALTER TABLE social_signals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_signals_read_own' AND tablename = 'social_signals') THEN
    CREATE POLICY social_signals_read_own ON social_signals
      FOR SELECT
      USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_signals_service_all' AND tablename = 'social_signals') THEN
    CREATE POLICY social_signals_service_all ON social_signals
      FOR ALL
      TO service_role
      USING (TRUE)
      WITH CHECK (TRUE);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
