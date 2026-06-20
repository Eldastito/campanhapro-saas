/**
 * Modules Router (Control Plane) — fonte AUTORITATIVA de quais módulos o usuário
 * autenticado pode acessar. Decide pelo token (req.user), nunca por dado do cliente.
 *
 * Fatia 2: além da derivação por tipo/campanha (piso de segurança — ninguém perde
 * acesso), SOMA os entitlements concedidos ao tenant em tenant_module_entitlements.
 * Fatia 4: os tenants do usuário passam a vir das memberships explícitas
 * (tenant_memberships), ainda unidos à derivação atual (shadow). Base do multi-org.
 *
 * GET /api/v1/modules/me → { active, available, catalog, tenants }
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

    // Tenants do usuário: memberships explícitas (Fatia 4) ∪ vínculo implícito atual.
    const tenantMap = new Map<string, { id: string; kind: string; role: string }>();
    try {
      const { data: memberships } = await supabase
        .from('tenant_memberships')
        .select('"tenantId","tenantKind",role')
        .eq('userId', u.id)
        .eq('status', 'active');
      for (const m of (memberships ?? [])) {
        tenantMap.set(m.tenantId, { id: m.tenantId, kind: m.tenantKind, role: m.role });
      }
    } catch { /* tabela indisponível → segue só com a derivação */ }

    // Rede de segurança: vínculo implícito caso o backfill tenha perdido alguém.
    if (u.campaignId && !tenantMap.has(String(u.campaignId))) {
      tenantMap.set(String(u.campaignId), { id: String(u.campaignId), kind: 'campaign', role: u.userType || 'member' });
    }
    if (u.userType === 'Presidente de Partido') {
      try {
        const { data: party } = await supabase.from('parties').select('id').eq('presidentId', u.id).maybeSingle();
        if (party?.id && !tenantMap.has(String(party.id))) {
          tenantMap.set(String(party.id), { id: String(party.id), kind: 'party', role: 'owner' });
        }
      } catch { /* segue só com a derivação */ }
    }

    const tenantIds = [...tenantMap.keys()];
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

    return res.json({ active, available, catalog: MODULES, tenants: [...tenantMap.values()] });
  });

  return router;
}
