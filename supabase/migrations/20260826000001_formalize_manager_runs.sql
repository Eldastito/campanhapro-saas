-- Formaliza `manager_runs` — orquestrador de agentes (`src/lib/managerAgent.ts`).
-- Cada execução do Manager cria uma row aqui; cada sub-chamada de agente
-- referencia via `agent_runs."managerRunId"` (formalizada em 20260826000000).
--
-- Descoberta no F0 audit. Sem migration versionada, apesar de o código
-- inserir (`managerAgent.ts:242`), atualizar (`:380`) e o socialRouter
-- ler (`socialRouter.ts:298`). Idempotente via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS manager_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" TEXT NOT NULL,
  "userId" UUID NULL,
  intent TEXT NOT NULL,
  plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NULL,                        -- e.g. 'social:x' — usado pelo /api/v1/social/history
  "finalSummary" TEXT NULL,
  "totalCostCentsUsd" NUMERIC NOT NULL DEFAULT 0,
  "totalTokensIn" INTEGER NOT NULL DEFAULT 0,
  "totalTokensOut" INTEGER NOT NULL DEFAULT 0,
  iterations INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'done' | 'max_iter' | 'error' | 'budget_exceeded'
  error TEXT NULL,
  "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "finishedAt" TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS manager_runs_campaign_started_idx
  ON manager_runs ("campaignId", "startedAt" DESC);

CREATE INDEX IF NOT EXISTS manager_runs_source_idx
  ON manager_runs ("campaignId", source)
  WHERE source IS NOT NULL;

ALTER TABLE manager_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'manager_runs_read_own' AND tablename = 'manager_runs') THEN
    CREATE POLICY manager_runs_read_own ON manager_runs
      FOR SELECT
      USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'manager_runs_service_all' AND tablename = 'manager_runs') THEN
    CREATE POLICY manager_runs_service_all ON manager_runs
      FOR ALL
      TO service_role
      USING (TRUE)
      WITH CHECK (TRUE);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
