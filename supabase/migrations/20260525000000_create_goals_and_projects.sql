-- Phase Paperclip Core: campaign_goals + campaign_projects
-- Based on Paperclip's goals/issues model adapted for CampanhaPro

CREATE TABLE IF NOT EXISTS campaign_goals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"    text        NOT NULL,
  "parentId"      uuid        REFERENCES campaign_goals(id) ON DELETE SET NULL,
  title           text        NOT NULL,
  description     text,
  level           text        NOT NULL DEFAULT 'task'
                  CHECK (level IN ('strategic','tactical','operational','task')),
  status          text        NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned','active','on_hold','completed','cancelled')),
  priority        text        NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('critical','high','medium','low')),
  "ownerAgentId"  text,
  "startDate"     date,
  "dueDate"       date,
  "completedAt"   timestamptz,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_campaign_status
  ON campaign_goals ("campaignId", status, level);
CREATE INDEX IF NOT EXISTS idx_goals_parent
  ON campaign_goals ("parentId");

ALTER TABLE campaign_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Campaign members read own goals"
  ON campaign_goals FOR SELECT
  USING ("campaignId" IN (SELECT "campaignId"::text FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role bypass goals"
  ON campaign_goals FOR ALL
  USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS campaign_projects (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"    text        NOT NULL,
  "goalId"        uuid        REFERENCES campaign_goals(id) ON DELETE SET NULL,
  title           text        NOT NULL,
  description     text,
  status          text        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','paused','completed','archived')),
  priority        text        NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('critical','high','medium','low')),
  "ownerAgentId"  text,
  "startDate"     date,
  "endDate"       date,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_campaign_status
  ON campaign_projects ("campaignId", status);
CREATE INDEX IF NOT EXISTS idx_projects_goal
  ON campaign_projects ("goalId");

ALTER TABLE campaign_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Campaign members read own projects"
  ON campaign_projects FOR SELECT
  USING ("campaignId" IN (SELECT "campaignId"::text FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role bypass projects"
  ON campaign_projects FOR ALL
  USING (auth.role() = 'service_role');
