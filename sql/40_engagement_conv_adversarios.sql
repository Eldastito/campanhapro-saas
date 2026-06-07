-- 40_engagement_conv_adversarios.sql — fechamento do #45
--  - engagement_actions: conversões geradas (novosApoiadores, contatosColetados)
--  - adversários ficam em settings.campaignDetails.adversarios (texto)
--  - supreme_campaign_analytics: engagement agora soma pessoasContatadas/
--    novosApoiadores/contatosColetados; campaign expõe 'adversarios'.

ALTER TABLE public.engagement_actions
  ADD COLUMN IF NOT EXISTS "novosApoiadores"   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "contatosColetados" integer DEFAULT 0;

NOTIFY pgrst, 'reload schema';
