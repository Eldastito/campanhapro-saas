-- 39_forms_evolution_customfields_competitive.sql
-- Evolução dos formulários (continuação):
--  - pesquisas.customFields (campos personalizáveis do Form Builder na Pesquisa)
--  - inteligência competitiva na pesquisa (Fase D)
--  - bloco 'funnel' e métricas competitivas em supreme_campaign_analytics
--    (recriada via migração; ver histórico — pesquisas agora também retorna
--     avgAvaliacaoCandidato/Adversario, avgProbMudanca, lembrancaRatePct).

ALTER TABLE public.pesquisas ADD COLUMN IF NOT EXISTS "customFields" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.pesquisas
  ADD COLUMN IF NOT EXISTS "lembrancaCandidato"  boolean,
  ADD COLUMN IF NOT EXISTS "avaliacaoCandidato"  integer,
  ADD COLUMN IF NOT EXISTS "avaliacaoAdversario" integer,
  ADD COLUMN IF NOT EXISTS "probMudancaVoto"     integer;

NOTIFY pgrst, 'reload schema';
