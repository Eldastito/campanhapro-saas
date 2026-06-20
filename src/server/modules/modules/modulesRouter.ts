/**
 * Modules Router (Fatia 1 do Control Plane) — fonte AUTORITATIVA de quais módulos
 * o usuário autenticado pode acessar. O frontend (Hub) só consome; quem decide é
 * aqui, a partir do token (req.user), nunca de dado vindo do cliente.
 *
 * GET /api/v1/modules/me → { active: string[], available: string[], catalog: ModuleDef[] }
 *   active    = módulos que o usuário tem hoje (derivados do tipo/campanha)
 *   available = módulos vendáveis que ele NÃO tem (cross-sell)
 *   catalog   = catálogo completo (nome/descrição/ícone/rotas) pra UI montar os cards
 */
import { Router, Request, Response } from 'express';
import { MODULES, deriveUserModules } from '../../../lib/modules';

export function createModulesRouter(): Router {
  const router = Router();

  router.get('/me', (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!u?.id) return res.status(401).json({ error: 'unauthorized' });

    const active = deriveUserModules({
      userType: u.userType,
      campaignId: u.campaignId,
      isSupremeAdmin: u.isSupremeAdmin,
    });
    const available = MODULES.filter((m) => m.sellable && !active.includes(m.key)).map((m) => m.key);

    return res.json({ active, available, catalog: MODULES });
  });

  return router;
}
