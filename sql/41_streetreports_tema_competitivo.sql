-- 41_streetreports_tema_competitivo.sql
-- Fase E2 da evolução dos formulários (captação p/ IA): Reporte de Rua inteligente.
-- Adiciona tema categorizado (mapa de calor das dores por território, cruzável com
-- pesquisas.dorImediata) e inteligência competitiva (presença de adversário).
--
-- Também recria supreme_campaign_analytics() expondo no bloco streetReports:
--   byTema (contagem por tema) e adversarioSightings (avistamentos de adversário).
-- (A função completa é recriada via migração no projeto ativo; este arquivo
--  documenta as colunas e os campos adicionados ao analytics.)

ALTER TABLE public.street_reports
  ADD COLUMN IF NOT EXISTS tema text,                              -- saude|educacao|seguranca|transporte|emprego|infraestrutura|lazer|outro
  ADD COLUMN IF NOT EXISTS "viuAdversario" boolean DEFAULT false,  -- presença competitiva no território
  ADD COLUMN IF NOT EXISTS "adversarioDetalhe" text;               -- o que viu (boca de urna, material, evento)

CREATE INDEX IF NOT EXISTS idx_street_reports_tema ON public.street_reports ("campaignId", tema);

-- Bloco streetReports da supreme_campaign_analytics() passou a incluir:
--   'byTema', (SELECT jsonb_object_agg(coalesce(tema,'(sem)'), c) ...),
--   'adversarioSightings', count(*) FILTER (WHERE "viuAdversario" IS TRUE),

NOTIFY pgrst, 'reload schema';
