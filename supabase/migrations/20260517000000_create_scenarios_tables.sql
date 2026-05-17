-- Phase 5: Advanced scenarios — simulation_runs, political_graphs, dossiers

-- Monte Carlo simulation runs
CREATE TABLE IF NOT EXISTS simulation_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"    UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  iterations      INTEGER NOT NULL CHECK (iterations BETWEEN 100 AND 100000),
  "candidatesInput"  JSONB NOT NULL DEFAULT '[]',
  "resultsSummary"  JSONB NOT NULL DEFAULT '[]',
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE simulation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "simulation_runs_campaign_isolation"
  ON simulation_runs
  USING (
    "campaignId" IN (
      SELECT "campaignId" FROM users WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_simulation_runs_campaign ON simulation_runs ("campaignId", "createdAt" DESC);

-- Political relationship graphs
CREATE TABLE IF NOT EXISTS political_graphs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT 'Graph',
  nodes       JSONB NOT NULL DEFAULT '[]',
  edges       JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE political_graphs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "political_graphs_campaign_isolation"
  ON political_graphs
  USING (
    "campaignId" IN (
      SELECT "campaignId" FROM users WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_political_graphs_campaign ON political_graphs ("campaignId", "createdAt" DESC);

-- Dossiers — always require human approval before use (PRD constraint)
CREATE TABLE IF NOT EXISTS dossiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  "subjectName" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL CHECK ("subjectType" IN ('candidate', 'opponent', 'ally')),
  status        TEXT NOT NULL DEFAULT 'pending_approval'
                  CHECK (status IN ('pending_approval', 'approved', 'rejected')),
  content       TEXT NOT NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE dossiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dossiers_campaign_isolation"
  ON dossiers
  USING (
    "campaignId" IN (
      SELECT "campaignId" FROM users WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_dossiers_campaign ON dossiers ("campaignId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_dossiers_status ON dossiers ("campaignId", status);
