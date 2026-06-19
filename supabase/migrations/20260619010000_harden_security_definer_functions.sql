-- Hardening de funções (advisor de segurança Supabase):
--   - function_search_path_mutable: funções SECURITY DEFINER/STABLE sem search_path
--     fixo podem ser alvo de search_path hijack.
--   - RPCs de MUTAÇÃO executáveis por anon: dava pra abusar via /rest/v1/rpc/*.
--
-- As funções usadas DENTRO de policies RLS (is_supreme_admin, get_user_campaign_id*,
-- get_president_party_id, current_user_campaign_id) NÃO são tocadas: a policy precisa
-- executá-las e elas retornam null/false pra anon (sem vazamento).

-- 1) search_path fixo (corpos já são schema-qualified ou resolvem em public).
alter function public.get_president_party_id()        set search_path = public, pg_temp;
alter function public.increment_ai_trial_used(uuid)   set search_path = public, pg_temp;
alter function public.count_memory_by_source(text)    set search_path = public, pg_temp;

-- 2) Tira do alcance de anon/authenticated as RPCs de MUTAÇÃO chamadas só pelo backend
--    (service role). Fecha: queimar trial de IA de terceiros, inflar cliques de
--    short-link, disparar cleanup de webauthn.
revoke execute on function public.increment_ai_trial_used(uuid)    from public, anon, authenticated;
grant  execute on function public.increment_ai_trial_used(uuid)    to service_role;

revoke execute on function public.increment_short_link_click(text) from public, anon, authenticated;
grant  execute on function public.increment_short_link_click(text) to service_role;

revoke execute on function public.cleanup_webauthn_challenges()    from public, anon, authenticated;
grant  execute on function public.cleanup_webauthn_challenges()    to service_role;
