import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { tenantCampaignId } from '../../lib/tenantScope';

function campaignId(req: Request): string | undefined {
  return tenantCampaignId(req);
}

export function createRoutinesRouter(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // ── Routines ──────────────────────────────────────────────────────────────

  router.get('/routines', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data, error } = await supabaseAdmin
        .from('agent_routines')
        .select('*')
        .eq('campaignId', cid)
        .order('createdAt', { ascending: false });

      if (error) throw error;
      return res.json({ routines: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/routines', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { title, description, goalId, projectId, assigneeAgentId,
        concurrencyPolicy, catchUpPolicy, variables } = req.body;
      if (!title) return res.status(400).json({ error: 'title obrigatório' });

      const userId = (req as any).user?.id ?? null;

      const { data, error } = await supabaseAdmin
        .from('agent_routines')
        .insert({
          campaignId: cid,
          title,
          description: description ?? null,
          goalId: goalId ?? null,
          projectId: projectId ?? null,
          assigneeAgentId: assigneeAgentId ?? null,
          status: 'active',
          concurrencyPolicy: concurrencyPolicy ?? 'coalesce_if_active',
          catchUpPolicy: catchUpPolicy ?? 'skip_missed',
          variables: variables ?? [],
          createdByUserId: userId,
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ routine: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.patch('/routines/:id', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const allowed = ['title', 'description', 'goalId', 'projectId', 'assigneeAgentId',
        'status', 'concurrencyPolicy', 'catchUpPolicy', 'variables'];
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      for (const key of allowed) {
        if (key in req.body) updates[key] = req.body[key];
      }

      const { data, error } = await supabaseAdmin
        .from('agent_routines')
        .update(updates)
        .eq('id', req.params.id)
        .eq('campaignId', cid)
        .select()
        .single();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'not_found' });
      return res.json({ routine: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.delete('/routines/:id', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { error } = await supabaseAdmin
        .from('agent_routines')
        .delete()
        .eq('id', req.params.id)
        .eq('campaignId', cid);

      if (error) throw error;
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Triggers ──────────────────────────────────────────────────────────────

  router.get('/routines/:id/triggers', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data, error } = await supabaseAdmin
        .from('routine_triggers')
        .select('*')
        .eq('routineId', req.params.id)
        .eq('campaignId', cid)
        .order('createdAt', { ascending: true });

      if (error) throw error;
      return res.json({ triggers: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/routines/:id/triggers', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { kind, label, cronExpression, timezone, enabled } = req.body;
      if (!kind) return res.status(400).json({ error: 'kind obrigatório' });

      const validKinds = ['cron', 'webhook', 'manual'];
      if (!validKinds.includes(kind)) return res.status(400).json({ error: 'kind inválido' });
      if (kind === 'cron' && !cronExpression) {
        return res.status(400).json({ error: 'cronExpression obrigatório para triggers cron' });
      }

      const { data, error } = await supabaseAdmin
        .from('routine_triggers')
        .insert({
          campaignId: cid,
          routineId: req.params.id,
          kind,
          label: label ?? null,
          cronExpression: cronExpression ?? null,
          timezone: timezone ?? 'America/Sao_Paulo',
          enabled: enabled ?? true,
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ trigger: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.patch('/triggers/:id', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const allowed = ['label', 'enabled', 'cronExpression', 'timezone', 'nextRunAt'];
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      for (const key of allowed) {
        if (key in req.body) updates[key] = req.body[key];
      }

      const { data, error } = await supabaseAdmin
        .from('routine_triggers')
        .update(updates)
        .eq('id', req.params.id)
        .eq('campaignId', cid)
        .select()
        .single();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'not_found' });
      return res.json({ trigger: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.delete('/triggers/:id', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { error } = await supabaseAdmin
        .from('routine_triggers')
        .delete()
        .eq('id', req.params.id)
        .eq('campaignId', cid);

      if (error) throw error;
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Runs ──────────────────────────────────────────────────────────────────

  router.get('/routines/:id/runs', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data, error } = await supabaseAdmin
        .from('routine_runs')
        .select('*')
        .eq('routineId', req.params.id)
        .eq('campaignId', cid)
        .order('triggeredAt', { ascending: false })
        .limit(50);

      if (error) throw error;
      return res.json({ runs: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Manual dispatch: creates a routine_run with source='manual'
  router.post('/routines/:id/run', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      // Verify routine belongs to campaign
      const { data: routine, error: rErr } = await supabaseAdmin
        .from('agent_routines')
        .select('id, status, concurrencyPolicy')
        .eq('id', req.params.id)
        .eq('campaignId', cid)
        .single();

      if (rErr || !routine) return res.status(404).json({ error: 'routine não encontrada' });
      if (routine.status === 'archived') return res.status(409).json({ error: 'routine arquivada' });

      // Enforce concurrency policy
      if (routine.concurrencyPolicy !== 'allow_parallel') {
        const { data: active } = await supabaseAdmin
          .from('routine_runs')
          .select('id')
          .eq('routineId', routine.id)
          .in('status', ['received', 'running'])
          .limit(1)
          .maybeSingle();

        if (active) {
          if (routine.concurrencyPolicy === 'skip_if_active') {
            return res.status(409).json({ error: 'skip_if_active: execução já em andamento' });
          }
          // coalesce_if_active: return existing run
          return res.status(200).json({ run: active, coalesced: true });
        }
      }

      const now = new Date().toISOString();
      const { data: run, error } = await supabaseAdmin
        .from('routine_runs')
        .insert({
          campaignId: cid,
          routineId: routine.id,
          triggerId: null,
          source: 'manual',
          status: 'received',
          triggeredAt: now,
        })
        .select()
        .single();

      if (error) throw error;

      // Update lastTriggeredAt on the routine
      await supabaseAdmin
        .from('agent_routines')
        .update({ lastTriggeredAt: now, lastEnqueuedAt: now, updatedAt: now })
        .eq('id', routine.id);

      return res.status(201).json({ run });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
