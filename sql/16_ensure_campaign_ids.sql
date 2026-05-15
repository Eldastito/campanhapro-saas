-- ============================================================
-- GARANTIR campaignId PARA TODOS OS ADMINS
-- Execute no Supabase Dashboard > SQL Editor
-- ============================================================
-- Sem campaignId, todas as features de campanha ficam quebradas:
-- - Membros da equipe não carregam nem salvam
-- - Calculadora não edita
-- - AI HQ fica em loop
-- ============================================================

-- Gera campaignId para admins que não têm um
UPDATE public.users
SET "campaignId" = gen_random_uuid()::TEXT
WHERE type = 'Admin'
  AND ("campaignId" IS NULL OR "campaignId" = '');

-- Confirma
SELECT email, type, plan, "campaignId", "isSupremeAdmin"
FROM public.users
WHERE type = 'Admin'
ORDER BY email;
