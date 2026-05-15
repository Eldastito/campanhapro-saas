-- ============================================================
-- UNIFICAÇÃO DO SISTEMA DE PLANOS
-- Execute no Supabase Dashboard > SQL Editor
-- ============================================================
-- Este script:
-- 1. Garante que a coluna "planTier" existe em campaign_configs
-- 2. Cria campaign_configs para todos os Admins que ainda não têm
-- 3. Sincroniza users.plan com campaign_configs.planTier/features/limits
-- ============================================================

-- 1. Garantir coluna planTier em campaign_configs
ALTER TABLE public.campaign_configs
ADD COLUMN IF NOT EXISTS "planTier" TEXT;

-- 2. Fix do examepad: deve ser Admin com plano Total
UPDATE public.users
SET type = 'Admin', plan = 'Total', "isSupremeAdmin" = FALSE
WHERE email = 'examepad@gmail.com';

-- 3. Fix do eldastito: Admin Total + Supreme
UPDATE public.users
SET type = 'Admin', plan = 'Total', "isSupremeAdmin" = TRUE
WHERE email = 'eldastito@gmail.com';

-- 4. Função auxiliar: retorna config completa baseada no plano
CREATE OR REPLACE FUNCTION get_plan_config(p_plan TEXT)
RETURNS TABLE(
    "planTier" TEXT,
    features JSONB,
    "limits" JSONB
) AS $$
BEGIN
    IF p_plan = 'Total' THEN
        RETURN QUERY SELECT
            'completo'::TEXT,
            '["dashboard","ai_agents","visits","team","financial","engagement","reports","tools","resources","crm","demonstration","analytics","election_day"]'::JSONB,
            '{"aiCalls":999999,"teamMembers":999999,"visits":999999}'::JSONB;
    ELSE
        RETURN QUERY SELECT
            'limitado'::TEXT,
            '["dashboard","visits","team","help"]'::JSONB,
            '{"aiCalls":100,"teamMembers":50,"visits":1000}'::JSONB;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 5. Criar campaign_configs para todos os Admins que ainda não têm
INSERT INTO public.campaign_configs (id, "planTier", features, "limits", status)
SELECT
    u."campaignId"::TEXT AS id,
    (get_plan_config(u.plan))."planTier",
    (get_plan_config(u.plan)).features,
    (get_plan_config(u.plan))."limits",
    'active' AS status
FROM public.users u
WHERE u.type = 'Admin'
  AND u."campaignId" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.campaign_configs cc
      WHERE cc.id = u."campaignId"::TEXT
  );

-- 6. Atualizar campaign_configs existentes com planTier/features/limits corretos
UPDATE public.campaign_configs cc
SET
    "planTier" = (get_plan_config(u.plan))."planTier",
    features = (get_plan_config(u.plan)).features,
    "limits" = (get_plan_config(u.plan))."limits"
FROM public.users u
WHERE u."campaignId"::TEXT = cc.id
  AND u.type = 'Admin';

-- 7. Função is_supreme_admin atualizada
CREATE OR REPLACE FUNCTION is_supreme_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
    AND ("isSupremeAdmin" = TRUE OR email = 'eldastito@gmail.com')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Verificar resultado
SELECT
    u.email,
    u.type,
    u.plan,
    u."isSupremeAdmin",
    u."campaignId",
    cc."planTier",
    cc.features
FROM public.users u
LEFT JOIN public.campaign_configs cc ON cc.id = u."campaignId"::TEXT
WHERE u.type = 'Admin'
ORDER BY u.email;
