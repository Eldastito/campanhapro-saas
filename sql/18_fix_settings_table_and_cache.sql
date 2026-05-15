-- 18_fix_settings_table_and_cache.sql
-- Correção para o erro "Could not find the table 'public.campaign_settings'"
-- Este script garante a existência da tabela 'settings' e cria uma view de compatibilidade.

-- 1. Garantir que a tabela 'settings' existe com a estrutura correta
CREATE TABLE IF NOT EXISTS public.settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL, -- Removendo ambiguidade com id primário
    campaign_details JSONB DEFAULT '{}'::jsonb,
    header_logo TEXT,
    footer_logo TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(campaign_id)
);

-- 2. Se a tabela 'campaign_settings' não existe, criamos uma VIEW para compatibilidade
-- Isso resolve erros de cache onde o PostgREST espera o nome antigo/novo
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'campaign_settings') THEN
        CREATE VIEW public.campaign_settings AS SELECT * FROM public.settings;
        RAISE NOTICE 'View campaign_settings criada para compatibilidade.';
    END IF;
END $$;

-- 3. Habilitar RLS
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- 4. Criar Políticas de Acesso (Seguindo o padrão de isolamento por campaign_id)
DROP POLICY IF EXISTS "settings_select_policy" ON public.settings;
CREATE POLICY "settings_select_policy" ON public.settings
    FOR SELECT USING (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        OR (SELECT is_supreme_admin FROM public.users WHERE id = auth.uid())
    );

DROP POLICY IF EXISTS "settings_update_policy" ON public.settings;
CREATE POLICY "settings_update_policy" ON public.settings
    FOR UPDATE USING (
        campaign_id = (SELECT campaign_id FROM public.users WHERE id = auth.uid())
        OR (SELECT is_supreme_admin FROM public.users WHERE id = auth.uid())
    );

-- 5. Garantir permissões para a view (se aplicável)
GRANT SELECT ON public.campaign_settings TO authenticated;
GRANT SELECT ON public.campaign_settings TO anon;

-- 6. Trigger para updated_at
DROP TRIGGER IF EXISTS set_updated_at_settings ON public.settings;
CREATE TRIGGER set_updated_at_settings
    BEFORE UPDATE ON public.settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- 7. Notificar conclusão
SELECT 'OK - Tabela settings e View campaign_settings configuradas.' AS result;
