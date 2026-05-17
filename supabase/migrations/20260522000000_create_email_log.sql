-- Phase 10: Transactional email log + delivery tracking

CREATE TABLE IF NOT EXISTS email_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"        UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  "recipientId"       UUID,                       -- references users(id) when applicable
  "recipientEmail"    TEXT NOT NULL,
  template            TEXT NOT NULL,              -- 'welcome', 'payment_confirmed', etc
  subject             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'delivered', 'bounced', 'failed', 'spam')),
  provider            TEXT NOT NULL,              -- 'resend' | 'stub' | 'ses' | ...
  "providerMessageId" TEXT,                       -- id returned by provider for delivery webhooks
  "idempotencyKey"    TEXT,
  error               TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}',
  "sentAt"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deliveredAt"       TIMESTAMPTZ
);

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_log_campaign_isolation"
  ON email_log FOR SELECT
  USING (
    "campaignId" IS NULL OR
    "campaignId" IN (SELECT "campaignId" FROM users WHERE id = auth.uid())
  );

-- Unique per (template, idempotencyKey) so the same logical email is never sent twice
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_log_idempotency
  ON email_log (template, "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_log_campaign_sent
  ON email_log ("campaignId", "sentAt" DESC);

CREATE INDEX IF NOT EXISTS idx_email_log_provider_msg
  ON email_log (provider, "providerMessageId")
  WHERE "providerMessageId" IS NOT NULL;
