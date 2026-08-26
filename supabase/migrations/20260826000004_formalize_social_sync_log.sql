-- Formaliza `social_sync_log`. Descoberta como GHOST TABLE no F0 audit.
--
-- 1 linha por campanha (UNIQUE campaignId). Funciona como LOCK OTIMISTA
-- do worker de sync social — `routinesWorker.ts:243-252`:
--   UPSERT { campaignId, updatedAt } ON CONFLICT (campaignId)
--   UPDATE lastSyncedDate = today WHERE lastSyncedDate < today
--   Se nenhuma linha atualizada → outro worker já pegou → pula (§4.1 do PRD
--   ainda usa setInterval single-instance, mas o lock é defensivo).
--
-- Também guarda a última mudança significativa detectada
-- (`routinesWorker.ts:277`) para a UI de "Última mudança".

CREATE TABLE IF NOT EXISTS social_sync_log (
  "campaignId" TEXT PRIMARY KEY,
  "lastSyncedDate" DATE NULL,
  "lastSyncedAt" TIMESTAMPTZ NULL,
  "lastChangeDetected" JSONB NULL,     -- {detectedAt, reasons[], summary}
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS social_sync_log_last_synced_idx
  ON social_sync_log ("lastSyncedDate");

ALTER TABLE social_sync_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_sync_log_read_own' AND tablename = 'social_sync_log') THEN
    CREATE POLICY social_sync_log_read_own ON social_sync_log
      FOR SELECT
      USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_sync_log_service_all' AND tablename = 'social_sync_log') THEN
    CREATE POLICY social_sync_log_service_all ON social_sync_log
      FOR ALL
      TO service_role
      USING (TRUE)
      WITH CHECK (TRUE);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
