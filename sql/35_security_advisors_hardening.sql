-- 35_security_advisors_hardening.sql
-- Correções dos advisors de SEGURANÇA do Supabase (aplicado ao projeto ativo).

-- A) Fixa search_path (evita hijack via search_path mutável).
ALTER FUNCTION public.match_knowledge_chunks(query_embedding vector, campaign_id text, match_count integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_supreme_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_user_campaign_id_text() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_user_campaign_id() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.current_user_campaign_id() SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_short_links_updated_at() SET search_path = public, pg_temp;

-- B) Fecha vazamento: funções supreme_* (SECURITY DEFINER) só podem ser
--    chamadas pelo backend (service_role). Antes, qualquer um com a anon key
--    podia chamar /rest/v1/rpc/supreme_financial_metrics e ler dados sensíveis.
REVOKE EXECUTE ON FUNCTION public.supreme_platform_metrics()                          FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.supreme_financial_metrics(p_usd_brl numeric)        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.supreme_campaign_analytics(p_campaign_id text)      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.supreme_audit_logs(p_limit integer, p_action text, p_severity text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.supreme_access_log()                                FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.supreme_nf_summary()                                FROM anon, authenticated;

-- C) Liga RLS em polling_stations (estava exposta sem RLS = anon com acesso total).
ALTER TABLE public.polling_stations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth manage polling_stations" ON public.polling_stations;
CREATE POLICY "auth manage polling_stations" ON public.polling_stations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "svc bypass polling_stations" ON public.polling_stations;
CREATE POLICY "svc bypass polling_stations" ON public.polling_stations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Pendências (baixo risco, não aplicadas): extension vector no schema public;
-- política geo_insert always-true; leaked-password protection (toggle no painel Auth);
-- helpers RLS (is_supreme_admin/get_user_campaign_id...) seguem executáveis pois
-- são usados DENTRO das policies (revogar quebraria o acesso).
