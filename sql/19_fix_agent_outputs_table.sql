-- 19_fix_agent_outputs_table.sql
-- Correção para o erro "column agent_outputs.agent_type does not exist"

DO $$
BEGIN
    -- 1. Garantir que a tabela existe
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_outputs') THEN
        CREATE TABLE public.agent_outputs (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            campaign_id UUID NOT NULL,
            agent_type TEXT NOT NULL,
            input JSONB DEFAULT '{}'::jsonb,
            output JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            created_by UUID
        );
        RAISE NOTICE 'Tabela agent_outputs criada.';
    ELSE
        -- 2. Se a tabela existe, garantir que a coluna agent_type existe
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_outputs' AND column_name = 'agent_type') THEN
            ALTER TABLE public.agent_outputs ADD COLUMN agent_type TEXT;
            -- Preencher com valor padrão se houver dados
            UPDATE public.agent_outputs SET agent_type = 'unknown' WHERE agent_type IS NULL;
            ALTER TABLE public.agent_outputs ALTER COLUMN agent_type SET NOT NULL;
            RAISE NOTICE 'Coluna agent_type adicionada à tabela agent_outputs.';
        END IF;

        -- 3. Garantir outras colunas básicas
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_outputs' AND column_name = 'input') THEN
            ALTER TABLE public.agent_outputs ADD COLUMN input JSONB DEFAULT '{}'::jsonb;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_outputs' AND column_name = 'output') THEN
            ALTER TABLE public.agent_outputs ADD COLUMN output JSONB DEFAULT '{}'::jsonb;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_outputs' AND column_name = 'campaign_id') THEN
            ALTER TABLE public.agent_outputs ADD COLUMN campaign_id UUID;
            RAISE NOTICE 'Coluna campaign_id adicionada à tabela agent_outputs.';
        END IF;
    END IF;
END $$;

-- 4. Habilitar RLS
ALTER TABLE public.agent_outputs ENABLE ROW LEVEL SECURITY;

-- 5. Criar políticas de acesso se não existirem
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agent_outputs' AND policyname = 'agent_outputs_select_policy') THEN
        CREATE POLICY agent_outputs_select_policy ON public.agent_outputs
        FOR SELECT USING (campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid()));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agent_outputs' AND policyname = 'agent_outputs_insert_policy') THEN
        CREATE POLICY agent_outputs_insert_policy ON public.agent_outputs
        FOR INSERT WITH CHECK (campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid()));
    END IF;
END $$;

-- 6. Garantir permissões
GRANT ALL ON public.agent_outputs TO authenticated;
GRANT ALL ON public.agent_outputs TO service_role;

-- 7. Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_agent_outputs_campaign_type ON public.agent_outputs(campaign_id, agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_created_at ON public.agent_outputs(created_at DESC);

SELECT 'OK - Tabela agent_outputs corrigida com sucesso.' AS result;
