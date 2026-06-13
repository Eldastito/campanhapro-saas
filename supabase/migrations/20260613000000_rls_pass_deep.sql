-- #43 Passe profundo de RLS (junho/2026)
-- Antes: 220 findings (38 auth_rls_initplan + 125 multiple_permissive + 57 unused_index)
-- Depois: 62 findings (0 auth_rls_initplan + 5 multiple_permissive intencionais + 57 unused_index)
--
-- Os 5 multiple_permissive restantes são INTENCIONAIS (anon-write pra captura
-- pública em contacts/voter_journey).
-- Os 57 unused_index ficam pra revisão futura — alguns como
-- idx_knowledge_chunks_embedding são pra pgvector e podem ser legítimos.
--
-- Fixes aplicados:
-- 1. auth.uid() → (SELECT auth.uid()) em todas policies (1 eval/query, não 1/linha)
-- 2. "Service role bypass" → TO service_role (não TO public) — mata overlap c/ tenant policies
-- 3. team_goals_write (FOR ALL) → split em INSERT/UPDATE/DELETE explícitos
-- 4. party_candidates _pres + _self → mergeado em party_candidates_select

------------------------------------------------------------------------
-- BLOCO A: Service role bypass policies → TO service_role
------------------------------------------------------------------------

DROP POLICY IF EXISTS "Service role bypass routines" ON public.agent_routines;
CREATE POLICY "Service role bypass routines" ON public.agent_routines
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass agent_tasks" ON public.agent_tasks;
CREATE POLICY "Service role bypass agent_tasks" ON public.agent_tasks
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass budget allocations" ON public.budget_allocations;
CREATE POLICY "Service role bypass budget allocations" ON public.budget_allocations
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass goals" ON public.campaign_goals;
CREATE POLICY "Service role bypass goals" ON public.campaign_goals
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass projects" ON public.campaign_projects;
CREATE POLICY "Service role bypass projects" ON public.campaign_projects
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass" ON public.campaign_sync_logs;
CREATE POLICY "Service role bypass" ON public.campaign_sync_logs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass conversations" ON public.channel_conversations;
CREATE POLICY "Service role bypass conversations" ON public.channel_conversations
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass messages" ON public.channel_messages;
CREATE POLICY "Service role bypass messages" ON public.channel_messages
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass mappings" ON public.channel_phone_mappings;
CREATE POLICY "Service role bypass mappings" ON public.channel_phone_mappings
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass consent" ON public.consent_records;
CREATE POLICY "Service role bypass consent" ON public.consent_records
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "content_posts_service_role" ON public.content_posts;
CREATE POLICY "content_posts_service_role" ON public.content_posts
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass knowledge" ON public.knowledge_chunks;
CREATE POLICY "Service role bypass knowledge" ON public.knowledge_chunks
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "meeting_records_service_role" ON public.meeting_records;
CREATE POLICY "meeting_records_service_role" ON public.meeting_records
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass routine_runs" ON public.routine_runs;
CREATE POLICY "Service role bypass routine_runs" ON public.routine_runs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role bypass routine_triggers" ON public.routine_triggers;
CREATE POLICY "Service role bypass routine_triggers" ON public.routine_triggers
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "whatsapp_blasts_service_role" ON public.whatsapp_blasts;
CREATE POLICY "whatsapp_blasts_service_role" ON public.whatsapp_blasts
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

------------------------------------------------------------------------
-- BLOCO B: "Campaign members read own X" — wrap auth.uid() + TO authenticated
------------------------------------------------------------------------

DROP POLICY IF EXISTS "Campaign members read own routines" ON public.agent_routines;
CREATE POLICY "Campaign members read own routines" ON public.agent_routines
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("campaignId" IN (SELECT (u."campaignId")::text FROM public.users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Campaign members read own tasks" ON public.agent_tasks;
CREATE POLICY "Campaign members read own tasks" ON public.agent_tasks
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("campaignId" IN (SELECT (u."campaignId")::text FROM public.users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Campaign members read own budget allocations" ON public.budget_allocations;
CREATE POLICY "Campaign members read own budget allocations" ON public.budget_allocations
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("campaignId" IN (SELECT (u."campaignId")::text FROM public.users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Campaign members read own goals" ON public.campaign_goals;
CREATE POLICY "Campaign members read own goals" ON public.campaign_goals
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("campaignId" IN (SELECT (u."campaignId")::text FROM public.users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Campaign members read own projects" ON public.campaign_projects;
CREATE POLICY "Campaign members read own projects" ON public.campaign_projects
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("campaignId" IN (SELECT (u."campaignId")::text FROM public.users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Campaign members can read their sync log" ON public.campaign_sync_logs;
CREATE POLICY "Campaign members can read their sync log" ON public.campaign_sync_logs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("campaignId" IN (SELECT (u."campaignId")::text FROM public.users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Campaign members read conversations" ON public.channel_conversations;
CREATE POLICY "Campaign members read conversations" ON public.channel_conversations
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("campaignId" IN (SELECT (u."campaignId")::text FROM public.users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Campaign members read messages" ON public.channel_messages;
CREATE POLICY "Campaign members read messages" ON public.channel_messages
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("campaignId" IN (SELECT (u."campaignId")::text FROM public.users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Campaign members read consent" ON public.consent_records;
CREATE POLICY "Campaign members read consent" ON public.consent_records
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("campaignId" IN (SELECT (u."campaignId")::text FROM public.users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Campaign members read knowledge" ON public.knowledge_chunks;
CREATE POLICY "Campaign members read knowledge" ON public.knowledge_chunks
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("campaignId" IN (SELECT (u."campaignId")::text FROM public.users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Campaign members read routine runs" ON public.routine_runs;
CREATE POLICY "Campaign members read routine runs" ON public.routine_runs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("campaignId" IN (SELECT (u."campaignId")::text FROM public.users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Campaign members read routine triggers" ON public.routine_triggers;
CREATE POLICY "Campaign members read routine triggers" ON public.routine_triggers
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("campaignId" IN (SELECT (u."campaignId")::text FROM public.users u WHERE u.id = (SELECT auth.uid())));

------------------------------------------------------------------------
-- BLOCO C: Outras policies com auth.uid() unwrapped
------------------------------------------------------------------------

DROP POLICY IF EXISTS "parties_rw" ON public.parties;
CREATE POLICY "parties_rw" ON public.parties
  AS PERMISSIVE FOR ALL TO authenticated
  USING (("presidentId" = (SELECT auth.uid())) OR is_supreme_admin())
  WITH CHECK (("presidentId" = (SELECT auth.uid())) OR is_supreme_admin());

DROP POLICY IF EXISTS "party_candidates_self" ON public.party_candidates;
DROP POLICY IF EXISTS "party_candidates_pres" ON public.party_candidates;
CREATE POLICY "party_candidates_select" ON public.party_candidates
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    ("userId" = (SELECT auth.uid()))
    OR ("campaignId" = get_user_campaign_id_text())
    OR (("partyId" IN (SELECT p.id FROM public.parties p WHERE p."presidentId" = (SELECT auth.uid()))))
    OR is_supreme_admin()
  );

DROP POLICY IF EXISTS "Campaign admins can manage short links" ON public.short_links;
CREATE POLICY "Campaign admins can manage short links" ON public.short_links
  AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (SELECT auth.uid())
      AND u.type = ANY (ARRAY['Admin'::text, 'Suporte'::text])
      AND (u."campaignId" = short_links."campaignId" OR u."isSupremeAdmin" = true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (SELECT auth.uid())
      AND u.type = ANY (ARRAY['Admin'::text, 'Suporte'::text])
      AND (u."campaignId" = short_links."campaignId" OR u."isSupremeAdmin" = true)
  ));

DROP POLICY IF EXISTS "p_users_self_or_campaign" ON public.users;
CREATE POLICY "p_users_self_or_campaign" ON public.users
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((id = (SELECT auth.uid())) OR (("campaignId")::text = get_user_campaign_id_text()) OR is_supreme_admin())
  WITH CHECK ((id = (SELECT auth.uid())) OR (("campaignId")::text = get_user_campaign_id_text()) OR is_supreme_admin());

------------------------------------------------------------------------
-- BLOCO D: team_goals — quebra do FOR ALL em INSERT/UPDATE/DELETE explícitos
------------------------------------------------------------------------

DROP POLICY IF EXISTS "team_goals_select" ON public.team_goals;
CREATE POLICY "team_goals_select" ON public.team_goals
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("campaignId" IN (SELECT u."campaignId" FROM public.users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "team_goals_write" ON public.team_goals;
CREATE POLICY "team_goals_insert" ON public.team_goals
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ("campaignId" IN (
    SELECT u."campaignId" FROM public.users u
    WHERE u.id = (SELECT auth.uid()) AND u.type = ANY (ARRAY['Admin'::text, 'Coordenador'::text])
  ));
CREATE POLICY "team_goals_update" ON public.team_goals
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ("campaignId" IN (
    SELECT u."campaignId" FROM public.users u
    WHERE u.id = (SELECT auth.uid()) AND u.type = ANY (ARRAY['Admin'::text, 'Coordenador'::text])
  ))
  WITH CHECK ("campaignId" IN (
    SELECT u."campaignId" FROM public.users u
    WHERE u.id = (SELECT auth.uid()) AND u.type = ANY (ARRAY['Admin'::text, 'Coordenador'::text])
  ));
CREATE POLICY "team_goals_delete" ON public.team_goals
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ("campaignId" IN (
    SELECT u."campaignId" FROM public.users u
    WHERE u.id = (SELECT auth.uid()) AND u.type = ANY (ARRAY['Admin'::text, 'Coordenador'::text])
  ));

------------------------------------------------------------------------
-- BLOCO E: INSERT-only policies
------------------------------------------------------------------------

DROP POLICY IF EXISTS "ai_usage_insert" ON public.ai_usage;
CREATE POLICY "ai_usage_insert" ON public.ai_usage
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "fraud_insert" ON public.fraud_audit_logs;
CREATE POLICY "fraud_insert" ON public.fraud_audit_logs
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "geo_cache_select" ON public.geo_cache;
CREATE POLICY "geo_cache_select" ON public.geo_cache
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "geo_cache_insert" ON public.geo_cache;
CREATE POLICY "geo_cache_insert" ON public.geo_cache
  AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
