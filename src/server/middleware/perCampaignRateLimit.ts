import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';

/**
 * Builds an express-rate-limit middleware keyed by (campaignId + IP).
 * Falls back to IP-only when campaign is not yet resolved (e.g. anonymous).
 *
 * Use the right preset for the route's risk profile:
 *   - `expensive`  — Monte Carlo / RAG / AI calls (5 req/min per campaign)
 *   - `messaging`  — outbound channel sends    (30 req/min per campaign)
 *   - `mutation`   — generic write endpoints   (60 req/min per campaign)
 *   - `webhook`    — public webhook receivers  (300 req/min per IP)
 */
export function buildRateLimiter(
  windowMs: number,
  max: number,
  scope: 'campaign' | 'ip',
): RequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const ip = ipKeyGenerator(req.ip ?? '');
      if (scope === 'ip') return ip;
      const campaignId = (req as any).user?.campaignId;
      return campaignId ? `c:${campaignId}` : `ip:${ip}`;
    },
    message: { error: 'rate_limit_exceeded' },
  });
}

// In development, multiply caps 20x so navigation + hot-reload doesn't trip
// limits intended for production traffic.
const DEV_MULTIPLIER = process.env.NODE_ENV === 'production' ? 1 : 20;

export const expensiveLimiter = buildRateLimiter(60_000, 5 * DEV_MULTIPLIER, 'campaign');
export const messagingLimiter = buildRateLimiter(60_000, 30 * DEV_MULTIPLIER, 'campaign');
export const mutationLimiter = buildRateLimiter(60_000, 60 * DEV_MULTIPLIER, 'campaign');
export const webhookLimiter = buildRateLimiter(60_000, 300, 'ip');
