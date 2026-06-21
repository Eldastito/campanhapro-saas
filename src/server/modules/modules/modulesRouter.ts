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
import { MODULES, deriveUserModules, PLAN_FEATURE_TO_MODULE } from '../../../lib/modules';

export function createModulesRouter(supabase: SupabaseClient): Router {
  const router = Router();

  router.get('/me', async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!u?.id) return res.status(401).json({ error: 'unauthorized' });

    // Fatia 6: switcher de organização no Hub. Quando o front passa ?tenantId=X,
    // filtramos os entitlements somente daquele tenant — base do multi-org.
    // Sem o filtro, mantém comportamento da Fatia 2 (união de tudo).
    const requestedTenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : null;

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

    // Se o front pediu uma org específica, filtra os entitlements só daquela.
    // Validação de pertencimento: se o tenantId pedido não está nas memberships
    // do usuário, ignoramos (não vaza dado, e evita erro UX se a key do
    // localStorage estiver desatualizada).
    const tenantIds = requestedTenantId && tenantMap.has(requestedTenantId)
      ? [requestedTenantId]
      : [...tenantMap.keys()];

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

    // Add-ons embutidos no plano: se a assinatura ativa do tenant inclui uma
    // feature mapeada (ex.: `scenarios` no Total), o módulo correspondente
    // (`cenarios`) entra em `active` sem precisar de entitlement explícito.
    // Garante que quem já PAGA pelo plano não veja o módulo como "à venda".
    const campaignTenantIds = [...tenantMap.values()]
      .filter((t) => t.kind === 'campaign' && (!requestedTenantId || t.id === requestedTenantId))
      .map((t) => t.id);
    const planGranted: string[] = [];
    if (campaignTenantIds.length) {
      try {
        const { data: subs } = await supabase
          .from('subscriptions')
          .select('"planId"')
          .in('campaignId', campaignTenantIds)
          .in('status', ['active', 'trialing', 'past_due']);
        const planIds = [...new Set((subs ?? []).map((s: any) => s.planId).filter(Boolean))];
        if (planIds.length) {
          const { data: plans } = await supabase
            .from('plans')
            .select('id, features')
            .in('id', planIds);
          for (const p of (plans ?? [])) {
            for (const f of (p.features ?? [])) {
              const moduleKey = PLAN_FEATURE_TO_MODULE[f];
              if (moduleKey) planGranted.push(moduleKey);
            }
          }
        }
      } catch { /* tabelas indisponíveis → fica só a derivação + granted */ }
    }

    const active = [...new Set([...derived, ...granted, ...planGranted])];
    const available = MODULES.filter((m) => m.sellable && !active.includes(m.key)).map((m) => m.key);

    // Preço de venda avulsa (add-on) só pros módulos em `available`. O Hub usa
    // esse mapa no card de cross-sell. Não vaza preço dos que já estão ativos.
    const pricing: Record<string, { monthlyCents: number }> = {};
    if (available.length) {
      try {
        const { data } = await supabase
          .from('module_prices')
          .select('"moduleKey","monthlyCents"')
          .in('moduleKey', available)
          .eq('active', true);
        for (const r of (data ?? [])) pricing[r.moduleKey] = { monthlyCents: r.monthlyCents };
      } catch { /* tabela indisponível → Hub mostra card sem preço */ }
    }

    // Enriquece tenants com nome legível (campanhas/partidos) pro switcher do Hub.
    // Lookup em batch — não falha o endpoint se uma das tabelas estiver indisponível.
    const tenantsArr = [...tenantMap.values()];
    const campIds = tenantsArr.filter((t) => t.kind === 'campaign').map((t) => t.id);
    const partyIds = tenantsArr.filter((t) => t.kind === 'party').map((t) => t.id);
    const nameById = new Map<string, string>();
    if (campIds.length) {
      try {
        const { data } = await supabase.from('campaigns').select('id, name').in('id', campIds);
        for (const r of (data ?? [])) nameById.set(String(r.id), r.name);
      } catch { /* ignora */ }
    }
    if (partyIds.length) {
      try {
        const { data } = await supabase.from('parties').select('id, name').in('id', partyIds);
        for (const r of (data ?? [])) nameById.set(String(r.id), r.name);
      } catch { /* ignora */ }
    }
    const tenantsEnriched = tenantsArr.map((t) => ({ ...t, name: nameById.get(t.id) ?? null }));

    return res.json({
      active, available, catalog: MODULES, pricing,
      tenants: tenantsEnriched,
      activeTenantId: requestedTenantId && tenantMap.has(requestedTenantId) ? requestedTenantId : null,
    });
  });

  return router;
}

// Handler público (sem auth) usado pelas páginas comerciais /produtos/:slug pra
// mostrar preço sem login. Montado direto no server.ts antes do requireAuth.
export function createModulePricingHandler(supabase: SupabaseClient) {
  return async (_req: Request, res: Response) => {
    try {
      const { data } = await supabase
        .from('module_prices')
        .select('"moduleKey","monthlyCents"')
        .eq('active', true);
      const out: Record<string, { monthlyCents: number }> = {};
      for (const r of (data ?? [])) out[r.moduleKey] = { monthlyCents: r.monthlyCents };
      return res.json(out);
    } catch {
      return res.json({});
    }
  };
}
