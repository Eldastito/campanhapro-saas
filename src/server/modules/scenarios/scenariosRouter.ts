import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runMonteCarlo, CandidateInput } from './monteCarloService';
import {
  generatePersonas, runDebateTurn, generateReport, chatWithAgent,
  type AgentSpec, type Persona, type DebateTurn,
} from './aiDebate';
import { isChatConfigured } from '../ai/chatCompletion';
import { isWithinAiBudget } from '../billing/billingService';
import { ingestArtifact } from '../rag/knowledgeIngest';
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

  // ──────────────────────────────────────────────────────────────────────────
  // DEBATE por IA (estilo MiroFish): personas → turnos → relatório → chat.
  // Endpoints de IA gateados por isChatConfigured (503) + orçamento (402).
  // ──────────────────────────────────────────────────────────────────────────

  async function aiGate(req: any, res: any): Promise<boolean> {
    if (!isChatConfigured()) { res.status(503).json({ error: 'ai_not_configured' }); return false; }
    const ok = await isWithinAiBudget(supabase, req.user?.campaignId).catch(() => true);
    if (!ok) { res.status(402).json({ error: 'ai_budget_exceeded' }); return false; }
    return true;
  }

  // Monta um contexto curto da campanha (candidato, adversários, clima da base)
  // pra ancorar as personas em dados reais. Best-effort: fonte que falhar é pulada.
  async function buildCampaignContext(campaignId: string): Promise<string> {
    const parts: string[] = [];
    try {
      const { data: camp } = await supabase.from('campaigns')
        .select('"candidateName", party, "electionRole", "electionCity", "electionState"')
        .eq('id', campaignId).maybeSingle();
      if (camp) parts.push(
        `Candidato: ${(camp as any).candidateName || '?'} (${(camp as any).party || 'partido?'}), ` +
        `concorrendo a ${(camp as any).electionRole || 'cargo'} em ${(camp as any).electionCity || ''} ${(camp as any).electionState || ''}.`.trim());
    } catch { /* skip */ }
    try {
      const { data: opps } = await supabase.from('competitor_intel')
        .select('name, cargo, narrative').eq('campaignId', campaignId).limit(4);
      if (opps?.length) parts.push('Adversários: ' + opps.map((o: any) =>
        `${o.name}${o.cargo ? ` (${o.cargo})` : ''}${o.narrative ? ` — ${String(o.narrative).slice(0, 140)}` : ''}`).join('; '));
    } catch { /* skip */ }
    try {
      const { data: contacts } = await supabase.from('contacts')
        .select('"supportLevel"').eq('campaignId', campaignId).limit(3000);
      if (contacts?.length) {
        const c: Record<string, number> = {};
        (contacts as any[]).forEach((r) => { const k = (r.supportLevel || 'indefinido').toLowerCase(); c[k] = (c[k] || 0) + 1; });
        parts.push('Clima da base de contatos: ' + Object.entries(c).map(([k, v]) => `${v} ${k}`).join(', ') + '.');
      }
    } catch { /* skip */ }
    return parts.join('\n') || 'Campanha eleitoral brasileira.';
  }

  // POST /debate/personas — gera personas pros agentes (nós do grafo).
  router.post('/debate/personas', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await aiGate(req, res))) return;
    const { agents } = req.body as { agents: AgentSpec[] };
    if (!Array.isArray(agents) || agents.length === 0) return res.status(400).json({ error: 'agents required' });
    if (agents.length > 14) return res.status(400).json({ error: 'too_many_agents' });
    try {
      const ctx = await buildCampaignContext(campaignId);
      const personas = await generatePersonas(agents.slice(0, 14), ctx);
      return res.json({ personas });
    } catch (err: any) {
      return res.status(500).json({ error: 'personas_failed', detail: String(err?.message ?? err) });
    }
  });

  // POST /debate/turn — roda um turno (batch de todos os agentes).
  router.post('/debate/turn', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await aiGate(req, res))) return;
    const { personas, scenario, prior, turn } = req.body as {
      personas: Persona[]; scenario: string; prior: DebateTurn | null; turn: number;
    };
    if (!Array.isArray(personas) || !personas.length || !scenario) return res.status(400).json({ error: 'personas and scenario required' });
    try {
      const agents = await runDebateTurn(personas.slice(0, 14), scenario, prior ?? null, turn || 1);
      return res.json({ turn: turn || 1, agents });
    } catch (err: any) {
      return res.status(500).json({ error: 'turn_failed', detail: String(err?.message ?? err) });
    }
  });

  // POST /debate/report — relatório final do relator.
  router.post('/debate/report', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await aiGate(req, res))) return;
    const { scenario, personas, transcript, metrics } = req.body as {
      scenario: string; personas: Persona[]; transcript: DebateTurn[]; metrics?: any;
    };
    if (!scenario || !Array.isArray(personas) || !Array.isArray(transcript)) return res.status(400).json({ error: 'invalid_body' });
    try {
      const report = await generateReport(scenario, personas, transcript, metrics);
      return res.json({ report });
    } catch (err: any) {
      return res.status(500).json({ error: 'report_failed', detail: String(err?.message ?? err) });
    }
  });

  // POST /debate/chat — conversa 1–1 com uma persona simulada.
  router.post('/debate/chat', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await aiGate(req, res))) return;
    const { persona, scenario, history, message } = req.body as {
      persona: Persona; scenario: string; history: Array<{ role: 'user' | 'agent'; text: string }>; message: string;
    };
    if (!persona || !message) return res.status(400).json({ error: 'persona and message required' });
    try {
      const reply = await chatWithAgent(persona, scenario || '', history ?? [], message);
      return res.json({ reply });
    } catch (err: any) {
      return res.status(500).json({ error: 'chat_failed', detail: String(err?.message ?? err) });
    }
  });

  // POST /debate — persiste o debate concluído (aparece no Histórico).
  router.post('/debate', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { label, scenario, agents, transcript, report, turns, metrics } = req.body as any;
    if (!scenario) return res.status(400).json({ error: 'scenario required' });
    const { data, error } = await supabase.from('scenario_debates').insert({
      campaignId, label: label ?? 'Debate', scenario,
      agents: agents ?? [], transcript: transcript ?? [], report: report ?? null,
      turns: turns ?? (Array.isArray(transcript) ? transcript.length : 0),
    }).select('id').single();
    if (error) return res.status(500).json({ error: error.message });

    // Indexa um RESUMO no RAG → vira memória de longo prazo consultável pelos
    // agentes (inclui o orquestrador via retrieveContext): cenários passados
    // enriquecem análises macro e ajudam a achar oportunidades/falhas.
    try {
      const pctOf = (v: number, t: number) => (t ? Math.round((v / t) * 100) : 0);
      const m = metrics;
      const metaLine = m
        ? `Resultado: apoio ${pctOf(m.before?.apoio, m.total)}%→${pctOf(m.after?.apoio, m.total)}%, oposição ${pctOf(m.before?.oposicao, m.total)}%→${pctOf(m.after?.oposicao, m.total)}% (amostra ${m.total}).` +
          (m.hoods?.length ? ` Por região: ${m.hoods.map((h: any) => `${h.label} ${h.pct}%`).join(', ')}.` : '')
        : '';
      const text = `Cenário simulado: ${scenario}\n${metaLine}\n\n${report || ''}`.trim();
      await ingestArtifact(supabase, {
        campaignId,
        source: 'agent:scenario-debate',
        title: `Simulação de cenário: ${(label || scenario).slice(0, 80)}`,
        text,
        metadata: { kind: 'scenario_debate', debateId: data?.id, hasPrimarySources: false },
      });
    } catch { /* best-effort */ }

    return res.status(201).json({ debateId: data?.id });
  });

  // GET /debate — lista debates salvos (pro Histórico).
  router.get('/debate', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { data, error } = await supabase.from('scenario_debates')
      .select('id, label, scenario, agents, transcript, report, turns, "createdAt"')
      .eq('campaignId', campaignId)
      .order('createdAt', { ascending: false })
      .limit(20);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ debates: data ?? [] });
  });

  return router;
}
