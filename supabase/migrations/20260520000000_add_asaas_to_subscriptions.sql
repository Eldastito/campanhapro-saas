-- Phase 8 follow-up: Asaas payment gateway columns

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS asaas_customer_id      TEXT,
  ADD COLUMN IF NOT EXISTS asaas_subscription_id  TEXT,
  ADD COLUMN IF NOT EXISTS payment_provider       TEXT NOT NULL DEFAULT 'stub'
    CHECK (payment_provider IN ('stub', 'asaas', 'stripe', 'pagarme'));

CREATE INDEX IF NOT EXISTS idx_subscriptions_asaas_sub
  ON subscriptions (asaas_subscription_id)
  WHERE asaas_subscription_id IS NOT NULL;

-- Payment events ledger — Asaas webhooks + manual payment records
CREATE TABLE IF NOT EXISTS payment_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  subscription_id     UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  provider            TEXT NOT NULL,
  provider_event_id   TEXT,                  -- unique id from provider for idempotency
  event_type          TEXT NOT NULL,         -- e.g. 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE'
  status              TEXT NOT NULL,         -- normalised: paid | pending | failed | refunded
  amount_cents        INTEGER,
  payment_method      TEXT,                  -- 'pix' | 'credit_card' | 'debit_card' | 'boleto'
  metadata            JSONB NOT NULL DEFAULT '{}',
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_events_campaign_isolation"
  ON payment_events FOR SELECT
  USING (
    campaign_id IS NULL OR
    campaign_id IN (SELECT campaign_id FROM users WHERE id = auth.uid())
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_events_provider_event
  ON payment_events (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_events_campaign_received
  ON payment_events (campaign_id, received_at DESC);
