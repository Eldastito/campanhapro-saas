import { Router, Request, Response, RequestHandler } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { callAgent } from '../../../lib/aiCallAgent';
import { audit, actorFromRequest } from '../observability/auditLogger';
import { enqueueTask, executeTask, registerLocalTaskHandler } from '../paperclip/taskQueue';
import { tenantCampaignId } from '../../lib/tenantScope';

type Bucket = 'recursos' | 'financeiro' | 'material' | 'pessoal' | 'redes_sociais' | 'outros' | 'reserva';

/**
 * Maps Expense.categoria (Portuguese labels stored in expenses table) onto the
 * CEO's strategic buckets. Used to compute "spent per bucket".
 */
const CATEGORY_TO_BUCKET: Record<string, Bucket> = {
  'Alimentação': 'pessoal',
  'Combustível': 'recursos',
  'Aluguel de Carro': 'recursos',
  'Aluguel de Espaço': 'recursos',
  'Material Gráfico': 'material',
  'Pessoal (Ajuda de Custo)': 'pessoal',
  'Pessoal (Salário)': 'pessoal',
  'Advogado': 'financeiro',
  'Contador': 'financeiro',
  'Eventos': 'material',
  'Marketing Digital': 'redes_sociais',
  'Outra': 'outros',
};

const ALL_BUCKETS: Bucket[] = ['recursos', 'financeiro', 'material', 'pessoal', 'redes_sociais', 'outros', 'reserva'];

function campaignIdOf(req: Request): string | undefined {
  return tenantCampaignId(req);
}

interface CampaignBudgetContext {
  totalBudgetCents: number;
  electionDate: string | null;
  daysUntilElection: number | null;
}

async function loadCampaignBudget(supabaseAdmin: SupabaseClient, campaignId: string): Promise<CampaignBudgetContext> {
  // The campaign budget lives in the campaigns table's settings column or
  // in a campaign_settings row depending on the deployment. Try both shapes.
  let totalBudgetCents = 0;
  let electionDate: string | null = null;

  const { data: settings } = await supabaseAdmin
    .from('settings')
    .select('campaignDetails')
    .eq('campaignId', campaignId)
    .maybeSingle();

  if (settings?.campaignDetails) {
    const cd = settings.campaignDetails as Record<string, unknown>;
    // orcamento pode vir como number ou string (input numérico) — coage com segurança.
    const orc = Number(cd.orcamento);
    if (Number.isFinite(orc) && orc > 0) {
      totalBudgetCents = Math.round(orc * 100);
    }
    if (typeof cd.electionDate === 'string') {
      electionDate = cd.electionDate;
    }
  }

  let daysUntilElection: number | null = null;
  if (electionDate) {
    const diff = new Date(electionDate).getTime() - Date.now();
    daysUntilElection = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  return { totalBudgetCents, electionDate, daysUntilElection };
}

async function loadSpentByBucket(supabaseAdmin: SupabaseClient, campaignId: string): Promise<Record<Bucket, number>> {
  const result = Object.fromEntries(ALL_BUCKETS.map(b => [b, 0])) as Record<Bucket, number>;

  const { data: expenses } = await supabaseAdmin
    .from('expenses')
    .select('categoria, valor')
    .eq('campaignId', campaignId);

  for (const ex of expenses ?? []) {
    const bucket = CATEGORY_TO_BUCKET[ex.categoria as string] ?? 'outros';
    const cents = Math.round(Number(ex.valor ?? 0) * 100);
    result[bucket] += cents;
  }
  return result;
}

async function loadActiveAllocations(supabaseAdmin: SupabaseClient, campaignId: string): Promise<Record<Bucket, number>> {
  const result = Object.fromEntries(ALL_BUCKETS.map(b => [b, 0])) as Record<Bucket, number>;

  const { data: rows } = await supabaseAdmin
    .from('budget_allocations')
    .select('bucket, allocatedCents')
    .eq('campaignId', campaignId)
    .in('status', ['approved', 'active']);

  for (const r of rows ?? []) {
    const b = r.bucket as Bucket;
    if (ALL_BUCKETS.includes(b)) {
      result[b] += Number(r.allocatedCents ?? 0);
    }
  }
  return result;
}

// CEO prompts kept at module level so they're shared between the local handler and tests
const CEO_SYSTEM_PROMPT = [
  'Você é o CEO de uma campanha eleitoral. Sua missão é VENCER a eleição respeitando o orçamento.',
  'Sua única responsabilidade nesta chamada: ALOCAR o orçamento entre 7 buckets, retornando JSON estrito.',
  'Regras:',
  '- A soma dos buckets NÃO pode exceder o orçamento disponível (orçamento total - já gasto).',
  '- Sempre reserve pelo menos 10% para o bucket "reserva" (imprevistos).',
  '- Investimento em "redes_sociais" deve crescer conforme se aproxima a eleição (curva sigmoide).',
  '- Em campanha brasileira típica: pessoal ~30%, material ~25%, recursos ~15%, redes_sociais 10-25%, financeiro ~5%, outros ~5%, reserva 10%.',
  '- Quanto mais perto da eleição, mais peso em redes_sociais e material; menos em pessoal estrutural.',
  'Buckets:',
  '  recursos       — combustível, aluguel de carro, aluguel de espaço',
  '  financeiro     — advogado, contador, taxas administrativas',
  '  material       — material gráfico, eventos, comícios',
  '  pessoal        — salários, ajuda de custo, alimentação',
  '  redes_sociais  — marketing digital, impulsionamento, anúncios',
  '  outros         — gastos não categorizados',
  '  reserva        — fundo de imprevistos (mínimo 10%)',
  'Retorne EXCLUSIVAMENTE um objeto JSON no formato:',
  '{ "summary": "<resumo executivo em pt-BR, 2-3 frases>",',
  '  "allocations": [ { "bucket": "<id>", "allocatedCents": <int>, "rationale": "<por que>" } ] }',
  'Não inclua markdown, comentários, nem texto fora do JSON.',
].join('\n');

// Registered once at module load — runs in-process when PAPERCLIP_URL is not set
registerLocalTaskHandler('budget-ceo-plan', async (supabase, task) => {
  const { campaignId, payload } = task;
  const userId = (payload.userId as string) ?? null;

  const [ctx, spent, allocated] = await Promise.all([
    loadCampaignBudget(supabase, campaignId),
    loadSpentByBucket(supabase, campaignId),
    loadActiveAllocations(supabase, campaignId),
  ]);

  if (ctx.totalBudgetCents <= 0) {
    throw new Error('Orçamento total não definido em Configurações');
  }

  const totalSpent = Object.values(spent).reduce((a, b) => a + b, 0);
  const remaining = Math.max(0, ctx.totalBudgetCents - totalSpent);

  const userPrompt = [
    `Orçamento total: R$ ${(ctx.totalBudgetCents / 100).toFixed(2)}`,
    `Já gasto: R$ ${(totalSpent / 100).toFixed(2)}`,
    `Disponível para alocação: R$ ${(remaining / 100).toFixed(2)}`,
    ctx.electionDate ? `Eleição em: ${ctx.electionDate} (${ctx.daysUntilElection} dias)` : 'Data de eleição não definida',
    '',
    'Gastos atuais por bucket (cents):',
    ...ALL_BUCKETS.map(b => `  ${b}: ${spent[b]}`),
    '',
    'Alocações ativas atuais (cents):',
    ...ALL_BUCKETS.map(b => `  ${b}: ${allocated[b]}`),
    '',
    'Proponha a alocação ótima para os centavos restantes (' + remaining + ' cents). Retorne o JSON.',
  ].join('\n');

  const aiResult = await callAgent(supabase, 'manager', userPrompt, {
    campaignId,
    userId,
    systemInstruction: CEO_SYSTEM_PROMPT,
  });

  // Parse JSON — tolerate code fences
  const text = aiResult.text.trim();
  const jsonStr = text.startsWith('```')
    ? text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim()
    : text;
  const parsed = JSON.parse(jsonStr);

  if (!Array.isArray(parsed.allocations)) {
    throw new Error('CEO retornou JSON sem array de alocações');
  }

  const proposedTotal = parsed.allocations.reduce(
    (sum: number, a: any) => sum + (Number(a.allocatedCents) || 0), 0
  );
  if (proposedTotal > remaining * 1.01) {
    throw new Error(`Proposta excede orçamento disponível: proposto ${proposedTotal}, disponível ${remaining}`);
  }

  // Supersede any previous proposed allocations before inserting new ones
  await supabase
    .from('budget_allocations')
    .update({ status: 'superseded', updatedAt: new Date().toISOString() })
    .eq('campaignId', campaignId)
    .eq('status', 'proposed');

  const rows = parsed.allocations
    .filter((a: any) => ALL_BUCKETS.includes(a.bucket) && Number(a.allocatedCents) > 0)
    .map((a: any) => ({
      campaignId,
      bucket: a.bucket,
      allocatedCents: Math.round(Number(a.allocatedCents)),
      period: 'campaign',
      rationale: typeof a.rationale === 'string' ? a.rationale : null,
      status: 'proposed',
      createdByAgentId: 'manager',
      metadata: { summary: parsed.summary ?? null, model: aiResult.model, agentTaskId: task.id },
    }));

  if (rows.length === 0) {
    throw new Error('Nenhuma alocação válida proposta');
  }

  const { error: insertError } = await supabase.from('budget_allocations').insert(rows);
  if (insertError) throw insertError;

  return {
    result: JSON.stringify({
      summary: parsed.summary ?? null,
      totalProposedCents: proposedTotal,
      model: aiResult.model,
    }),
    costCents: aiResult.costCentsUsd ?? 0,
  };
});

export function createBudgetRouter(supabaseAdmin: SupabaseClient, aiBudgetGuard?: RequestHandler) {
  const router = Router();

  // GET /summary — totals + per-bucket spent + allocated
  router.get('/summary', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const [ctx, spent, allocated] = await Promise.all([
        loadCampaignBudget(supabaseAdmin, cid),
        loadSpentByBucket(supabaseAdmin, cid),
        loadActiveAllocations(supabaseAdmin, cid),
      ]);

      const totalSpentCents = Object.values(spent).reduce((a, b) => a + b, 0);
      const totalAllocatedCents = Object.values(allocated).reduce((a, b) => a + b, 0);

      const buckets = ALL_BUCKETS.map(b => ({
        bucket: b,
        spentCents: spent[b],
        allocatedCents: allocated[b],
      }));

      return res.json({
        totalBudgetCents: ctx.totalBudgetCents,
        totalSpentCents,
        totalAllocatedCents,
        remainingCents: Math.max(0, ctx.totalBudgetCents - totalSpentCents),
        unallocatedCents: Math.max(0, ctx.totalBudgetCents - totalAllocatedCents),
        electionDate: ctx.electionDate,
        daysUntilElection: ctx.daysUntilElection,
        buckets,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /allocations — list all (optionally filtered by status)
  router.get('/allocations', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      let query = supabaseAdmin
        .from('budget_allocations')
        .select('*')
        .eq('campaignId', cid)
        .order('createdAt', { ascending: false });

      if (req.query.status) {
        query = query.eq('status', req.query.status as string);
      }

      const { data, error } = await query;
      if (error) throw error;
      return res.json({ allocations: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /allocations — create manual allocation (already approved if user creates it)
  router.post('/allocations', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req) ?? req.body.campaignId;
      const userId = (req as any).user?.id ?? null;
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { bucket, allocatedCents, period, rationale, periodStart, periodEnd } = req.body;
      if (!bucket || !ALL_BUCKETS.includes(bucket)) {
        return res.status(400).json({ error: 'bucket inválido' });
      }
      if (typeof allocatedCents !== 'number' || allocatedCents < 0) {
        return res.status(400).json({ error: 'allocatedCents inválido' });
      }

      const { data, error } = await supabaseAdmin
        .from('budget_allocations')
        .insert({
          campaignId: cid,
          bucket,
          allocatedCents,
          period: period ?? 'campaign',
          periodStart: periodStart ?? null,
          periodEnd: periodEnd ?? null,
          rationale: rationale ?? null,
          status: 'approved',
          approvedByUserId: userId,
          approvedAt: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'budget.allocation_created',
        resourceType: 'budget_allocation',
        resourceId: data.id,
        severity: 'info',
        metadata: { bucket, allocatedCents },
      });

      return res.status(201).json({ allocation: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // PATCH /allocations/:id/approve — human approves CEO proposal
  router.patch('/allocations/:id/approve', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      const userId = (req as any).user?.id ?? null;
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data, error } = await supabaseAdmin
        .from('budget_allocations')
        .update({
          status: 'approved',
          approvedByUserId: userId,
          approvedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .eq('id', req.params.id)
        .eq('campaignId', cid)
        .eq('status', 'proposed')
        .select()
        .single();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'proposta não encontrada ou já processada' });

      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'budget.allocation_approved',
        resourceType: 'budget_allocation',
        resourceId: data.id,
        severity: 'warn',
        metadata: { bucket: data.bucket, allocatedCents: data.allocatedCents },
      });

      return res.json({ allocation: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // PATCH /allocations/:id/reject
  router.patch('/allocations/:id/reject', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data, error } = await supabaseAdmin
        .from('budget_allocations')
        .update({ status: 'rejected', updatedAt: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('campaignId', cid)
        .eq('status', 'proposed')
        .select()
        .single();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'proposta não encontrada ou já processada' });
      return res.json({ allocation: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // DELETE /allocations/:id
  router.delete('/allocations/:id', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { error } = await supabaseAdmin
        .from('budget_allocations')
        .delete()
        .eq('id', req.params.id)
        .eq('campaignId', cid);

      if (error) throw error;
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /ceo-plan — enqueue a budget-ceo-plan task via Paperclip orchestration.
  // Returns 202 immediately; frontend polls GET /ceo-plan/status/:taskId.
  const ceoPlanCore: RequestHandler = async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req) ?? req.body.campaignId;
      const userId = (req as any).user?.id ?? null;
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      // Quick budget check so we fail fast before queuing
      const ctx = await loadCampaignBudget(supabaseAdmin, cid);
      if (ctx.totalBudgetCents <= 0) {
        return res.status(400).json({ error: 'Orçamento total não definido em Configurações' });
      }

      const task = await enqueueTask(supabaseAdmin, {
        campaignId: cid,
        type: 'budget-ceo-plan',
        payload: { userId },
        requiresApproval: false,
      });

      // Fire-and-forget — local handler runs the CEO agent and inserts budget_allocations
      executeTask(supabaseAdmin, task.id, cid).catch(err =>
        console.error('[Budget] CEO task execute error:', err)
      );

      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'budget.ceo_plan_queued',
        resourceType: 'agent_task',
        resourceId: task.id,
        severity: 'info',
        metadata: { taskId: task.id },
      });

      return res.status(202).json({ taskId: task.id, status: task.status });
    } catch (err: any) {
      console.error('[Budget] CEO plan queue error:', err);
      return res.status(500).json({ error: err.message });
    }
  };
  const ceoPlanHandlers = aiBudgetGuard ? [aiBudgetGuard, ceoPlanCore] : [ceoPlanCore];
  router.post('/ceo-plan', ...ceoPlanHandlers);

  // GET /ceo-plan/status/:taskId — lightweight polling endpoint for BudgetCEOPanel
  router.get('/ceo-plan/status/:taskId', async (req: Request, res: Response) => {
    try {
      const cid = campaignIdOf(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data, error } = await supabaseAdmin
        .from('agent_tasks')
        .select('id, status, result, errorMessage, costCents, updatedAt, completedAt')
        .eq('id', req.params.taskId)
        .eq('campaignId', cid)
        .eq('type', 'budget-ceo-plan')
        .single();

      if (error || !data) return res.status(404).json({ error: 'task_not_found' });
      return res.json({ task: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
