-- 36_perf_fk_indexes.sql
-- Advisors de PERFORMANCE: índices nas foreign keys que não tinham, e remoção
-- de índice duplicado. (Itens arriscados — consolidar 119 multiple_permissive_policies,
-- 32 auth_rls_initplan e dropar 42 unused_index — ficaram para um passe dedicado.)

CREATE INDEX IF NOT EXISTS idx_agent_routines_goalid            ON public.agent_routines ("goalId");
CREATE INDEX IF NOT EXISTS idx_agent_routines_projectid         ON public.agent_routines ("projectId");
CREATE INDEX IF NOT EXISTS idx_ai_crm_recommendations_contactid ON public.ai_crm_recommendations ("contactId");
CREATE INDEX IF NOT EXISTS idx_boletins_urna_fiscalid           ON public.boletins_urna ("fiscalId");
CREATE INDEX IF NOT EXISTS idx_boletins_urna_stationid          ON public.boletins_urna ("stationId");
CREATE INDEX IF NOT EXISTS idx_channel_conversations_contactid  ON public.channel_conversations ("contactId");
CREATE INDEX IF NOT EXISTS idx_contact_interactions_contactid   ON public.contact_interactions ("contactId");
CREATE INDEX IF NOT EXISTS idx_contact_interactions_userid      ON public.contact_interactions ("userId");
CREATE INDEX IF NOT EXISTS idx_contact_tasks_assignedto         ON public.contact_tasks ("assignedTo");
CREATE INDEX IF NOT EXISTS idx_contact_tasks_contactid          ON public.contact_tasks ("contactId");
CREATE INDEX IF NOT EXISTS idx_election_fiscais_stationid       ON public.election_fiscais ("stationId");
CREATE INDEX IF NOT EXISTS idx_election_fiscais_userid          ON public.election_fiscais ("userId");
CREATE INDEX IF NOT EXISTS idx_election_incidents_fiscalid      ON public.election_incidents ("fiscalId");
CREATE INDEX IF NOT EXISTS idx_election_incidents_locationid    ON public.election_incidents ("locationId");
CREATE INDEX IF NOT EXISTS idx_payment_events_subscriptionid    ON public.payment_events ("subscriptionId");
CREATE INDEX IF NOT EXISTS idx_pesquisas_entrevistadorid        ON public.pesquisas ("entrevistadorId");
CREATE INDEX IF NOT EXISTS idx_polling_stations_locationid      ON public.polling_stations ("locationId");
CREATE INDEX IF NOT EXISTS idx_routine_runs_linkedtaskid        ON public.routine_runs ("linkedTaskId");
CREATE INDEX IF NOT EXISTS idx_routine_runs_routineid           ON public.routine_runs ("routineId");
CREATE INDEX IF NOT EXISTS idx_routine_runs_triggerid           ON public.routine_runs ("triggerId");
CREATE INDEX IF NOT EXISTS idx_short_links_createdby            ON public.short_links ("createdBy");
CREATE INDEX IF NOT EXISTS idx_subscriptions_planid             ON public.subscriptions ("planId");
CREATE INDEX IF NOT EXISTS idx_users_assignedleaderid          ON public.users ("assignedLeaderId");
CREATE INDEX IF NOT EXISTS idx_whatsapp_blasts_instanceid       ON public.whatsapp_blasts ("instanceId");

DROP INDEX IF EXISTS public.idx_users_campaign; -- duplicado de idx_users_campaignid
