import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Middleware that requires the caller to be a Supreme Admin (SaaS operator).
 * Used for endpoints that touch the global catalogue — plans, courtesy access,
 * tenant suspensions. Returns 403 for everyone else, including campaign-level
 * Admins.
 *
 * Relies on authMiddleware having already populated req.user.isSupremeAdmin
 * (lido de users.isSupremeAdmin). Governança: supreme admin é decidido SÓ pela
 * flag no banco — sem override por e-mail/env.
 */
export function requireSupremeAdmin(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user?.id) return res.status(401).json({ error: 'Unauthorized' });

    if (!user.isSupremeAdmin) {
      return res.status(403).json({ error: 'supreme_admin_required' });
    }
    next();
  };
}
