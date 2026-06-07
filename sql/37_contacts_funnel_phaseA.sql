-- 37_contacts_funnel_phaseA.sql
-- Fase A da evolução dos formulários: fundação do funil/jornada no registro
-- mestre do eleitor (contacts). camelCase (convenção da tabela). Também cria
-- electoralZone/electoralSection, que o CRM já tentava inserir mas não existiam.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS "electoralZone"    text,
  ADD COLUMN IF NOT EXISTS "electoralSection" text,
  ADD COLUMN IF NOT EXISTS "funnelStage"      text DEFAULT 'capturado',
  ADD COLUMN IF NOT EXISTS "voteIntention"    text,     -- apoia|vai_votar|indeciso|rejeita|nao_disse
  ADD COLUMN IF NOT EXISTS "voteCertainty"    integer,  -- 0..10
  ADD COLUMN IF NOT EXISTS "objection"        text,
  ADD COLUMN IF NOT EXISTS "isMultiplier"     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "influenceCount"   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "whatsappOptin"    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "preferredChannel" text,     -- whatsapp|ligacao|presencial
  ADD COLUMN IF NOT EXISTS "preferredTime"    text;     -- manha|tarde|noite

CREATE INDEX IF NOT EXISTS idx_contacts_funnelstage   ON public.contacts ("campaignId", "funnelStage");
CREATE INDEX IF NOT EXISTS idx_contacts_voteintention ON public.contacts ("campaignId", "voteIntention");

NOTIFY pgrst, 'reload schema';
