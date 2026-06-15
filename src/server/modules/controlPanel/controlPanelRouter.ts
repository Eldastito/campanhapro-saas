/**
 * Control Panel (#137).
 *
 *   GET  /api/v1/control-panel/status      → estado atual da pause + backups
 *   POST /api/v1/control-panel/pause       → liga/desliga modo pausado
 *   POST /api/v1/control-panel/backup-now  → cria snapshot agora (manual)
 *
 * Workers e fluxos respeitam aiGloballyPausedAt: enquanto setado, nada de
 * IA dispara (Monitor, Briefing, Secretary, Aurora WhatsApp).
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSnapshot } from './backupService';

export function createControlPanelRouter(supabase: SupabaseClient): Router {
  const router = Router();

  function isAdmin(req: Request): boolean {
    const t = (req as any).user?.userType;
    return t === 'Admin' || t === 'Coordenador' || t === 'Candidato' || (req as any).user?.isSupremeAdmin === true;
  }

  // ── GET /status ──────────────────────────────────────────────────────
  router.get('/status', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

      const { data: camp } = await supabase
        .from('campaigns')
        .select('"aiGloballyPausedAt", "aiGloballyPausedBy", "aiGloballyPausedReason"')
        .eq('id', campaignId)
        .maybeSingle();

      const { data: backups } = await supabase
        .from('daily_backups')
        .select('id, "snapshotDate", "sizeBytes", counts, "createdAt"')
        .eq('campaignId', campaignId)
        .order('snapshotDate', { ascending: false })
        .limit(30);

      return res.json({
        paused: !!(camp as any)?.aiGloballyPausedAt,
        pausedAt: (camp as any)?.aiGloballyPausedAt || null,
        pausedBy: (camp as any)?.aiGloballyPausedBy || null,
        pausedReason: (camp as any)?.aiGloballyPausedReason || null,
        backups: backups || [],
      });
    } catch (err: any) {
      console.error('[control-panel] status:', err);
      return res.status(500).json({ error: err?.message });
    }
  });

  // ── POST /pause ──────────────────────────────────────────────────────
  router.post('/pause', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      const userId = (req as any).user?.id;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
      if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

      const paused = !!(req.body || {}).paused;
      const reason = ((req.body || {}).reason || '').toString().slice(0, 300) || null;

      const update = paused
        ? {
            aiGloballyPausedAt: new Date().toISOString(),
            aiGloballyPausedBy: userId || null,
            aiGloballyPausedReason: reason,
          }
        : {
            aiGloballyPausedAt: null,
            aiGloballyPausedBy: null,
            aiGloballyPausedReason: null,
          };

      const { error } = await supabase.from('campaigns').update(update).eq('id', campaignId);
      if (error) return res.status(500).json({ error: error.message });

      return res.json({ ok: true, paused });
    } catch (err: any) {
      console.error('[control-panel] pause:', err);
      return res.status(500).json({ error: err?.message });
    }
  });

  // ── POST /backup-now ─────────────────────────────────────────────────
  router.post('/backup-now', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
      if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

      const snap = await createSnapshot(supabase, campaignId);
      return res.json({ ok: true, snapshot: snap });
    } catch (err: any) {
      console.error('[control-panel] backup-now:', err);
      return res.status(500).json({ error: err?.message });
    }
  });

  return router;
}
