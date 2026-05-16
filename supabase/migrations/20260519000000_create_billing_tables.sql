-- Phase 8: Billing — plans, subscriptions, usage records

-- Plans catalogue (seeded with Free / Pro / Enterprise)
CREATE TABLE IF NOT EXISTS plans (
  id              TEXT PRIMARY KEY,                -- 'free' | 'pro' | 'enterprise'
  name            TEXT NOT NULL,
  monthly_cents   INTEGER NOT NULL DEFAULT 0,      -- price in BRL cents
  features        TEXT[] NOT NULL DEFAULT '{}',    -- e.g. ['ai_agents', 'visits', 'crm']
  limits          JSONB NOT NULL DEFAULT '{}',     -- e.g. { contacts: 1000, ai_budget_cents: 5000, team_users: 5 }
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Subscriptions — one active subscription per campaign
CREATE TABLE IF NOT EXISTS subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  plan_id               TEXT NOT NULL REFERENCES plans(id),
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'paused')),
  features              TEXT[] NOT NULL DEFAULT '{}',   -- snapshot from plan at subscription time
  current_period_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  stripe_subscription_id  TEXT,
  stripe_customer_id    TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_campaign_isolation"
  ON subscriptions FOR SELECT
  USING (campaign_id IN (SELECT campaign_id FROM profiles WHERE id = auth.uid()));

-- Only one active subscription per campaign
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_active_campaign
  ON subscriptions (campaign_id)
  WHERE status IN ('active', 'trialing', 'past_due');

-- Usage records — one row per metered event (AI call, outbound message, etc)
CREATE TABLE IF NOT EXISTS usage_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  metric        TEXT NOT NULL CHECK (metric IN ('ai_call', 'message_outbound', 'simulation', 'embedding')),
  quantity      INTEGER NOT NULL DEFAULT 1,
  cost_cents    INTEGER NOT NULL DEFAULT 0,         -- accumulated cost in BRL cents
  metadata      JSONB NOT NULL DEFAULT '{}',         -- { model, provider, tokens_in, tokens_out, ... }
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_records_campaign_isolation"
  ON usage_records FOR SELECT
  USING (campaign_id IN (SELECT campaign_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_usage_records_campaign_metric
  ON usage_records (campaign_id, metric, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_records_campaign_recent
  ON usage_records (campaign_id, recorded_at DESC);

-- Seed default plans
INSERT INTO plans (id, name, monthly_cents, features, limits) VALUES
  (
    'free',
    'Gratuito',
    0,
    ARRAY['dashboard', 'crm', 'help'],
    '{"contacts": 100, "ai_budget_cents": 0, "team_users": 2, "messages_per_month": 0}'::jsonb
  ),
  (
    'pro',
    'Pro',
    29900,                                   -- R$ 299,00
    ARRAY['dashboard', 'crm', 'help', 'ai_agents', 'visits', 'engagement',
          'tools', 'resources', 'training', 'analytics', 'team', 'financial'],
    '{"contacts": 10000, "ai_budget_cents": 50000, "team_users": 25, "messages_per_month": 5000}'::jsonb
  ),
  (
    'enterprise',
    'Enterprise',
    99900,                                   -- R$ 999,00
    ARRAY['dashboard', 'crm', 'help', 'ai_agents', 'visits', 'engagement',
          'tools', 'resources', 'training', 'analytics', 'team', 'financial',
          'election_day', 'intelligence', 'scenarios'],
    '{"contacts": -1, "ai_budget_cents": -1, "team_users": -1, "messages_per_month": -1}'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  monthly_cents = EXCLUDED.monthly_cents,
  features = EXCLUDED.features,
  limits = EXCLUDED.limits;
