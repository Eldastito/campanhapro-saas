-- =============================================
-- PARTE 28: Auditoria & Logs de Acesso do Supreme Admin (F2)
--
-- (1) supreme_audit_logs() — feed de auditoria enriquecido (resolve actorId
--     para nome/email do usuário), com filtro por ação e severidade.
-- (2) supreme_access_log() — visão por usuário: último login (auth.users),
--     data de cadastro, contagem e data da última ação.
--
-- Eventos de login/logout são gravados em audit_logs pelo endpoint
-- POST /api/v1/access-event (chamado pelo AuthContext). As demais ações já
-- são auditadas por audit() em toda a plataforma.
--
-- Execute no SQL Editor do Supabase. Idempotente.
-- =============================================

CREATE OR REPLACE FUNCTION supreme_audit_logs(
  p_limit int DEFAULT 100,
  p_action text DEFAULT NULL,
  p_severity text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
  SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
  FROM (
    SELECT al.id, al."createdAt", al.action, al.severity, al."actorType",
           al."campaignId", al."resourceType", al."resourceId", al."ipAddress",
           al.metadata,
           u.name AS actor_name, u.email AS actor_email, u.type AS actor_type_role
    FROM audit_logs al
    LEFT JOIN public.users u ON u.id = al."actorId"
    WHERE (p_action IS NULL OR al.action ILIKE '%' || p_action || '%')
      AND (p_severity IS NULL OR al.severity = p_severity)
    ORDER BY al."createdAt" DESC
    LIMIT greatest(1, least(p_limit, 500))
  ) x;
$$;

CREATE OR REPLACE FUNCTION supreme_access_log()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
  SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.last_sign_in_at DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT pu.id, pu.name, pu.email, pu.type, pu.role, pu."campaignId"::text AS campaign_id,
           au.last_sign_in_at, au.created_at AS registered_at,
           (SELECT count(*) FROM audit_logs al WHERE al."actorId" = pu.id) AS actions_count,
           (SELECT max("createdAt") FROM audit_logs al WHERE al."actorId" = pu.id) AS last_action_at
    FROM public.users pu
    LEFT JOIN auth.users au ON au.id = pu.id
  ) x;
$$;

REVOKE ALL ON FUNCTION supreme_audit_logs(int, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION supreme_access_log() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supreme_audit_logs(int, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION supreme_access_log() TO service_role;
