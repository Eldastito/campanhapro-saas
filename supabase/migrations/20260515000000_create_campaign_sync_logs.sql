-- Phase 1: Intelligence sync log
-- Tracks when each campaign last pushed a snapshot to CampanhaProCenarios.

CREATE TABLE IF NOT EXISTS campaign_sync_logs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"        text        NOT NULL UNIQUE,
  "lastSyncAt"        timestamptz NOT NULL,
  "snapshotVersion"   text        NOT NULL DEFAULT 'campanhapro.snapshot.v1',
  "visitCount"        integer     NOT NULL DEFAULT 0,
  "pesquisaCount"     integer     NOT NULL DEFAULT 0,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE campaign_sync_logs ENABLE ROW LEVEL SECURITY;

-- Campaign members can read their own sync log
CREATE POLICY "Campaign members can read their sync log"
  ON campaign_sync_logs FOR SELECT
  USING (
    "campaignId" IN (
      SELECT campaign_id::text FROM users WHERE id = auth.uid()
    )
  );

-- Backend service role can read/write freely
CREATE POLICY "Service role bypass"
  ON campaign_sync_logs FOR ALL
  USING (auth.role() = 'service_role');
