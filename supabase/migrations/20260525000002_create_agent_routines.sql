-- Phase Paperclip Core: agent_routines + routine_triggers + routine_runs

CREATE TABLE IF NOT EXISTS agent_routines (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"        text        NOT NULL,
  "goalId"            uuid        REFERENCES campaign_goals(id) ON DELETE SET NULL,
  "projectId"         uuid        REFERENCES campaign_projects(id) ON DELETE SET NULL,
  title               text        NOT NULL,
  description         text,
  "assigneeAgentId"   text,
  status              text        NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','paused','archived')),
  "concurrencyPolicy" text        NOT NULL DEFAULT 'coalesce_if_active'
                      CHECK ("concurrencyPolicy" IN ('allow_parallel','coalesce_if_active','skip_if_active')),
  "catchUpPolicy"     text        NOT NULL DEFAULT 'skip_missed'
                      CHECK ("catchUpPolicy" IN ('skip_missed','run_once','run_all')),
  variables           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "lastTriggeredAt"   timestamptz,
  "lastEnqueuedAt"    timestamptz,
  "createdByUserId"   text,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routines_campaign_status
  ON agent_routines ("campaignId", status);

ALTER TABLE agent_routines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Campaign members read own routines"
  ON agent_routines FOR SELECT
  USING ("campaignId" IN (SELECT "campaignId"::text FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role bypass routines"
  ON agent_routines FOR ALL
  USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS routine_triggers (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"      text        NOT NULL,
  "routineId"       uuid        NOT NULL REFERENCES agent_routines(id) ON DELETE CASCADE,
  kind              text        NOT NULL CHECK (kind IN ('cron','webhook','manual')),
  label             text,
  enabled           boolean     NOT NULL DEFAULT true,
  "cronExpression"  text,
  timezone          text        NOT NULL DEFAULT 'America/Sao_Paulo',
  "nextRunAt"       timestamptz,
  "lastFiredAt"     timestamptz,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routine_triggers_routine
  ON routine_triggers ("routineId");
CREATE INDEX IF NOT EXISTS idx_routine_triggers_next_run
  ON routine_triggers ("nextRunAt")
  WHERE enabled = true;

ALTER TABLE routine_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Campaign members read routine triggers"
  ON routine_triggers FOR SELECT
  USING ("campaignId" IN (SELECT "campaignId"::text FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role bypass routine_triggers"
  ON routine_triggers FOR ALL
  USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS routine_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"    text        NOT NULL,
  "routineId"     uuid        NOT NULL REFERENCES agent_routines(id) ON DELETE CASCADE,
  "triggerId"     uuid        REFERENCES routine_triggers(id) ON DELETE SET NULL,
  source          text        NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('cron','webhook','manual','api')),
  status          text        NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received','running','completed','failed','skipped')),
  "linkedTaskId"  uuid        REFERENCES agent_tasks(id) ON DELETE SET NULL,
  "failureReason" text,
  "triggeredAt"   timestamptz NOT NULL DEFAULT now(),
  "completedAt"   timestamptz,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routine_runs_campaign_routine
  ON routine_runs ("campaignId", "routineId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_routine_runs_status
  ON routine_runs (status, "createdAt" DESC);

ALTER TABLE routine_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Campaign members read routine runs"
  ON routine_runs FOR SELECT
  USING ("campaignId" IN (SELECT "campaignId"::text FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role bypass routine_runs"
  ON routine_runs FOR ALL
  USING (auth.role() = 'service_role');
