-- Phase 6: Audit logs for LGPD/TSE compliance + observability

CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  actor_id      UUID,                 -- nullable: webhooks/system actors
  actor_type    TEXT NOT NULL DEFAULT 'user'
                  CHECK (actor_type IN ('user', 'system', 'webhook', 'agent')),
  action        TEXT NOT NULL,        -- e.g. 'dossier.approve', 'message.send', 'consent.grant'
  resource_type TEXT,                 -- e.g. 'dossier', 'message', 'task'
  resource_id   TEXT,
  ip_address    INET,
  user_agent    TEXT,
  trace_id      TEXT,                 -- request correlation id
  severity      TEXT NOT NULL DEFAULT 'info'
                  CHECK (severity IN ('info', 'warn', 'error', 'critical')),
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_campaign_isolation"
  ON audit_logs
  FOR SELECT
  USING (
    campaign_id IS NULL OR
    campaign_id IN (
      SELECT campaign_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Inserts only via service role (audit integrity — clients never write)
CREATE POLICY "audit_logs_service_only_insert"
  ON audit_logs
  FOR INSERT
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_audit_logs_campaign_created ON audit_logs (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs (severity, created_at DESC) WHERE severity IN ('warn', 'error', 'critical');
CREATE INDEX IF NOT EXISTS idx_audit_logs_trace ON audit_logs (trace_id);

-- Webhook delivery tracking
CREATE TABLE IF NOT EXISTS webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL,      -- 'meta', 'tiktok', etc
  event_type      TEXT,
  signature_valid BOOLEAN NOT NULL,
  campaign_id     UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  payload_hash    TEXT NOT NULL,      -- sha256 of body for idempotency
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ,
  error           TEXT
);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_events_campaign_isolation"
  ON webhook_events
  FOR SELECT
  USING (
    campaign_id IS NULL OR
    campaign_id IN (
      SELECT campaign_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_webhook_events_source_received ON webhook_events (source, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_signature ON webhook_events (signature_valid, received_at DESC) WHERE signature_valid = false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_events_payload ON webhook_events (source, payload_hash);
