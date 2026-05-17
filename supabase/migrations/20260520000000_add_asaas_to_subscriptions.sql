-- Phase 8 follow-up: Asaas payment gateway columns

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS "asaasCustomerId"        TEXT,
  ADD COLUMN IF NOT EXISTS "asaasSubscriptionId"    TEXT,
  ADD COLUMN IF NOT EXISTS "paymentProvider"        TEXT NOT NULL DEFAULT 'stub'
    CHECK ("paymentProvider" IN ('stub', 'asaas', 'stripe', 'pagarme'));

CREATE INDEX IF NOT EXISTS idx_subscriptions_asaas_sub
  ON subscriptions ("asaasSubscriptionId")
  WHERE "asaasSubscriptionId" IS NOT NULL;

-- Payment events ledger — Asaas webhooks + manual payment records
CREATE TABLE IF NOT EXISTS payment_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"        UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  "subscriptionId"    UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  provider            TEXT NOT NULL,
  "providerEventId"   TEXT,                  -- unique id from provider for idempotency
  "eventType"         TEXT NOT NULL,         -- e.g. 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE'
  status              TEXT NOT NULL,         -- normalised: paid | pending | failed | refunded
  "amountCents"       INTEGER,
  "paymentMethod"     TEXT,                  -- 'pix' | 'credit_card' | 'debit_card' | 'boleto'
  metadata            JSONB NOT NULL DEFAULT '{}',
  "receivedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_events_campaign_isolation"
  ON payment_events FOR SELECT
  USING (
    "campaignId" IS NULL OR
    "campaignId" IN (SELECT "campaignId" FROM users WHERE id = auth.uid())
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_events_provider_event
  ON payment_events (provider, "providerEventId")
  WHERE "providerEventId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_events_campaign_received
  ON payment_events ("campaignId", "receivedAt" DESC);
