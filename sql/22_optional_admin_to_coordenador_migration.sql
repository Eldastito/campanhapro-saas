-- =============================================
-- OPCIONAL: Migrar Admin operacional → Coordenador
-- NÃO EXECUTAR AUTOMATICAMENTE EM PRODUÇÃO
-- Executar manualmente, campanha por campanha, se necessário
-- =============================================
-- NOTA: versão equivalente já existe em sql/20_optional_admin_to_coordenador_migration.sql
-- Este arquivo serve como referência numerada na sequência 21/22.
-- =============================================

-- Exemplo de uso: substitua 'CAMPANHA_ID_AQUI' pelo id real
-- UPDATE public.users
-- SET type = 'Coordenador'
-- WHERE type = 'Admin'
--   AND is_supreme_admin = false
--   AND email NOT IN ('eldastito@gmail.com', 'examepad@gmail.com')
--   AND campaign_id = 'CAMPANHA_ID_AQUI';

SELECT 'Este script é manual. Descomente e ajuste antes de rodar.' AS aviso;
