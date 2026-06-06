-- =============================================
-- PARTE 27: Métricas financeiras do Supreme Admin (F3)
--
-- Agrega o estado financeiro do SaaS numa chamada: MRR/ARR (assinaturas
-- ativas pagas), assinaturas por status, distribuição por plano, lista de
-- inadimplentes (past_due), receita confirmada (payment_events) e custo de
-- IA (agent_runs) para cruzar com a receita.
--
-- A suspensão automática por inadimplência já é feita pelo
-- subscriptionLifecycle (runLifecycleSweep, agendado a cada 6h em server.ts).
-- Esta função apenas EXPÕE os números no painel; o endpoint
-- POST /api/v1/supreme/financial/run-lifecycle permite forçar o sweep.
--
-- Execute no SQL Editor do Supabase. Idempotente.
-- =============================================

CREATE OR REPLACE FUNCTION supreme_financial_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'generatedAt', now(),
    'mrrCents', (
      SELECT coalesce(sum(p."monthlyCents"), 0)
      FROM subscriptions s JOIN plans p ON p.id = s."planId"
      WHERE s.status = 'active' AND p."monthlyCents" > 0
    ),
    'arrCents', (
      SELECT coalesce(sum(p."monthlyCents"), 0) * 12
      FROM subscriptions s JOIN plans p ON p.id = s."planId"
      WHERE s.status = 'active' AND p."monthlyCents" > 0
    ),
    'subscriptions', (
      SELECT jsonb_build_object(
        'total', count(*),
        'active', count(*) FILTER (WHERE status = 'active'),
        'pastDue', count(*) FILTER (WHERE status = 'past_due'),
        'canceled', count(*) FILTER (WHERE status = 'canceled'),
        'trialing', count(*) FILTER (WHERE status = 'trialing'),
        'payingActive', (
          SELECT count(*) FROM subscriptions s2 JOIN plans p2 ON p2.id = s2."planId"
          WHERE s2.status = 'active' AND p2."monthlyCents" > 0
        )
      ) FROM subscriptions
    ),
    'byPlan', (
      SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x."monthlyCents" DESC), '[]'::jsonb)
      FROM (
        SELECT p.id, p.name, p."monthlyCents", p.active,
               count(s.id) FILTER (WHERE s.status = 'active') AS active_subs,
               count(s.id) AS total_subs
        FROM plans p LEFT JOIN subscriptions s ON s."planId" = p.id
        GROUP BY p.id, p.name, p."monthlyCents", p.active
      ) x
    ),
    'inadimplentes', (
      SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      FROM (
        SELECT s.id AS subscription_id, s."campaignId" AS campaign_id,
               (SELECT name FROM users u WHERE u."campaignId"::text = s."campaignId"::text AND u.type='Admin' ORDER BY u."createdAt" LIMIT 1) AS campaign_name,
               p.name AS plan_name, p."monthlyCents", s."updatedAt"
        FROM subscriptions s JOIN plans p ON p.id = s."planId"
        WHERE s.status = 'past_due'
        ORDER BY s."updatedAt"
      ) x
    ),
    'revenue', (
      SELECT jsonb_build_object(
        'confirmedTotalCents', coalesce(sum("amountCents") FILTER (WHERE status IN ('confirmed','received','paid')), 0),
        'last30dCents', coalesce(sum("amountCents") FILTER (WHERE status IN ('confirmed','received','paid') AND "receivedAt" > now() - interval '30 days'), 0),
        'events', count(*)
      ) FROM payment_events
    ),
    'aiCostUsd', (
      SELECT coalesce(round(sum("costCentsUsd")/100.0, 2), 0) FROM agent_runs
    )
  ) INTO result;
  RETURN coalesce(result, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION supreme_financial_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supreme_financial_metrics() TO service_role;
