-- Phase Paperclip Core: budget allocations managed by CEO agent
-- The CEO agent proposes allocations; humans approve (security: no autonomous spending)

CREATE TABLE IF NOT EXISTS budget_allocations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"        text        NOT NULL,
  bucket              text        NOT NULL
                      CHECK (bucket IN ('recursos','financeiro','material','pessoal','redes_sociais','outros','reserva')),
  "allocatedCents"    bigint      NOT NULL DEFAULT 0,
  period              text        NOT NULL DEFAULT 'campaign'
                      CHECK (period IN ('campaign','month','week')),
  "periodStart"       date,
  "periodEnd"         date,
  rationale           text,
  status              text        NOT NULL DEFAULT 'proposed'
                      CHECK (status IN ('proposed','approved','active','rejected','superseded')),
  "createdByAgentId"  text,
  "approvedByUserId"  text,
  "approvedAt"        timestamptz,
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_alloc_campaign_status
  ON budget_allocations ("campaignId", status);
CREATE INDEX IF NOT EXISTS idx_budget_alloc_bucket
  ON budget_allocations ("campaignId", bucket, status);

ALTER TABLE budget_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Campaign members read own budget allocations"
  ON budget_allocations FOR SELECT
  USING ("campaignId" IN (SELECT "campaignId"::text FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role bypass budget allocations"
  ON budget_allocations FOR ALL
  USING (auth.role() = 'service_role');

-- Optional per-goal budget cap
ALTER TABLE campaign_goals
  ADD COLUMN IF NOT EXISTS "budgetCents" bigint;
