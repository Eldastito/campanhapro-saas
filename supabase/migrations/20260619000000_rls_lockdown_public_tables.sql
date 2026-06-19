-- RLS lockdown de tabelas públicas expostas via PostgREST que estavam SEM RLS.
--
-- INCIDENTE: o advisor de segurança do Supabase apontou ERROR rls_disabled_in_public
-- em várias tabelas. Como a anon key é pública (vai no bundle do frontend), qualquer
-- um podia bater direto em /rest/v1/<tabela> e ler/escrever TUDO, de todas as
-- campanhas, ignorando o backend. O backend usa SERVICE ROLE, que IGNORA RLS — então
-- habilitar RLS não afeta nenhuma rota do backend.
--
-- Estratégia:
--   - Tabelas que o frontend acessa só via API do backend → RLS sem policy (deny-all
--     pra anon/authenticated; service role continua passando).
--   - Tabelas que o frontend acessa DIRETO (sessão autenticada) → policy escopada.

-- ===== Backend-only (frontend usa via API; service role bypassa) =====
alter table public.daily_backups            enable row level security;
alter table public.party_wipe_audit         enable row level security;
alter table public.party_ai_command_logs    enable row level security;
alter table public.social_oauth_state       enable row level security;
alter table public.social_sync_log          enable row level security;
alter table public.team_badges              enable row level security;
alter table public.faq_entries              enable row level security;
alter table public.party_recurring_repasses enable row level security;
alter table public.whatsapp_routing_log     enable row level security;
alter table public.whatsapp_routing_lock    enable row level security;

-- ===== Frontend acessa direto (sessão autenticada) → escopo por campanha =====
-- engagement_followups: VisitsContext insere com campaignId = campanha do usuário.
alter table public.engagement_followups enable row level security;
drop policy if exists ef_tenant on public.engagement_followups;
create policy ef_tenant on public.engagement_followups
  for all to authenticated
  using ("campaignId" = get_user_campaign_id_text())
  with check ("campaignId" = get_user_campaign_id_text());

-- cep_cache: cache de CEP (dado postal público, sem coluna de tenant) → só autenticado.
alter table public.cep_cache enable row level security;
drop policy if exists cep_auth_all on public.cep_cache;
create policy cep_auth_all on public.cep_cache
  for all to authenticated using (true) with check (true);

-- polling_stations: substitui a policy permissiva ALL USING(true) (qualquer usuário
-- autenticado escrevia em dados compartilhados) por leitura p/ autenticado; escrita
-- fica só via service role (backend).
drop policy if exists "auth manage polling_stations" on public.polling_stations;
drop policy if exists polling_stations_read on public.polling_stations;
create policy polling_stations_read on public.polling_stations
  for select to authenticated using (true);

notify pgrst, 'reload schema';
