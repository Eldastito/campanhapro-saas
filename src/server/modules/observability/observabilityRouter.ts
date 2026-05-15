import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildComplianceSummary, buildIntegrationHealth } from './complianceService';

export function createObservabilityRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // GET /health — public (no auth) liveness probe
  router.get('/health', async (_req, res) => {
    let dbOk = false;
    try {
      const { error } = await supabase.from('campaigns').select('id', { head: true, count: 'estimated' });
      dbOk = !error;
    } catch {
      dbOk = false;
    }
    const integrations = buildIntegrationHealth();
    const allCriticalUp = integrations.find(i => i.name === 'Supabase')?.status === 'ok';
    res.status(dbOk && allCriticalUp ? 200 : 503).json({
      status: dbOk && allCriticalUp ? 'ok' : 'degraded',
      db: dbOk,
      integrations,
      uptime: process.uptime(),
      version: process.env.APP_VERSION ?? 'dev',
      ts: new Date().toISOString(),
    });
  });

  // GET /compliance — campaign-scoped compliance summary
  router.get('/compliance', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const summary = await buildComplianceSummary(supabase, campaignId);
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /audit — recent audit logs (paginated)
  router.get('/audit', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    const severity = String(req.query.severity ?? '').trim();
    const action = String(req.query.action ?? '').trim();

    let q = supabase
      .from('audit_logs')
      .select('id, action, actor_id, actor_type, resource_type, resource_id, severity, metadata, trace_id, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (severity && ['info', 'warn', 'error', 'critical'].includes(severity)) {
      q = q.eq('severity', severity);
    }
    if (action) q = q.ilike('action', `${action}%`);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ entries: data ?? [] });
  });

  // GET /webhooks — last webhook deliveries (Meta, etc)
  router.get('/webhooks', async (req, res) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('webhook_events')
      .select('id, source, event_type, signature_valid, received_at, processed_at, error')
      .eq('campaign_id', campaignId)
      .order('received_at', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ events: data ?? [] });
  });

  return router;
}
