-- =============================================
-- PARTE 25: Métricas da plataforma para o Supreme Admin (F1)
--
-- Função única que agrega TODAS as métricas do dashboard do operador
-- numa só chamada (uma viagem ao banco): campanhas, usuários
-- (total/ativos/bloqueados), usuários por tipo e por campanha, tamanho do
-- banco + top tabelas, crescimento de usuários e campanhas, consumo de
-- tokens de IA e horários de pico.
--
-- SECURITY DEFINER para poder ler auth.users e o catálogo do Postgres.
-- Chamada apenas pelo backend (service_role) via rota /api/v1/supreme/metrics,
-- que por sua vez é protegida por requireSupremeAdmin().
--
-- Execute no SQL Editor do Supabase. Idempotente (CREATE OR REPLACE).
-- =============================================

CREATE OR REPLACE FUNCTION supreme_platform_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'generatedAt', now(),

    'campaigns', (
      SELECT jsonb_build_object(
        'total', count(*),
        'active', count(*) FILTER (WHERE status = 'active'),
        'blocked', count(*) FILTER (WHERE status <> 'active')
      )
      FROM campaign_configs
    ),

    'users', (
      SELECT jsonb_build_object(
        'total', count(*),
        'active30d', count(*) FILTER (WHERE au.last_sign_in_at > now() - interval '30 days'),
        'active7d',  count(*) FILTER (WHERE au.last_sign_in_at > now() - interval '7 days'),
        'neverLoggedIn', count(*) FILTER (WHERE au.last_sign_in_at IS NULL),
        'blocked', count(*) FILTER (WHERE pu.role = 'blocked')
      )
      FROM public.users pu
      LEFT JOIN auth.users au ON au.id = pu.id
    ),

    'usersByType', (
      SELECT coalesce(jsonb_object_agg(coalesce(type,'sem_tipo'), cnt), '{}'::jsonb)
      FROM (SELECT type, count(*) cnt FROM public.users GROUP BY type) t
    ),

    'usersByCampaign', (
      SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.total DESC), '[]'::jsonb)
      FROM (
        SELECT
          pu."campaignId"::text AS campaign_id,
          (SELECT name FROM public.users a
             WHERE a."campaignId" = pu."campaignId" AND a.type = 'Admin'
             ORDER BY a."createdAt" LIMIT 1) AS campaign_name,
          count(*) AS total,
          jsonb_object_agg(coalesce(pu.type,'sem_tipo'), pu.cnt) AS by_type
        FROM (
          SELECT "campaignId", type, count(*) cnt
          FROM public.users
          WHERE "campaignId" IS NOT NULL
          GROUP BY "campaignId", type
        ) pu
        GROUP BY pu."campaignId"
      ) x
    ),

    'database', (
      SELECT jsonb_build_object(
        'sizeBytes', pg_database_size(current_database()),
        'sizePretty', pg_size_pretty(pg_database_size(current_database()))
      )
    ),

    'topTables', (
      SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT c.relname AS table_name,
               pg_total_relation_size(c.oid) AS bytes,
               pg_size_pretty(pg_total_relation_size(c.oid)) AS pretty,
               c.reltuples::bigint AS approx_rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT 12
      ) t
    ),

    'userGrowth', (
      SELECT coalesce(jsonb_agg(row_to_json(g) ORDER BY g.day), '[]'::jsonb)
      FROM (
        SELECT date_trunc('day', created_at)::date AS day, count(*) AS novos
        FROM auth.users
        WHERE created_at > now() - interval '30 days'
        GROUP BY 1
      ) g
    ),

    'campaignGrowth', (
      SELECT coalesce(jsonb_agg(row_to_json(g) ORDER BY g.month), '[]'::jsonb)
      FROM (
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month, count(*) AS novas
        FROM campaign_configs
        WHERE "createdAt" IS NOT NULL
        GROUP BY 1
      ) g
    ),

    'tokens', (
      SELECT jsonb_build_object(
        'totalTokens', coalesce(sum("totalTokens"), 0),
        'totalCost', coalesce(round(sum("estimatedCost")::numeric, 4), 0),
        'last30dTokens', coalesce(sum("totalTokens") FILTER (WHERE timestamp > now() - interval '30 days'), 0),
        'byCampaign', (
          SELECT coalesce(jsonb_agg(row_to_json(c) ORDER BY c.tokens DESC), '[]'::jsonb)
          FROM (
            SELECT "campaignId" AS campaign_id,
                   sum("totalTokens") AS tokens,
                   round(sum("estimatedCost")::numeric, 4) AS cost
            FROM ai_usage GROUP BY "campaignId" LIMIT 20
          ) c
        ),
        'byModel', (
          SELECT coalesce(jsonb_agg(row_to_json(m) ORDER BY m.tokens DESC), '[]'::jsonb)
          FROM (
            SELECT model, sum("totalTokens") AS tokens, count(*) AS calls
            FROM ai_usage GROUP BY model LIMIT 20
          ) m
        )
      )
      FROM ai_usage
    ),

    'peakHours', (
      SELECT coalesce(jsonb_agg(row_to_json(h) ORDER BY h.hour), '[]'::jsonb)
      FROM (
        SELECT extract(hour FROM timestamp AT TIME ZONE 'America/Sao_Paulo')::int AS hour,
               count(*) AS atividades
        FROM ai_usage
        WHERE timestamp > now() - interval '30 days'
        GROUP BY 1
      ) h
    )
  ) INTO result;

  RETURN coalesce(result, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION supreme_platform_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supreme_platform_metrics() TO service_role;
