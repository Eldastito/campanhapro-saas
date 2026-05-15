-- =============================================
-- PARTE 21: Tabela team_resources
-- Recursos materiais atribuídos a líderes/membros
-- IDEMPOTENTE
-- =============================================

CREATE TABLE IF NOT EXISTS public.team_resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id TEXT NOT NULL,
    leader_id TEXT,
    assigned_member_id TEXT,
    resource_type TEXT NOT NULL CHECK (
        resource_type IN (
            'panfleto', 'camiseta', 'kit_rua', 'equipamento',
            'veiculo', 'celular', 'material_digital',
            'verba', 'combustivel', 'outro'
        )
    ),
    name TEXT NOT NULL,
    description TEXT,
    quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    unit TEXT,
    status TEXT NOT NULL DEFAULT 'available' CHECK (
        status IN ('available', 'allocated', 'in_use', 'returned', 'lost', 'damaged', 'blocked')
    ),
    allocated_at TIMESTAMP WITH TIME ZONE,
    returned_at  TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_team_resources_campaign ON public.team_resources(campaign_id);
CREATE INDEX IF NOT EXISTS idx_team_resources_leader   ON public.team_resources(leader_id);
CREATE INDEX IF NOT EXISTS idx_team_resources_member   ON public.team_resources(assigned_member_id);
CREATE INDEX IF NOT EXISTS idx_team_resources_status   ON public.team_resources(status);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.update_team_resources_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS team_resources_updated_at ON public.team_resources;
CREATE TRIGGER team_resources_updated_at
    BEFORE UPDATE ON public.team_resources
    FOR EACH ROW
    EXECUTE FUNCTION public.update_team_resources_updated_at();

-- ========================================
-- RLS — Row Level Security
-- ========================================
ALTER TABLE public.team_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_resources_select" ON public.team_resources;
DROP POLICY IF EXISTS "team_resources_insert" ON public.team_resources;
DROP POLICY IF EXISTS "team_resources_update" ON public.team_resources;
DROP POLICY IF EXISTS "team_resources_delete" ON public.team_resources;

-- Função auxiliar: retorna uid do usuário autenticado como TEXT
-- (auth.uid() retorna uuid; comparar com colunas TEXT requer cast)

-- SELECT: Admin/Coordenador/Candidato vê tudo da campanha;
--         Líder vê o que é dele ou dos seus liderados;
--         outros veem só o que está atribuído a eles via team_members.
CREATE POLICY "team_resources_select" ON public.team_resources
    FOR SELECT USING (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        AND (
            -- Admin / Coordenador / Candidato / Supreme Admin
            EXISTS (
                SELECT 1 FROM public.users
                WHERE id = auth.uid()
                  AND (type IN ('Admin', 'Coordenador', 'Candidato')
                       OR is_supreme_admin = true)
            )
            -- Líder: recursos dele OU dos seus liderados
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
            -- Membros: só o que está atribuído a eles
            OR assigned_member_id IN (
                SELECT id::TEXT FROM public.team_members
                WHERE email = (SELECT email FROM public.users WHERE id = auth.uid())
            )
        )
    );

-- INSERT: Admin/Coordenador/Candidato; Líder só para sua equipe
CREATE POLICY "team_resources_insert" ON public.team_resources
    FOR INSERT WITH CHECK (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        AND (
            EXISTS (
                SELECT 1 FROM public.users
                WHERE id = auth.uid()
                  AND (type IN ('Admin', 'Coordenador', 'Candidato')
                       OR is_supreme_admin = true)
            )
            OR (
                EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND type = 'Líder')
                AND leader_id = auth.uid()::TEXT
            )
        )
    );

-- UPDATE: mesma lógica do INSERT
CREATE POLICY "team_resources_update" ON public.team_resources
    FOR UPDATE USING (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        AND (
            EXISTS (
                SELECT 1 FROM public.users
                WHERE id = auth.uid()
                  AND (type IN ('Admin', 'Coordenador', 'Candidato')
                       OR is_supreme_admin = true)
            )
            OR leader_id = auth.uid()::TEXT
        )
    );

-- DELETE: só Admin/Coordenador/Supreme
CREATE POLICY "team_resources_delete" ON public.team_resources
    FOR DELETE USING (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid()
              AND (type IN ('Admin', 'Coordenador', 'Candidato')
                   OR is_supreme_admin = true)
        )
    );
