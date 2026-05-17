-- Phase 6: Audit logs for LGPD/TSE compliance + observability

CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"  UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  "actorId"     UUID,                 -- nullable: webhooks/system actors
  "actorType"   TEXT NOT NULL DEFAULT 'user'
                  CHECK ("actorType" IN ('user', 'system', 'webhook', 'agent')),
  action        TEXT NOT NULL,        -- e.g. 'dossier.approve', 'message.send', 'consent.grant'
  "resourceType" TEXT,                -- e.g. 'dossier', 'message', 'task'
  "resourceId"  TEXT,
  "ipAddress"   INET,
  "userAgent"   TEXT,
  "traceId"     TEXT,                 -- request correlation id
  severity      TEXT NOT NULL DEFAULT 'info'
                  CHECK (severity IN ('info', 'warn', 'error', 'critical')),
  metadata      JSONB NOT NULL DEFAULT '{}',
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_campaign_isolation"
  ON audit_logs
  FOR SELECT
  USING (
    "campaignId" IS NULL OR
    "campaignId" IN (
      SELECT "campaignId" FROM users WHERE id = auth.uid()
    )
  );

-- Inserts only via service role (audit integrity — clients never write)
CREATE POLICY "audit_logs_service_only_insert"
  ON audit_logs
  FOR INSERT
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_audit_logs_campaign_created ON audit_logs ("campaignId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs (severity, "createdAt" DESC) WHERE severity IN ('warn', 'error', 'critical');
CREATE INDEX IF NOT EXISTS idx_audit_logs_trace ON audit_logs ("traceId");

-- Webhook delivery tracking
CREATE TABLE IF NOT EXISTS webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL,      -- 'meta', 'tiktok', etc
  "eventType"    TEXT,
  "signatureValid" BOOLEAN NOT NULL,
  "campaignId"    UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  "payloadHash"  TEXT NOT NULL,      -- sha256 of body for idempotency
  "receivedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "processedAt"  TIMESTAMPTZ,
  error           TEXT
);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_events_campaign_isolation"
  ON webhook_events
  FOR SELECT
  USING (
    "campaignId" IS NULL OR
    "campaignId" IN (
      SELECT "campaignId" FROM users WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_webhook_events_source_received ON webhook_events (source, "receivedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_signature ON webhook_events ("signatureValid", "receivedAt" DESC) WHERE "signatureValid" = false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_events_payload ON webhook_events (source, "payloadHash");
