import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Express middleware that:
 *   1. Assigns a stable trace_id per request (or honours an upstream X-Trace-Id).
 *   2. Logs structured one-line JSON for every request with timing + status.
 *
 * Never log request bodies — they may contain PII and Meta webhook content.
 */
export function requestTracer() {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.get('x-trace-id');
    const traceId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomBytes(8).toString('hex');
    (req as any).traceId = traceId;
    res.setHeader('X-Trace-Id', traceId);

    const started = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - started;
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        traceId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
        actorId: (req as any).user?.id ?? null,
        campaignId: (req as any).user?.campaignId ?? null,
      });
      // Single line per request — easy to grep/forward to Loki/Datadog
      if (res.statusCode >= 500) console.error('[req]', line);
      else if (res.statusCode >= 400) console.warn('[req]', line);
      else console.log('[req]', line);
    });

    next();
  };
}
