-- =============================================
-- PARTE 23: Tabela team_tasks
-- Tarefas atribuídas a membros da equipe
-- IDEMPOTENTE
-- Padrão: leader_id/assigned_member_id/created_by como TEXT (sem FK)
-- igual ao padrão de visits.leader_id / incomes.created_by
-- =============================================

CREATE TABLE IF NOT EXISTS public.team_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id TEXT NOT NULL,
    leader_id TEXT,
    assigned_member_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'in_progress', 'completed', 'cancelled', 'blocked')
    ),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (
        priority IN ('low', 'normal', 'high', 'urgent')
    ),
    due_date DATE,
    completed_at TIMESTAMP WITH TIME ZONE,
    evidence_url TEXT,
    evidence_text TEXT,
    blocker_reason TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_tasks_campaign  ON public.team_tasks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_team_tasks_leader    ON public.team_tasks(leader_id);
CREATE INDEX IF NOT EXISTS idx_team_tasks_member    ON public.team_tasks(assigned_member_id);
CREATE INDEX IF NOT EXISTS idx_team_tasks_status    ON public.team_tasks(status);
CREATE INDEX IF NOT EXISTS idx_team_tasks_due_date  ON public.team_tasks(due_date);

-- Trigger: atualiza updated_at e preenche completed_at automaticamente
CREATE OR REPLACE FUNCTION public.update_team_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.completed_at IS NULL THEN
        NEW.completed_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS team_tasks_updated_at ON public.team_tasks;
CREATE TRIGGER team_tasks_updated_at
    BEFORE UPDATE ON public.team_tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.update_team_tasks_updated_at();

-- ========================================
-- RLS
-- Colunas TEXT: comparar com auth.uid()::TEXT
-- Subqueries em team_members: usar id::TEXT
-- ========================================
ALTER TABLE public.team_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_tasks_select" ON public.team_tasks;
DROP POLICY IF EXISTS "team_tasks_insert" ON public.team_tasks;
DROP POLICY IF EXISTS "team_tasks_update" ON public.team_tasks;
DROP POLICY IF EXISTS "team_tasks_delete" ON public.team_tasks;

-- SELECT: Admin/Coordenador/Candidato vê tudo da campanha;
--         Líder vê as suas e as dos seus liderados;
--         Membro vê as atribuídas a ele.
CREATE POLICY "team_tasks_select" ON public.team_tasks
    FOR SELECT USING (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        AND (
            EXISTS (
                SELECT 1 FROM public.users
                WHERE id = auth.uid()
                  AND type IN ('Admin', 'Coordenador', 'Candidato')
            )
            OR (
                EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND type = 'Líder')
                AND (
                    leader_id = auth.uid()::TEXT
                    OR assigned_member_id IN (
                        SELECT id::TEXT FROM public.team_members
                        WHERE assigned_leader_id = auth.uid()
                    )
                )
            )
            OR assigned_member_id IN (
                SELECT id::TEXT FROM public.team_members
                WHERE email = (SELECT email FROM public.users WHERE id = auth.uid())
            )
            OR is_supreme_admin()
        )
    );

CREATE POLICY "team_tasks_insert" ON public.team_tasks
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

-- UPDATE: Coordenador/Admin sempre; Líder dono; liderado pode atualizar a própria tarefa
CREATE POLICY "team_tasks_update" ON public.team_tasks
    FOR UPDATE USING (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        AND (
            EXISTS (
                SELECT 1 FROM public.users
                WHERE id = auth.uid()
                  AND type IN ('Admin', 'Coordenador', 'Candidato')
            )
            OR leader_id = auth.uid()::TEXT
            OR assigned_member_id IN (
                SELECT id::TEXT FROM public.team_members
                WHERE email = (SELECT email FROM public.users WHERE id = auth.uid())
            )
            OR is_supreme_admin()
        )
    );

CREATE POLICY "team_tasks_delete" ON public.team_tasks
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
