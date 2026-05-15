-- ============================================================
-- CRIAÇÃO DE USUÁRIO DE DEMONSTRAÇÃO
-- Execute no Supabase Dashboard > SQL Editor
--
-- ATENÇÃO: Este SQL só cria o perfil em public.users.
-- O usuário de auth (login/senha) deve ser criado ANTES via:
--   Supabase Dashboard > Authentication > Users > Add user
--   Email: eldastito@teste.com / Senha: CampanhaPro@2024
-- ============================================================

-- Passo 1: Cole o UUID gerado pelo Supabase ao criar o auth user
-- Substitua 'COLE-O-UUID-AQUI' pelo ID real do auth user criado acima
DO $$
DECLARE
  v_auth_id UUID;
  v_campaign_id TEXT := gen_random_uuid()::TEXT;
BEGIN
  -- Busca o auth user pelo email (funciona após criar via Dashboard)
  SELECT id INTO v_auth_id
  FROM auth.users
  WHERE email = 'eldastito@teste.com'
  LIMIT 1;

  IF v_auth_id IS NULL THEN
    RAISE EXCEPTION 'Auth user eldastito@teste.com não encontrado. Crie-o primeiro em Authentication > Users.';
  END IF;

  -- Upsert do perfil com Admin/Total
  INSERT INTO public.users (
    id,
    name,
    email,
    type,
    plan,
    role,
    "campaignId",
    "isSupremeAdmin"
  ) VALUES (
    v_auth_id,
    'Apresentação Demo',
    'eldastito@teste.com',
    'Admin',
    'Total',
    'active',
    v_campaign_id,
    FALSE
  )
  ON CONFLICT (id) DO UPDATE SET
    type = 'Admin',
    plan = 'Total',
    "isSupremeAdmin" = FALSE,
    "updatedAt" = NOW();

  RAISE NOTICE '✅ Usuário de demonstração criado!';
  RAISE NOTICE '   Auth ID:    %', v_auth_id;
  RAISE NOTICE '   CampaignId: %', v_campaign_id;
  RAISE NOTICE '   Plano:      Total (acesso completo)';
END $$;

-- Verificação
SELECT id, name, email, type, plan, "isSupremeAdmin", "campaignId"
FROM public.users
WHERE email = 'eldastito@teste.com';
