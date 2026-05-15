-- ============================================================
-- CAMPANHAPRO — FIX DE ACESSO ADMIN E CONTAS DE TESTE
-- Execute este script no Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. examepad@gmail.com = Admin completo da CAMPANHA (NÃO é gestor da plataforma)
--    isSupremeAdmin = FALSE → fica no CampaignWebApp (dashboard normal)
--    plan = Total → acesso a todas as funcionalidades
UPDATE public.users
SET
    type = 'Admin',
    plan = 'Total',
    "isSupremeAdmin" = FALSE
WHERE email = 'examepad@gmail.com';

-- 2. eldastito@gmail.com = Gestor da PLATAFORMA (SupremeAdmin)
--    isSupremeAdmin = TRUE → roteado para SupremeAdminPage
UPDATE public.users
SET
    type = 'Admin',
    plan = 'Total',
    "isSupremeAdmin" = TRUE
WHERE email = 'eldastito@gmail.com';

-- 3. Corrigir a função is_supreme_admin (usada nas RLS policies)
--    Só eldastito tem acesso irrestrito via RLS
CREATE OR REPLACE FUNCTION is_supreme_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
    AND (
        "isSupremeAdmin" = TRUE
        OR email = 'eldastito@gmail.com'
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Criar contas de teste na tabela users
-- ATENÇÃO: Os usuários precisam existir em auth.users primeiro.
-- Execute a seção 5 abaixo APÓS criar os usuários via script ou via Supabase Auth dashboard.

-- 5. Seed de usuários de teste (executar após criar auth users)
-- Substitua os UUIDs pelos IDs reais criados em auth.users
-- Eles serão inseridos/atualizados automaticamente pelo script create-test-users.ts

-- 6. Verificar resultado
SELECT id, email, type, plan, "isSupremeAdmin", "campaignId"
FROM public.users
WHERE email IN ('examepad@gmail.com', 'eldastito@gmail.com',
                'colaborador@teste.com', 'apoiador@teste.com',
                'lider@teste.com', 'entrevistador@teste.com')
ORDER BY email;
