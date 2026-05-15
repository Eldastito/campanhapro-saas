-- =============================================
-- PARTE 24: Tabelas team_meetings + team_meeting_attendances
-- IDEMPOTENTE
-- Padrão: leader_id/created_by como TEXT (sem FK)
-- team_meeting_attendances.member_id: UUID FK (relação de cascade)
-- =============================================

CREATE TABLE IF NOT EXISTS public.team_meetings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id TEXT NOT NULL,
    leader_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_minutes INTEGER DEFAULT 60,
    location TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (
        status IN ('scheduled', 'completed', 'cancelled')
    ),
    what_worked TEXT,
    what_failed TEXT,
    lessons_learned TEXT,
    action_plan TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_meetings_campaign   ON public.team_meetings(campaign_id);
CREATE INDEX IF NOT EXISTS idx_team_meetings_leader     ON public.team_meetings(leader_id);
CREATE INDEX IF NOT EXISTS idx_team_meetings_scheduled  ON public.team_meetings(scheduled_at);

-- Tabela de presença (N:N com team_members)
-- member_id mantém UUID FK pois é relação de cascade (não soft reference)
CREATE TABLE IF NOT EXISTS public.team_meeting_attendances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id UUID NOT NULL REFERENCES public.team_meetings(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'invited' CHECK (
        status IN ('invited', 'confirmed', 'attended', 'absent', 'declined')
    ),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE (meeting_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_attendances_meeting ON public.team_meeting_attendances(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_attendances_member  ON public.team_meeting_attendances(member_id);

-- Trigger updated_at em team_meetings
CREATE OR REPLACE FUNCTION public.update_team_meetings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS team_meetings_updated_at ON public.team_meetings;
CREATE TRIGGER team_meetings_updated_at
    BEFORE UPDATE ON public.team_meetings
    FOR EACH ROW
    EXECUTE FUNCTION public.update_team_meetings_updated_at();

-- ========================================
-- RLS team_meetings
-- leader_id é TEXT: comparar com auth.uid()::TEXT
-- ========================================
ALTER TABLE public.team_meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_meetings_select" ON public.team_meetings;
DROP POLICY IF EXISTS "team_meetings_insert" ON public.team_meetings;
DROP POLICY IF EXISTS "team_meetings_update" ON public.team_meetings;
DROP POLICY IF EXISTS "team_meetings_delete" ON public.team_meetings;

CREATE POLICY "team_meetings_select" ON public.team_meetings
    FOR SELECT USING (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        AND (
            EXISTS (
                SELECT 1 FROM public.users
                WHERE id = auth.uid()
                  AND type IN ('Admin', 'Coordenador', 'Candidato')
            )
            OR leader_id = auth.uid()::TEXT
            -- Membro vê reuniões em que está convidado
            OR id IN (
                SELECT meeting_id FROM public.team_meeting_attendances
                WHERE member_id IN (
                    SELECT id FROM public.team_members
                    WHERE email = (SELECT email FROM public.users WHERE id = auth.uid())
                )
            )
            OR is_supreme_admin()
        )
    );

CREATE POLICY "team_meetings_insert" ON public.team_meetings
    FOR INSERT WITH CHECK (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        AND (
            EXISTS (
                SELECT 1 FROM public.users
                WHERE id = auth.uid()
                  AND type IN ('Admin', 'Coordenador', 'Candidato')
            )
            OR (
                EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND type = 'Líder')
                AND leader_id = auth.uid()::TEXT
            )
            OR is_supreme_admin()
        )
    );

CREATE POLICY "team_meetings_update" ON public.team_meetings
    FOR UPDATE USING (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        AND (
            EXISTS (
                SELECT 1 FROM public.users
                WHERE id = auth.uid()
                  AND type IN ('Admin', 'Coordenador', 'Candidato')
            )
            OR leader_id = auth.uid()::TEXT
            OR is_supreme_admin()
        )
    );

CREATE POLICY "team_meetings_delete" ON public.team_meetings
    FOR DELETE USING (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        AND (
            EXISTS (
                SELECT 1 FROM public.users
                WHERE id = auth.uid()
                  AND type IN ('Admin', 'Coordenador', 'Candidato')
            )
            OR leader_id = auth.uid()::TEXT
            OR is_supreme_admin()
        )
    );

-- ========================================
-- RLS team_meeting_attendances
-- member_id é UUID (FK cascade): comparar UUID com UUID
-- ========================================
ALTER TABLE public.team_meeting_attendances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meeting_attendances_select" ON public.team_meeting_attendances;
DROP POLICY IF EXISTS "meeting_attendances_modify" ON public.team_meeting_attendances;

-- Vê presenças das reuniões que já consegue ver via RLS de team_meetings
CREATE POLICY "meeting_attendances_select" ON public.team_meeting_attendances
    FOR SELECT USING (
        meeting_id IN (SELECT id FROM public.team_meetings)
    );

-- Gerencia presenças apenas quem pode editar a reunião
CREATE POLICY "meeting_attendances_modify" ON public.team_meeting_attendances
    FOR ALL USING (
        meeting_id IN (
            SELECT id FROM public.team_meetings
            WHERE leader_id = auth.uid()::TEXT
               OR EXISTS (
                   SELECT 1 FROM public.users
                   WHERE id = auth.uid()
                     AND type IN ('Admin', 'Coordenador', 'Candidato')
               )
               OR is_supreme_admin()
        )
    );
