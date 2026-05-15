-- ============================================================
-- FIX MÍNIMO: APENAS HABILITA RLS + ADICIONA POLICIES
-- Execute no Supabase Dashboard > SQL Editor
-- Não cria tabelas, não cria indexes — só políticas
-- ============================================================

-- ETAPA 1: HABILITAR RLS (se já não estiver)
ALTER TABLE IF EXISTS public.war_room_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.contact_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.boletins_urna ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.election_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.election_fiscais ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ai_crm_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.engagements ENABLE ROW LEVEL SECURITY;

-- ETAPA 2: ADICIONAR POLICIES (remove se existem, cria novas)

-- war_room_intelligence
DROP POLICY IF EXISTS "war_room_select" ON public.war_room_intelligence;
DROP POLICY IF EXISTS "war_room_insert" ON public.war_room_intelligence;
CREATE POLICY "war_room_select" ON public.war_room_intelligence
    FOR SELECT USING (true);
CREATE POLICY "war_room_insert" ON public.war_room_intelligence
    FOR INSERT WITH CHECK (true);

-- contact_tasks
DROP POLICY IF EXISTS "contact_tasks_select" ON public.contact_tasks;
DROP POLICY IF EXISTS "contact_tasks_insert" ON public.contact_tasks;
CREATE POLICY "contact_tasks_select" ON public.contact_tasks
    FOR SELECT USING (true);
CREATE POLICY "contact_tasks_insert" ON public.contact_tasks
    FOR INSERT WITH CHECK (true);

-- contacts
DROP POLICY IF EXISTS "contacts_select" ON public.contacts;
DROP POLICY IF EXISTS "contacts_insert" ON public.contacts;
CREATE POLICY "contacts_select" ON public.contacts
    FOR SELECT USING (true);
CREATE POLICY "contacts_insert" ON public.contacts
    FOR INSERT WITH CHECK (true);

-- boletins_urna
DROP POLICY IF EXISTS "boletins_urna_select" ON public.boletins_urna;
DROP POLICY IF EXISTS "boletins_urna_insert" ON public.boletins_urna;
CREATE POLICY "boletins_urna_select" ON public.boletins_urna
    FOR SELECT USING (true);
CREATE POLICY "boletins_urna_insert" ON public.boletins_urna
    FOR INSERT WITH CHECK (true);

-- election_incidents
DROP POLICY IF EXISTS "election_incidents_select" ON public.election_incidents;
DROP POLICY IF EXISTS "election_incidents_insert" ON public.election_incidents;
CREATE POLICY "election_incidents_select" ON public.election_incidents
    FOR SELECT USING (true);
CREATE POLICY "election_incidents_insert" ON public.election_incidents
    FOR INSERT WITH CHECK (true);

-- election_fiscais
DROP POLICY IF EXISTS "election_fiscais_select" ON public.election_fiscais;
DROP POLICY IF EXISTS "election_fiscais_insert" ON public.election_fiscais;
CREATE POLICY "election_fiscais_select" ON public.election_fiscais
    FOR SELECT USING (true);
CREATE POLICY "election_fiscais_insert" ON public.election_fiscais
    FOR INSERT WITH CHECK (true);

-- ai_crm_recommendations
DROP POLICY IF EXISTS "ai_crm_select" ON public.ai_crm_recommendations;
DROP POLICY IF EXISTS "ai_crm_insert" ON public.ai_crm_recommendations;
CREATE POLICY "ai_crm_select" ON public.ai_crm_recommendations
    FOR SELECT USING (true);
CREATE POLICY "ai_crm_insert" ON public.ai_crm_recommendations
    FOR INSERT WITH CHECK (true);

-- engagements
DROP POLICY IF EXISTS "engagements_select" ON public.engagements;
DROP POLICY IF EXISTS "engagements_insert" ON public.engagements;
CREATE POLICY "engagements_select" ON public.engagements
    FOR SELECT USING (true);
CREATE POLICY "engagements_insert" ON public.engagements
    FOR INSERT WITH CHECK (true);

-- ETAPA 3: VERIFICAR RESULTADO
SELECT 'OK — RLS policies ativadas' AS status;
