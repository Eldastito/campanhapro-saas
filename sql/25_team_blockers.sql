-- =============================================
-- PARTE 25: Tabela team_blockers
-- Bloqueios reportados por líderes à coordenação
-- IDEMPOTENTE
-- Padrão: reported_by/responded_by/related_member_id como TEXT (sem FK)
-- related_task_id: UUID FK (relação de cascade com team_tasks)
-- =============================================

CREATE TABLE IF NOT EXISTS public.team_blockers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id TEXT NOT NULL,
    reported_by TEXT NOT NULL,
    related_task_id UUID REFERENCES public.team_tasks(id) ON DELETE SET NULL,
    related_member_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT NOT NULL DEFAULT 'medium' CHECK (
        severity IN ('low', 'medium', 'high', 'critical')
    ),
    status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'in_review', 'resolved', 'dismissed')
    ),
    response TEXT,
    responded_by TEXT,
    responded_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_blockers_campaign  ON public.team_blockers(campaign_id);
CREATE INDEX IF NOT EXISTS idx_team_blockers_reporter  ON public.team_blockers(reported_by);
CREATE INDEX IF NOT EXISTS idx_team_blockers_status    ON public.team_blockers(status);
CREATE INDEX IF NOT EXISTS idx_team_blockers_severity  ON public.team_blockers(severity);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.update_team_blockers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS team_blockers_updated_at ON public.team_blockers;
CREATE TRIGGER team_blockers_updated_at
    BEFORE UPDATE ON public.team_blockers
    FOR EACH ROW
    EXECUTE FUNCTION public.update_team_blockers_updated_at();

-- ========================================
-- RLS
-- reported_by/responded_by são TEXT: comparar com auth.uid()::TEXT
-- ========================================
ALTER TABLE public.team_blockers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_blockers_select" ON public.team_blockers;
DROP POLICY IF EXISTS "team_blockers_insert" ON public.team_blockers;
DROP POLICY IF EXISTS "team_blockers_update" ON public.team_blockers;
DROP POLICY IF EXISTS "team_blockers_delete" ON public.team_blockers;

-- SELECT: Coordenador/Admin vê tudo da campanha; Líder vê o que ele reportou
CREATE POLICY "team_blockers_select" ON public.team_blockers
    FOR SELECT USING (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        AND (
            EXISTS (
                SELECT 1 FROM public.users
                WHERE id = auth.uid()
                  AND type IN ('Admin', 'Coordenador', 'Candidato')
            )
            OR reported_by = auth.uid()::TEXT
            OR is_supreme_admin()
        )
    );

-- INSERT: Líder, Admin, Coordenador podem abrir bloqueios
CREATE POLICY "team_blockers_insert" ON public.team_blockers
    FOR INSERT WITH CHECK (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        AND reported_by = auth.uid()::TEXT
        AND (
            EXISTS (
                SELECT 1 FROM public.users
                WHERE id = auth.uid()
                  AND type IN ('Admin', 'Coordenador', 'Candidato', 'Líder')
            )
            OR is_supreme_admin()
        )
    );

-- UPDATE: Coordenador/Admin pode responder; quem reportou pode editar enquanto status='open'
CREATE POLICY "team_blockers_update" ON public.team_blockers
    FOR UPDATE USING (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        AND (
            EXISTS (
                SELECT 1 FROM public.users
                WHERE id = auth.uid()
                  AND type IN ('Admin', 'Coordenador', 'Candidato')
            )
            OR (reported_by = auth.uid()::TEXT AND status = 'open')
            OR is_supreme_admin()
        )
    );

-- DELETE: só Admin/Coordenador
CREATE POLICY "team_blockers_delete" ON public.team_blockers
    FOR DELETE USING (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        AND (
            EXISTS (
                SELECT 1 FROM public.users
                WHERE id = auth.uid()
                  AND type IN ('Admin', 'Coordenador', 'Candidato')
            )
            OR is_supreme_admin()
        )
    );
