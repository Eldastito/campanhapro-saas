-- =============================================
-- DIAGNÓSTICO COMPLETO: colunas e tipos reais
-- Execute no SQL Editor para ver o estado atual do banco
-- =============================================

-- 1. Colunas de campanha por tabela (nome e tipo de dado)
SELECT 
    table_name,
    column_name,
    data_type,
    CASE data_type
        WHEN 'uuid' THEN '⚠️ UUID — precisa de cast ::text'
        WHEN 'text' THEN '✅ TEXT — comparação direta'
        ELSE '❓ Outro tipo: ' || data_type
    END AS observacao
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('campaignId', 'campaign_id', 'Campaign_id', 'CampaignId')
ORDER BY table_name;

-- 2. Todas as tabelas existentes no banco
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- 3. Policies existentes
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
