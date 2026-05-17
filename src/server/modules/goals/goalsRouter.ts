import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';

function campaignId(req: Request): string | undefined {
  return (req as any).user?.campaignId ?? (req.query.campaignId as string | undefined);
}

export function createGoalsRouter(supabaseAdmin: SupabaseClient) {
  const router = Router();

  // ── Goals ────────────────────────────────────────────────────────────────

  router.get('/goals', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data, error } = await supabaseAdmin
        .from('campaign_goals')
        .select('*')
        .eq('campaignId', cid)
        .order('createdAt', { ascending: true });

      if (error) throw error;
      return res.json({ goals: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/goals', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req) ?? req.body.campaignId;
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { title, description, level, status, priority, parentId, ownerAgentId, startDate, dueDate, metadata } = req.body;
      if (!title) return res.status(400).json({ error: 'title obrigatório' });

      const validLevels = ['strategic', 'tactical', 'operational', 'task'];
      if (level && !validLevels.includes(level)) return res.status(400).json({ error: 'level inválido' });

      const { data, error } = await supabaseAdmin
        .from('campaign_goals')
        .insert({
          campaignId: cid,
          title,
          description: description ?? null,
          level: level ?? 'task',
          status: status ?? 'planned',
          priority: priority ?? 'medium',
          parentId: parentId ?? null,
          ownerAgentId: ownerAgentId ?? null,
          startDate: startDate ?? null,
          dueDate: dueDate ?? null,
          metadata: metadata ?? {},
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ goal: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.patch('/goals/:id', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const allowed = ['title', 'description', 'level', 'status', 'priority', 'parentId',
        'ownerAgentId', 'startDate', 'dueDate', 'completedAt', 'metadata'];
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      for (const key of allowed) {
        if (key in req.body) updates[key] = req.body[key];
      }

      if (req.body.status === 'completed' && !req.body.completedAt) {
        updates['completedAt'] = new Date().toISOString();
      }

      const { data, error } = await supabaseAdmin
        .from('campaign_goals')
        .update(updates)
        .eq('id', req.params.id)
        .eq('campaignId', cid)
        .select()
        .single();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'not_found' });
      return res.json({ goal: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.delete('/goals/:id', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { error } = await supabaseAdmin
        .from('campaign_goals')
        .delete()
        .eq('id', req.params.id)
        .eq('campaignId', cid);

      if (error) throw error;
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Projects ─────────────────────────────────────────────────────────────

  router.get('/projects', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data, error } = await supabaseAdmin
        .from('campaign_projects')
        .select('*')
        .eq('campaignId', cid)
        .order('createdAt', { ascending: true });

      if (error) throw error;
      return res.json({ projects: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/projects', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req) ?? req.body.campaignId;
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { title, description, goalId, status, priority, ownerAgentId, startDate, endDate, metadata } = req.body;
      if (!title) return res.status(400).json({ error: 'title obrigatório' });

      const { data, error } = await supabaseAdmin
        .from('campaign_projects')
        .insert({
          campaignId: cid,
          title,
          description: description ?? null,
          goalId: goalId ?? null,
          status: status ?? 'active',
          priority: priority ?? 'medium',
          ownerAgentId: ownerAgentId ?? null,
          startDate: startDate ?? null,
          endDate: endDate ?? null,
          metadata: metadata ?? {},
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ project: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.patch('/projects/:id', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const allowed = ['title', 'description', 'goalId', 'status', 'priority',
        'ownerAgentId', 'startDate', 'endDate', 'metadata'];
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      for (const key of allowed) {
        if (key in req.body) updates[key] = req.body[key];
      }

      const { data, error } = await supabaseAdmin
        .from('campaign_projects')
        .update(updates)
        .eq('id', req.params.id)
        .eq('campaignId', cid)
        .select()
        .single();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'not_found' });
      return res.json({ project: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.delete('/projects/:id', async (req: Request, res: Response) => {
    try {
      const cid = campaignId(req);
      if (!cid) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { error } = await supabaseAdmin
        .from('campaign_projects')
        .delete()
        .eq('id', req.params.id)
        .eq('campaignId', cid);

      if (error) throw error;
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
