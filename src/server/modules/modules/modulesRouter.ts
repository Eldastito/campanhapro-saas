/**
 * Modules Router (Control Plane) — fonte AUTORITATIVA de quais módulos o usuário
 * autenticado pode acessar. Decide pelo token (req.user), nunca por dado do cliente.
 *
 * Fatia 2: além da derivação por tipo/campanha (piso de segurança — ninguém perde
 * acesso), SOMA os entitlements concedidos ao tenant em tenant_module_entitlements.
 * Isso permite CONCEDER módulos extras a uma organização (venda modular/cross-sell)
 * sem mexer no tipo do usuário.
 *
 * GET /api/v1/modules/me → { active, available, catalog }
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MODULES, deriveUserModules } from '../../../lib/modules';

export function createModulesRouter(supabase: SupabaseClient): Router {
  const router = Router();

  router.get('/me', async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!u?.id) return res.status(401).json({ error: 'unauthorized' });

    // Piso: derivação do estado atual (tipo/campanha). Garante que nada regrida.
    const derived = deriveUserModules({
      userType: u.userType,
      campaignId: u.campaignId,
      isSupremeAdmin: u.isSupremeAdmin,
    });

    // Tenants do usuário: a campanha dele e (se for presidente) o partido.
    const tenantIds: string[] = [];
    if (u.campaignId) tenantIds.push(String(u.campaignId));
    if (u.userType === 'Presidente de Partido') {
      try {
        const { data: party } = await supabase.from('parties').select('id').eq('presidentId', u.id).maybeSingle();
        if (party?.id) tenantIds.push(String(party.id));
      } catch { /* segue só com a derivação */ }
    }

    let granted: string[] = [];
    if (tenantIds.length) {
      try {
        const { data } = await supabase
          .from('tenant_module_entitlements')
          .select('"moduleKey"')
          .in('tenantId', tenantIds)
          .eq('status', 'active');
        granted = (data ?? []).map((r: any) => r.moduleKey);
      } catch { /* tabela indisponível → fica só a derivação (shadow-safe) */ }
    }

    const active = [...new Set([...derived, ...granted])];
    const available = MODULES.filter((m) => m.sellable && !active.includes(m.key)).map((m) => m.key);

    return res.json({ active, available, catalog: MODULES });
  });

  return router;
}
