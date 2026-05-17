import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { buildCampaignSnapshot } from '../../../services/snapshotBuilder';
import {
  ingestSnapshot,
  getLatestFactors,
  getScenarios,
} from '../integrations/campanhaproCenariosClient';

export function createIntelligenceRouter(supabaseAdmin: SupabaseClient) {
  const router = Router();

  /**
   * POST /api/v1/intelligence/sync
   * Builds a campaign snapshot, ships it to CampanhaProCenarios,
   * and persists a sync log entry.
   */
  router.post('/sync', async (req: Request, res: Response) => {
    try {
      const campaignId: string | undefined =
        (req as any).user?.campaignId ?? req.body?.campaignId;

      if (!campaignId) {
        return res.status(400).json({ error: 'campaignId obrigatório' });
      }

      const snapshot = await buildCampaignSnapshot(supabaseAdmin, campaignId);
      await ingestSnapshot(snapshot);

      await supabaseAdmin.from('campaign_sync_logs').upsert(
        {
          campaignId,
          lastSyncAt: snapshot.generatedAt,
          snapshotVersion: snapshot.schemaVersion,
          visitCount: (snapshot.visits as unknown[]).length,
          pesquisaCount: (snapshot.pesquisas as unknown[]).length,
        },
        { onConflict: 'campaignId' }
      );

      return res.json({
        ok: true,
        campaignId,
        syncedAt: snapshot.generatedAt,
        counts: {
          visits: (snapshot.visits as unknown[]).length,
          teamMembers: (snapshot.teamMembers as unknown[]).length,
          pesquisas: (snapshot.pesquisas as unknown[]).length,
          engagements: (snapshot.engagements as unknown[]).length,
        },
      });
    } catch (err: any) {
      console.error('[Intelligence Sync]', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/v1/intelligence/factors
   * Returns the latest scored factors from CampanhaProCenarios.
   */
  router.get('/factors', async (req: Request, res: Response) => {
    try {
      const campaignId: string | undefined =
        (req as any).user?.campaignId ?? (req.query.campaignId as string);

      if (!campaignId) {
        return res.status(400).json({ error: 'campaignId obrigatório' });
      }

      const factors = await getLatestFactors(campaignId);

      // Also fetch last sync time from the log
      const { data: logRow } = await supabaseAdmin
        .from('campaign_sync_logs')
        .select('lastSyncAt, visitCount, pesquisaCount')
        .eq('campaignId', campaignId)
        .maybeSingle();

      return res.json({ factors, lastSync: logRow ?? null });
    } catch (err: any) {
      console.error('[Intelligence Factors]', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/v1/intelligence/scenarios
   * Returns scenario projections from CampanhaProCenarios.
   */
  router.get('/scenarios', async (req: Request, res: Response) => {
    try {
      const campaignId: string | undefined =
        (req as any).user?.campaignId ?? (req.query.campaignId as string);

      if (!campaignId) {
        return res.status(400).json({ error: 'campaignId obrigatório' });
      }

      const scenarios = await getScenarios(campaignId);
      return res.json({ scenarios });
    } catch (err: any) {
      console.error('[Intelligence Scenarios]', err);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
