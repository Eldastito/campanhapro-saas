-- Phase 9: Fix RLS policies that referenced wrong `profiles` table.
-- The schema actually uses `users` (from CampanhaPro original code). Phase 5
-- migration shipped policies pointing to a non-existent `profiles` table,
-- which caused every Phase 5 endpoint to silently 0-row when RLS evaluated.
-- This migration drops + recreates the broken policies pointing at `users`.

-- Phase 5 — scenarios tables
DROP POLICY IF EXISTS "simulation_runs_campaign_isolation" ON simulation_runs;
CREATE POLICY "simulation_runs_campaign_isolation"
  ON simulation_runs
  USING (campaign_id IN (SELECT campaign_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "political_graphs_campaign_isolation" ON political_graphs;
CREATE POLICY "political_graphs_campaign_isolation"
  ON political_graphs
  USING (campaign_id IN (SELECT campaign_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "dossiers_campaign_isolation" ON dossiers;
CREATE POLICY "dossiers_campaign_isolation"
  ON dossiers
  USING (campaign_id IN (SELECT campaign_id FROM users WHERE id = auth.uid()));
