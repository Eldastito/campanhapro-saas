import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Middleware that requires the caller to be a Supreme Admin (SaaS operator).
 * Used for endpoints that touch the global catalogue — plans, courtesy access,
 * tenant suspensions. Returns 403 for everyone else, including campaign-level
 * Admins.
 *
 * Relies on authMiddleware having already populated req.user.isSupremeAdmin.
 */
export function requireSupremeAdmin(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user?.id) return res.status(401).json({ error: 'Unauthorized' });

    // Allow either flag-based or email-based supreme admin (matches AuthContext logic).
    const supreme = process.env.SUPREME_ADMIN_EMAIL;
    const isByEmail = !!supreme && user.email === supreme;
    const isByFlag = !!user.isSupremeAdmin;

    if (!isByEmail && !isByFlag) {
      return res.status(403).json({ error: 'supreme_admin_required' });
    }
    next();
  };
}
