import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runMonteCarlo, CandidateInput } from './monteCarloService';
import { audit, actorFromRequest } from '../observability/auditLogger';

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
        campaignId: campaignId,
        iterations: result.iterations,
        candidatesInput: candidates,
        resultsSummary: result.candidates,
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
      .select('id, iterations, "candidatesInput", "resultsSummary", "createdAt"')
      .eq('campaignId', campaignId)
      .order('createdAt', { ascending: false })
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
      .insert({ campaignId: campaignId, label: label ?? 'Graph', nodes, edges })
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
      .select('id, label, nodes, edges, "createdAt"')
      .eq('campaignId', campaignId)
      .order('createdAt', { ascending: false })
      .limit(10);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ graphs: data ?? [] });
  });

  // GET /api/v1/scenarios/graph-seed — monta um grafo inicial a partir de DADOS
  // REAIS da campanha (candidato, adversários, lideranças e grupos de eleitores
  // por bairro), já com uma "opinião" inicial pra simulação de debate. Tudo
  // best-effort: se uma fonte falhar, ela é só pulada (não derruba o seed).
  router.get('/graph-seed', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const nodes: any[] = [];
    const edges: any[] = [];
    const CAND = 'cand';

    // Candidato (âncora positiva).
    try {
      const { data: camp } = await supabase
        .from('campaigns').select('"candidateName", party').eq('id', campaignId).maybeSingle();
      nodes.push({
        id: CAND, label: (camp as any)?.candidateName || 'Candidato',
        type: 'candidate', opinion: 1, stubborn: true,
      });
    } catch { nodes.push({ id: CAND, label: 'Candidato', type: 'candidate', opinion: 1, stubborn: true }); }

    // Adversários (âncoras negativas) — vindos da Inteligência/Concorrência.
    try {
      const { data: opps } = await supabase
        .from('competitor_intel').select('id, name, cargo').eq('campaignId', campaignId).limit(5);
      (opps ?? []).forEach((o: any, i: number) => {
        const id = `opp${i}`;
        nodes.push({ id, label: o.name || 'Adversário', type: 'opponent', opinion: -1, stubborn: true });
        edges.push({ source: id, target: CAND, type: 'opposition' });
      });
    } catch { /* skip */ }

    // Lideranças (aliados que puxam pro apoio).
    try {
      const { data: team } = await supabase
        .from('team_members').select('id, name, role').eq('campaignId', campaignId).limit(8);
      (team ?? []).forEach((t: any, i: number) => {
        const id = `ld${i}`;
        nodes.push({ id, label: t.name || t.role || 'Liderança', type: 'leader', opinion: 0.6 });
        edges.push({ source: id, target: CAND, type: 'support' });
      });
    } catch { /* skip */ }

    // Grupos de eleitores: agrega contatos por bairro (top 5) e estima a opinião
    // pela média do supportScore (0–100 → -1..+1). Sem score → neutro.
    try {
      const { data: contacts } = await supabase
        .from('contacts').select('neighborhood, "supportScore"').eq('campaignId', campaignId).limit(3000);
      const agg = new Map<string, { count: number; sum: number; n: number }>();
      (contacts ?? []).forEach((c: any) => {
        const bairro = (c.neighborhood || '').trim();
        if (!bairro) return;
        const cur = agg.get(bairro) ?? { count: 0, sum: 0, n: 0 };
        cur.count++;
        if (typeof c.supportScore === 'number') { cur.sum += c.supportScore; cur.n++; }
        agg.set(bairro, cur);
      });
      const top = [...agg.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
      top.forEach(([bairro, v], i) => {
        const opinion = v.n > 0 ? Math.max(-1, Math.min(1, (v.sum / v.n) / 50 - 1)) : 0;
        const id = `vg${i}`;
        nodes.push({ id, label: bairro, type: 'voter_group', opinion, weight: v.count });
        edges.push({
          source: id, target: CAND,
          type: opinion > 0.15 ? 'support' : opinion < -0.15 ? 'opposition' : 'undecided',
        });
      });
    } catch { /* skip */ }

    return res.json({ nodes, edges });
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
        campaignId: campaignId,
        subjectName: subjectName,
        subjectType: subjectType,
        content,
        status: 'pending_approval',
      })
      .select('id')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ dossierId: data?.id, status: 'pending_approval' });
  });

  // GET /api/v1/scenarios/dossiers — UNION dossiês manuais (com aprovação humana)
  // + dossiês de IA já gerados pelo Concorrência (intelRouter, tabela competitor_intel).
  // Antes os usuários geravam dossiê rico em Concorrência e abriam Cenários→Dossiês
  // vazio. Agora a tela mostra TUDO num lugar só — fonte canônica única.
  router.get('/dossiers', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    // 1) Dossiês manuais (fluxo de aprovação humana)
    const { data: manual, error: e1 } = await supabase
      .from('dossiers')
      .select('id, "subjectName", "subjectType", status, content, "createdAt", "updatedAt"')
      .eq('campaignId', campaignId)
      .order('createdAt', { ascending: false });
    if (e1) return res.status(500).json({ error: e1.message });

    // 2) Dossiês de IA do Concorrência (já têm source-grounding obrigatório, #60).
    //    Mapeia pro shape de Dossier: subjectType='opponent', status='approved' (a IA já valida).
    const { data: ai, error: e2 } = await supabase
      .from('competitor_intel')
      .select('id, name, cargo, cidade, uf, dossier, narrative, "createdAt"')
      .eq('campaignId', campaignId)
      .order('createdAt', { ascending: false });
    if (e2) return res.status(500).json({ error: e2.message });

    const aiMapped = (ai ?? []).map((row: any) => ({
      id: row.id,
      subjectName: row.name,
      subjectType: 'opponent' as const,
      status: 'approved' as const,
      content: row.narrative || (row.dossier ? JSON.stringify(row.dossier, null, 2) : ''),
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
      source: 'ai' as const,
      metadata: { cargo: row.cargo, cidade: row.cidade, uf: row.uf },
    }));
    const manualMarked = (manual ?? []).map((d: any) => ({ ...d, source: 'manual' as const }));

    const combined = [...aiMapped, ...manualMarked]
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return res.json({ dossiers: combined });
  });

  // POST /api/v1/scenarios/dossiers/:id/approve
  router.post('/dossiers/:id/approve', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { error } = await supabase
      .from('dossiers')
      .update({ status: 'approved', updatedAt: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('campaignId', campaignId)
      .eq('status', 'pending_approval');

    if (error) return res.status(500).json({ error: error.message });

    await audit(supabase, {
      ...actorFromRequest(req),
      action: 'dossier.approve',
      resourceType: 'dossier',
      resourceId: req.params.id,
      severity: 'warn',
    });
    return res.json({ status: 'approved' });
  });

  // POST /api/v1/scenarios/dossiers/:id/reject
  router.post('/dossiers/:id/reject', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { error } = await supabase
      .from('dossiers')
      .update({ status: 'rejected', updatedAt: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('campaignId', campaignId);

    if (error) return res.status(500).json({ error: error.message });

    await audit(supabase, {
      ...actorFromRequest(req),
      action: 'dossier.reject',
      resourceType: 'dossier',
      resourceId: req.params.id,
      severity: 'info',
    });
    return res.json({ status: 'rejected' });
  });

  return router;
}
