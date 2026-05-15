-- =============================================
-- OPCIONAL: Migrar Admin operacional → Coordenador
-- NÃO EXECUTAR AUTOMATICAMENTE EM PRODUÇÃO
-- Executar manualmente, campanha por campanha, se necessário
-- =============================================

-- Exemplo de uso: substitua 'CAMPANHA_ID_AQUI' pelo id real
-- UPDATE public.users
-- SET type = 'Coordenador'
-- WHERE type = 'Admin'
--   AND is_supreme_admin = false
--   AND email NOT IN ('eldastito@gmail.com', 'examepad@gmail.com')
--   AND campaign_id = 'CAMPANHA_ID_AQUI';

SELECT 'Este script é manual. Descomente e ajuste antes de rodar.' AS aviso;
