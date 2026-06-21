import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Gate por MÓDULO (add-on avulso). Diferente do requireFeature (que lê
 * plans.features), este checa o entitlement em tenant_module_entitlements — a
 * fonte onde a compra avulsa concede acesso (webhook Asaas / grant supremo).
 *
 * Passa quando: supremo admin, OU existe entitlement ativo do módulo para a
 * campanha do usuário. Fail-closed por padrão (flip via BILLING_FAIL_OPEN).
 */
export function requireModule(supabase: SupabaseClient, moduleKey: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const u = (req as any).user;
    if (u?.isSupremeAdmin) return next();
    const campaignId = u?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const { data } = await supabase
        .from('tenant_module_entitlements')
        .select('"moduleKey"')
        .eq('tenantId', campaignId)
        .eq('moduleKey', moduleKey)
        .eq('status', 'active')
        .maybeSingle();
      if (data) return next();
      return res.status(402).json({ error: 'module_not_active', module: moduleKey, upgradeRequired: true });
    } catch (err: any) {
      if (process.env.BILLING_FAIL_OPEN === 'true') return next();
      console.error('[requireModule] check failed:', err?.message);
      return res.status(500).json({ error: 'module_check_failed' });
    }
  };
}
