-- Phase 5: Advanced scenarios — simulation_runs, political_graphs, dossiers

-- Monte Carlo simulation runs
CREATE TABLE IF NOT EXISTS simulation_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  iterations      INTEGER NOT NULL CHECK (iterations BETWEEN 100 AND 100000),
  candidates_input  JSONB NOT NULL DEFAULT '[]',
  results_summary   JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE simulation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "simulation_runs_campaign_isolation"
  ON simulation_runs
  USING (
    campaign_id IN (
      SELECT campaign_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_simulation_runs_campaign ON simulation_runs (campaign_id, created_at DESC);

-- Political relationship graphs
CREATE TABLE IF NOT EXISTS political_graphs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT 'Graph',
  nodes       JSONB NOT NULL DEFAULT '[]',
  edges       JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE political_graphs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "political_graphs_campaign_isolation"
  ON political_graphs
  USING (
    campaign_id IN (
      SELECT campaign_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_political_graphs_campaign ON political_graphs (campaign_id, created_at DESC);

-- Dossiers — always require human approval before use (PRD constraint)
CREATE TABLE IF NOT EXISTS dossiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  subject_name  TEXT NOT NULL,
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('candidate', 'opponent', 'ally')),
  status        TEXT NOT NULL DEFAULT 'pending_approval'
                  CHECK (status IN ('pending_approval', 'approved', 'rejected')),
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE dossiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dossiers_campaign_isolation"
  ON dossiers
  USING (
    campaign_id IN (
      SELECT campaign_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_dossiers_campaign ON dossiers (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dossiers_status ON dossiers (campaign_id, status);
