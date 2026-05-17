-- Phase Paperclip Core: expand agent_tasks with full Paperclip lifecycle fields

ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS title           text,
  ADD COLUMN IF NOT EXISTS "goalId"        uuid REFERENCES campaign_goals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "projectId"     uuid REFERENCES campaign_projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "parentTaskId"  uuid REFERENCES agent_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority        text NOT NULL DEFAULT 'medium'
                                           CHECK (priority IN ('critical','high','medium','low')),
  ADD COLUMN IF NOT EXISTS "assigneeAgentId" text,
  ADD COLUMN IF NOT EXISTS "monitorNextCheckAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "completedAt"   timestamptz;

CREATE INDEX IF NOT EXISTS idx_agent_tasks_goal
  ON agent_tasks ("goalId");
CREATE INDEX IF NOT EXISTS idx_agent_tasks_project
  ON agent_tasks ("projectId");
CREATE INDEX IF NOT EXISTS idx_agent_tasks_parent
  ON agent_tasks ("parentTaskId");
CREATE INDEX IF NOT EXISTS idx_agent_tasks_monitor
  ON agent_tasks ("monitorNextCheckAt")
  WHERE "monitorNextCheckAt" IS NOT NULL;
