/**
 * SocialSignalsRouter — endpoints HTTP para o feed de sinais (§48-§49
 * + §53-§59 Pulso Digital + §58 drill-down).
 *
 * Endpoints:
 *   GET  /signals            — lista signals da campanha, com filtros
 *   POST /signals/compute    — roda o pipeline sob demanda (Admin-only)
 *
 * REGRA §35 — isolamento por campanha em tripla camada:
 *   1. Handler filtra por `req.user.campaignId`
 *   2. querySignals do socialSignalStore reforça no service
 *   3. RLS na tabela `social_signals` reforça no banco
 *
 * Router SEPARADO do socialRouter grande — evita puxar a cadeia pesada
 * (managerAgent → agentReadTools → services → supabaseClient.ts) que
 * requer env vars pra bootar; permite testar em isolamento sem env.
 */

import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

import { querySignals } from './socialSignalStore.js';
import { computeCampaignSocialSignals } from './socialSignalsRunner.js';
import type {
  SocialSignalSeverity,
  SocialSignalSource,
} from './intelligence/socialSignalBus.js';
import { SIGNAL_SEVERITY_ORDER } from './intelligence/socialSignalBus.js';
import { isSocialProvider, type SocialProvider } from './contracts/socialProvider.js';
import { SOCIAL_TOPICS, type SocialTopic } from './intelligence/topicClassifier.js';

// ── Helpers ─────────────────────────────────────────────────────────

function isAdmin(req: Request): boolean {
  const t = (req as unknown as { user?: { type?: string } }).user?.type;
  return t === 'Admin' || t === 'Coordenador';
}

const VALID_SOURCES: ReadonlySet<SocialSignalSource> = new Set<SocialSignalSource>([
  'trend', 'anomaly', 'cross_network_trend', 'cross_network_anomaly',
]);

// ── Router ──────────────────────────────────────────────────────────

export function createSocialSignalsRouter(supabase: SupabaseClient): Router {
  const router = Router();

  router.get('/signals', async (req: Request, res: Response) => {
    const campaignId = (req as unknown as { user?: { campaignId?: string } }).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

    // ── validação de query params (whitelist estrita) ────────────────
    let minSeverity: SocialSignalSeverity | undefined;
    if (typeof req.query.minSeverity === 'string' && req.query.minSeverity) {
      const raw = req.query.minSeverity;
      if (!(raw in SIGNAL_SEVERITY_ORDER)) {
        return res.status(400).json({ error: 'invalid_minSeverity' });
      }
      minSeverity = raw as SocialSignalSeverity;
    }

    let source: SocialSignalSource | undefined;
    if (typeof req.query.source === 'string' && req.query.source) {
      if (!VALID_SOURCES.has(req.query.source as SocialSignalSource)) {
        return res.status(400).json({ error: 'invalid_source' });
      }
      source = req.query.source as SocialSignalSource;
    }

    let topic: SocialTopic | undefined;
    if (typeof req.query.topic === 'string' && req.query.topic) {
      if (!(SOCIAL_TOPICS as readonly string[]).includes(req.query.topic)) {
        return res.status(400).json({ error: 'invalid_topic' });
      }
      topic = req.query.topic as SocialTopic;
    }

    let provider: SocialProvider | undefined;
    if (typeof req.query.provider === 'string' && req.query.provider) {
      if (!isSocialProvider(req.query.provider)) {
        return res.status(400).json({ error: 'invalid_provider' });
      }
      provider = req.query.provider;
    }

    let since: Date | undefined;
    if (typeof req.query.since === 'string' && req.query.since) {
      const d = new Date(req.query.since);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'invalid_since' });
      since = d;
    }

    let limit: number | undefined;
    if (typeof req.query.limit === 'string' && req.query.limit) {
      const n = Number(req.query.limit);
      if (!Number.isInteger(n) || n < 1 || n > 500) {
        return res.status(400).json({ error: 'invalid_limit' });
      }
      limit = n;
    }

    try {
      const signals = await querySignals(supabase, campaignId, {
        minSeverity, source, topic, provider, since, limit,
      });
      return res.json({ signals });
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: 'query_failed', detail });
    }
  });

  // POST /signals/compute — sob demanda; caro (varre stored posts/comments).
  // Admin-only pra evitar spam.
  router.post('/signals/compute', async (req: Request, res: Response) => {
    const campaignId = (req as unknown as { user?: { campaignId?: string } }).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'unauthorized' });
    if (!isAdmin(req)) return res.status(403).json({ error: 'admin_required' });

    try {
      const result = await computeCampaignSocialSignals(supabase, campaignId, {
        persist: true,
      });
      return res.json({
        signalsCount: result.signals.length,
        persist: result.persist ?? null,
        pipelineVersion: result.pipelineVersion,
      });
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: 'compute_failed', detail });
    }
  });

  return router;
}
