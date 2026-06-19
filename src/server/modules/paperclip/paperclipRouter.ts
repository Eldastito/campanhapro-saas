import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { AgentTask } from '../integrations/paperclipClient';
import { enqueueTask, executeTask, approveTask, rejectTask, syncTaskStatus } from './taskQueue';
import { audit, actorFromRequest } from '../observability/auditLogger';
import { tenantCampaignId } from '../../lib/tenantScope';

export function createPaperclipRouter(supabaseAdmin: SupabaseClient) {
  const router = Router();

  /**
   * POST /api/v1/paperclip/tasks
   * Enqueues a new agent task. If requiresApproval the task waits
   * for a human to call /approve before executing.
   */
  router.post('/tasks', async (req: Request, res: Response) => {
    try {
      const campaignId = tenantCampaignId(req);
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { type, payload, requiresApproval } = req.body as Partial<AgentTask>;
      if (!type) return res.status(400).json({ error: 'type obrigatório' });

      const task = await enqueueTask(supabaseAdmin, {
        campaignId,
        type: type as AgentTask['type'],
        payload: payload ?? {},
        requiresApproval: requiresApproval ?? false,
      });

      // Fire-and-forget execution for tasks that don't need approval
      if (task.status === 'pending') {
        executeTask(supabaseAdmin, task.id, campaignId).catch(err =>
          console.error('[Paperclip] execute background error:', err)
        );
      }

      return res.status(201).json({ task });
    } catch (err: any) {
      console.error('[Paperclip] enqueue:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/v1/paperclip/tasks
   * Lists tasks for the current campaign, newest first.
   */
  router.get('/tasks', async (req: Request, res: Response) => {
    try {
      const campaignId = tenantCampaignId(req);
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data, error } = await supabaseAdmin
        .from('agent_tasks')
        .select('*')
        .eq('campaignId', campaignId)
        .order('createdAt', { ascending: false })
        .limit(50);

      if (error) throw error;
      return res.json({ tasks: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/v1/paperclip/tasks/:id
   * Returns task details, optionally syncing from Paperclip.
   */
  router.get('/tasks/:id', async (req: Request, res: Response) => {
    try {
      const campaignId = tenantCampaignId(req);
      if (!campaignId) return res.status(401).json({ error: 'campaignId ausente na sessão' });
      const taskId = req.params.id;

      // Try to sync from Paperclip if running
      await syncTaskStatus(supabaseAdmin, taskId, campaignId).catch(() => {});

      const { data, error } = await supabaseAdmin
        .from('agent_tasks')
        .select('*')
        .eq('id', taskId)
        .eq('campaignId', campaignId)
        .single();

      if (error || !data) return res.status(404).json({ error: 'not_found' });
      return res.json({ task: data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/v1/paperclip/tasks/:id/approve
   * Human approval gate. Transitions awaiting_approval → pending, then executes.
   */
  router.post('/tasks/:id/approve', async (req: Request, res: Response) => {
    try {
      const campaignId = tenantCampaignId(req);
      const userId = (req as any).user?.id;
      const taskId = req.params.id;

      if (!campaignId || !userId) return res.status(400).json({ error: 'auth obrigatório' });

      await approveTask(supabaseAdmin, taskId, campaignId, userId);

      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'agent_task.approve',
        resourceType: 'agent_task',
        resourceId: taskId,
        severity: 'warn',
      });

      // Fire-and-forget execution
      executeTask(supabaseAdmin, taskId, campaignId).catch(err =>
        console.error('[Paperclip] post-approve execute error:', err)
      );

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/v1/paperclip/tasks/:id/reject
   * Rejects an awaiting_approval task — task is cancelled.
   */
  router.post('/tasks/:id/reject', async (req: Request, res: Response) => {
    try {
      const campaignId = tenantCampaignId(req);
      const userId = (req as any).user?.id;
      const taskId = req.params.id;

      if (!campaignId || !userId) return res.status(400).json({ error: 'auth obrigatório' });

      await rejectTask(supabaseAdmin, taskId, campaignId, userId);
      await audit(supabaseAdmin, {
        ...actorFromRequest(req),
        action: 'agent_task.reject',
        resourceType: 'agent_task',
        resourceId: taskId,
        severity: 'info',
      });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/v1/paperclip/tasks/:id/retry
   * Manually retries a failed task (resets to pending).
   */
  router.post('/tasks/:id/retry', async (req: Request, res: Response) => {
    try {
      const campaignId = tenantCampaignId(req);
      if (!campaignId) return res.status(401).json({ error: 'campaignId ausente na sessão' });
      const taskId = req.params.id;

      const { error } = await supabaseAdmin
        .from('agent_tasks')
        .update({ status: 'pending', errorMessage: null, updatedAt: new Date().toISOString() })
        .eq('id', taskId)
        .eq('campaignId', campaignId)
        .eq('status', 'failed');

      if (error) throw error;

      executeTask(supabaseAdmin, taskId, campaignId).catch(err =>
        console.error('[Paperclip] retry execute error:', err)
      );

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
