-- Phase 4: Paperclip-backed agent task queue with approval gate

CREATE TABLE IF NOT EXISTS agent_tasks (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"        text        NOT NULL,
  type                text        NOT NULL,
  payload             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "requiresApproval"  boolean     NOT NULL DEFAULT false,
  status              text        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','awaiting_approval','approved','running','completed','failed','rejected')),
  "providerTaskId"    text,
  result              text,
  "costCents"         integer,
  attempts            integer     NOT NULL DEFAULT 0,
  "errorMessage"      text,
  "approvedByUserId"  uuid,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_campaign_status
  ON agent_tasks ("campaignId", status, "createdAt" DESC);

ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Campaign members read own tasks"
  ON agent_tasks FOR SELECT
  USING ("campaignId" IN (SELECT "campaignId"::text FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role bypass agent_tasks"
  ON agent_tasks FOR ALL
  USING (auth.role() = 'service_role');
