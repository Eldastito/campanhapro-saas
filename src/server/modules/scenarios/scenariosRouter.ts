import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runMonteCarlo, CandidateInput } from './monteCarloService';

export function createScenariosRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // POST /api/v1/scenarios/simulate
  // Body: { candidates: CandidateInput[], iterations?: number }
  // Returns: SimulationResult + persisted run id
  router.post('/simulate', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { candidates, iterations = 10_000 } = req.body as {
      candidates: CandidateInput[];
      iterations?: number;
    };

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'candidates array required' });
    }

    // Validate inputs
    for (const c of candidates) {
      if (!c.id || !c.name) return res.status(400).json({ error: 'Each candidate needs id and name' });
      if (typeof c.baseShare !== 'number' || c.baseShare < 0 || c.baseShare > 1) {
        return res.status(400).json({ error: `Invalid baseShare for ${c.id}` });
      }
      if (typeof c.margin !== 'number' || c.margin < 0 || c.margin > 0.5) {
        return res.status(400).json({ error: `Invalid margin for ${c.id}` });
      }
    }

    let result;
    try {
      result = runMonteCarlo(candidates, iterations);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }

    // Persist run summary (without massive samples array)
    const { data: run, error } = await supabase
      .from('simulation_runs')
      .insert({
        campaign_id: campaignId,
        iterations: result.iterations,
        candidates_input: candidates,
        results_summary: result.candidates,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[scenarios] persist error', error.message);
    }

    return res.json({ runId: run?.id ?? null, ...result });
  });

  // GET /api/v1/scenarios/simulate — list past runs
  router.get('/simulate', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('simulation_runs')
      .select('id, iterations, candidates_input, results_summary, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ runs: data ?? [] });
  });

  // POST /api/v1/scenarios/graphs — upsert political relationship graph
  router.post('/graphs', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { nodes, edges, label } = req.body as {
      nodes: Array<{ id: string; label: string; type: string; weight?: number }>;
      edges: Array<{ source: string; target: string; type: string; weight?: number }>;
      label?: string;
    };

    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return res.status(400).json({ error: 'nodes and edges arrays required' });
    }

    const { data, error } = await supabase
      .from('political_graphs')
      .insert({ campaign_id: campaignId, label: label ?? 'Graph', nodes, edges })
      .select('id')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ graphId: data?.id });
  });

  // GET /api/v1/scenarios/graphs
  router.get('/graphs', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('political_graphs')
      .select('id, label, nodes, edges, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ graphs: data ?? [] });
  });

  // POST /api/v1/scenarios/dossiers — create dossier (requires human approval before use)
  router.post('/dossiers', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { subjectName, subjectType, content } = req.body as {
      subjectName: string;
      subjectType: 'candidate' | 'opponent' | 'ally';
      content: string;
    };

    if (!subjectName || !subjectType || !content) {
      return res.status(400).json({ error: 'subjectName, subjectType, content required' });
    }
    if (!['candidate', 'opponent', 'ally'].includes(subjectType)) {
      return res.status(400).json({ error: 'Invalid subjectType' });
    }

    // Dossiers always start as pending_approval — human must review before use
    const { data, error } = await supabase
      .from('dossiers')
      .insert({
        campaign_id: campaignId,
        subject_name: subjectName,
        subject_type: subjectType,
        content,
        status: 'pending_approval',
      })
      .select('id')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ dossierId: data?.id, status: 'pending_approval' });
  });

  // GET /api/v1/scenarios/dossiers
  router.get('/dossiers', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('dossiers')
      .select('id, subject_name, subject_type, status, content, created_at, updated_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ dossiers: data ?? [] });
  });

  // POST /api/v1/scenarios/dossiers/:id/approve
  router.post('/dossiers/:id/approve', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { error } = await supabase
      .from('dossiers')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('campaign_id', campaignId)
      .eq('status', 'pending_approval');

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ status: 'approved' });
  });

  // POST /api/v1/scenarios/dossiers/:id/reject
  router.post('/dossiers/:id/reject', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { error } = await supabase
      .from('dossiers')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('campaign_id', campaignId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ status: 'rejected' });
  });

  return router;
}
