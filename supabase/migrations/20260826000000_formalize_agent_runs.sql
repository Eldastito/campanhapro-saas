-- Formaliza a tabela `agent_runs`, que era criada manualmente em produção.
-- Já descoberta no F0 audit (docs/social/SOCIAL-AS-IS.md §6, B2). Toda a
-- pipeline de IA (aiCallAgent.ts, managerAgent.ts, supremeAdmin, RAG) grava
-- aqui — a ausência de migration bloqueava reprovisionar staging/dev.
--
-- Convenção de naming: camelCase quoted. O CLAUDE.md avisa "usa snake_case
-- em prod", mas ~15 call sites no repo (aiCallAgent.ts:227,486,515,558,662;
-- supremeAdminRouter.ts:402; ragRouter.ts:275,376; server.ts:1161)
-- consultam TODOS em camelCase (`"campaignId"`, `"agentId"`, `"costCentsUsd"`,
-- `"createdAt"`, `"tokensIn"`, `"tokensOut"`, `"latencyMs"`). Código é a
-- fonte de verdade — se prod estiver em snake_case, essas queries falham
-- silenciosamente hoje, o que é um bug distinto (fora do escopo deste PR).
--
-- CREATE TABLE IF NOT EXISTS: idempotente. Se prod já tem esta tabela, o
-- CREATE é no-op e as políticas abaixo apenas somam (ADD POLICY IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" TEXT NOT NULL,
  "userId" UUID NULL,
  "managerRunId" UUID NULL,
  "agentId" TEXT NOT NULL,
  provider TEXT NOT NULL,              -- 'openai' | 'anthropic' | 'gemini' | 'none'
  model TEXT NOT NULL,
  action TEXT NOT NULL,                -- 'chat' | 'plan_blocked' | 'budget_blocked'
  "promptExcerpt" TEXT NULL,           -- 500 chars max no código
  "responseExcerpt" TEXT NULL,         -- 500 chars max no código
  "tokensIn" INTEGER NOT NULL DEFAULT 0,
  "tokensOut" INTEGER NOT NULL DEFAULT 0,
  "costCentsUsd" NUMERIC NOT NULL DEFAULT 0,
  "latencyMs" INTEGER NULL,
  status TEXT NOT NULL,                -- 'ok' | 'timeout' | 'error' | 'plan_blocked' | 'budget_exceeded'
  error TEXT NULL,
  metadata JSONB NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_runs_campaign_created_idx
  ON agent_runs ("campaignId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS agent_runs_manager_run_idx
  ON agent_runs ("managerRunId")
  WHERE "managerRunId" IS NOT NULL;

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;

-- Leitura via helpers padrão do projeto (get_user_campaign_id_text +
-- is_supreme_admin). Escrita só service_role (aiCallAgent usa admin client).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'agent_runs_read_own' AND tablename = 'agent_runs') THEN
    CREATE POLICY agent_runs_read_own ON agent_runs
      FOR SELECT
      USING ("campaignId" = get_user_campaign_id_text() OR is_supreme_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'agent_runs_service_all' AND tablename = 'agent_runs') THEN
    CREATE POLICY agent_runs_service_all ON agent_runs
      FOR ALL
      TO service_role
      USING (TRUE)
      WITH CHECK (TRUE);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
