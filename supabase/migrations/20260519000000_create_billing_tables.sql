-- Phase 8: Billing — plans, subscriptions, usage records

-- Plans catalogue (seeded with Gratuito / Essencial / Estratégico / Total).
-- ATENÇÃO: os preços REAIS são 10/15/20 mil reais. A versão original deste seed
-- saiu como pro=R$299 / enterprise=R$999 e foi corrigida no banco depois. O seed
-- aqui ficou divergente até o usuário pedir "sumir com esses preços" — a partir
-- daqui, esta migration é a fonte canônica e bate com o banco vivo.
CREATE TABLE IF NOT EXISTS plans (
  id              TEXT PRIMARY KEY,                -- 'free' | 'essencial' | 'pro' | 'enterprise'
  name            TEXT NOT NULL,
  "monthlyCents"  INTEGER NOT NULL DEFAULT 0,      -- price in BRL cents
  features        TEXT[] NOT NULL DEFAULT '{}',    -- e.g. ['ai_agents', 'visits', 'crm']
  limits          JSONB NOT NULL DEFAULT '{}',     -- e.g. { contacts: 1000, ai_budget_cents: 5000, team_users: 5 }
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Subscriptions — one active subscription per campaign
CREATE TABLE IF NOT EXISTS subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"            UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  "planId"                TEXT NOT NULL REFERENCES plans(id),
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'paused')),
  features                TEXT[] NOT NULL DEFAULT '{}',   -- snapshot from plan at subscription time
  "currentPeriodStart"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "currentPeriodEnd"      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  "stripeSubscriptionId"  TEXT,
  "stripeCustomerId"      TEXT,
  metadata                JSONB NOT NULL DEFAULT '{}',
  "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_campaign_isolation"
  ON subscriptions FOR SELECT
  USING ("campaignId" IN (SELECT "campaignId" FROM users WHERE id = auth.uid()));

-- Only one active subscription per campaign
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_active_campaign
  ON subscriptions ("campaignId")
  WHERE status IN ('active', 'trialing', 'past_due');

-- Usage records — one row per metered event (AI call, outbound message, etc)
CREATE TABLE IF NOT EXISTS usage_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  metric        TEXT NOT NULL CHECK (metric IN ('ai_call', 'message_outbound', 'simulation', 'embedding')),
  quantity      INTEGER NOT NULL DEFAULT 1,
  "costCents"   INTEGER NOT NULL DEFAULT 0,         -- accumulated cost in BRL cents
  metadata      JSONB NOT NULL DEFAULT '{}',         -- { model, provider, tokens_in, tokens_out, ... }
  "recordedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_records_campaign_isolation"
  ON usage_records FOR SELECT
  USING ("campaignId" IN (SELECT "campaignId" FROM users WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_usage_records_campaign_metric
  ON usage_records ("campaignId", metric, "recordedAt" DESC);

CREATE INDEX IF NOT EXISTS idx_usage_records_campaign_recent
  ON usage_records ("campaignId", "recordedAt" DESC);

-- Seed default plans (alinhado com o estado canônico do superadmin).
INSERT INTO plans (id, name, "monthlyCents", features, limits) VALUES
  (
    'free',
    'Gratuito',
    0,
    ARRAY['dashboard', 'crm', 'help', 'visits', 'team', 'engagement', 'forms', 'resources'],
    '{"ai_calls": 0, "contacts": -1, "team_users": -1, "ai_budget_cents": 0, "blasts_per_month": 0}'::jsonb
  ),
  (
    'essencial',
    'Essencial',
    1000000,                                 -- R$ 10.000,00
    ARRAY['dashboard', 'crm', 'help', 'visits', 'team', 'engagement', 'resources',
          'goals', 'routines', 'ai_agents', 'forms', 'whatsapp_omnichannel'],
    '{"ai_calls": 100, "contacts": -1, "team_users": -1, "ai_budget_cents": 10000, "blasts_per_month": 1000}'::jsonb
  ),
  (
    'pro',
    'Estratégico',
    1500000,                                 -- R$ 15.000,00
    ARRAY['dashboard', 'crm', 'help', 'visits', 'team', 'engagement', 'resources',
          'goals', 'routines', 'ai_agents', 'forms', 'analytics', 'financial',
          'content_studio', 'rag', 'meetings', 'tools', 'training',
          'whatsapp_omnichannel', 'call_center'],
    '{"ai_calls": 100, "contacts": -1, "team_users": -1, "ai_budget_cents": 50000, "blasts_per_month": 10000}'::jsonb
  ),
  (
    'enterprise',
    'Total',
    2000000,                                 -- R$ 20.000,00
    ARRAY['dashboard', 'crm', 'help', 'visits', 'team', 'engagement', 'resources',
          'goals', 'routines', 'ai_agents', 'forms', 'analytics', 'financial',
          'content_studio', 'rag', 'meetings', 'tools', 'training',
          'whatsapp_omnichannel', 'election_day', 'intelligence', 'scenarios',
          'budget_ceo', 'paperclip', 'compliance', 'call_center'],
    '{"ai_calls": -1, "contacts": -1, "team_users": -1, "ai_budget_cents": -1, "blasts_per_month": -1}'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  "monthlyCents" = EXCLUDED."monthlyCents",
  features = EXCLUDED.features,
  limits = EXCLUDED.limits;
