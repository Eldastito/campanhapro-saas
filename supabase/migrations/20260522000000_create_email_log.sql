-- Phase 10: Transactional email log + delivery tracking

CREATE TABLE IF NOT EXISTS email_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  recipient_id    UUID,                       -- references users(id) when applicable
  recipient_email TEXT NOT NULL,
  template        TEXT NOT NULL,              -- 'welcome', 'payment_confirmed', etc
  subject         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'delivered', 'bounced', 'failed', 'spam')),
  provider        TEXT NOT NULL,              -- 'resend' | 'stub' | 'ses' | ...
  provider_message_id TEXT,                   -- id returned by provider for delivery webhooks
  /** Idempotency key — caller provides a stable hash so retries don't double-send. */
  idempotency_key TEXT,
  error           TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ
);

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_log_campaign_isolation"
  ON email_log FOR SELECT
  USING (
    campaign_id IS NULL OR
    campaign_id IN (SELECT campaign_id FROM users WHERE id = auth.uid())
  );

-- Unique per (template, idempotency_key) so the same logical email is never sent twice
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_log_idempotency
  ON email_log (template, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_log_campaign_sent
  ON email_log (campaign_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_log_provider_msg
  ON email_log (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
