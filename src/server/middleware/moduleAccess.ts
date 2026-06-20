/**
 * moduleAccessAudit (Control Plane — Etapa A do enforcement, SHADOW).
 *
 * Registra (NÃO bloqueia) quando um usuário chama uma rota que pertence a um
 * módulo que ele não possui. É o degrau seguro antes do enforcement real (403):
 * roda em produção, gera trilha em audit_logs, e nos deixa ver o que QUEBRARIA
 * antes de ligar a fechadura. Por construção, jamais retorna erro — sempre next().
 *
 * Bypass: supremo nunca é auditado/bloqueado. Posse do módulo = derivação
 * (barata, sem DB) ∪ entitlements concedidos (DB só no caminho anômalo).
 */
import { Request, Response, NextFunction } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deriveUserModules } from '../../lib/modules';
import { audit, actorFromRequest } from '../modules/observability/auditLogger';

export function moduleAccessAudit(supabase: SupabaseClient, moduleKey: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const u = (req as any).user;
      if (!u?.id || u.isSupremeAdmin) return next(); // supremo passa sempre

      // Piso barato: posse derivada do tipo/campanha (sem hit no banco).
      const derived = deriveUserModules({
        userType: u.userType, campaignId: u.campaignId, isSupremeAdmin: u.isSupremeAdmin,
      });
      if (derived.includes(moduleKey)) return next();

      // Não tem via derivação → confere entitlements concedidos antes de logar.
      let granted = false;
      try {
        const { data: memberships } = await supabase
          .from('tenant_memberships').select('"tenantId"').eq('userId', u.id).eq('status', 'active');
        const tenantIds = (memberships ?? []).map((m: any) => m.tenantId);
        if (u.campaignId && !tenantIds.includes(String(u.campaignId))) tenantIds.push(String(u.campaignId));
        if (tenantIds.length) {
          const { data: ent } = await supabase
            .from('tenant_module_entitlements').select('"moduleKey"')
            .in('tenantId', tenantIds).eq('moduleKey', moduleKey).eq('status', 'active').limit(1);
          granted = !!(ent && ent.length);
        }
      } catch { /* shadow-safe: na dúvida só loga, nunca bloqueia */ }

      if (!granted) {
        await audit(supabase, {
          ...actorFromRequest(req),
          action: 'module.access.shadow_denied',
          severity: 'warn',
          resourceType: 'module',
          resourceId: moduleKey,
          metadata: { method: req.method, path: (req.originalUrl || '').split('?')[0], userType: u.userType ?? null },
        }).catch(() => {});
      }
    } catch { /* nunca quebra a request */ }
    return next(); // ETAPA A: jamais bloqueia
  };
}
