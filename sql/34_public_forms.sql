-- 34_public_forms.sql — F5b Formulários públicos (lead capture)
--
-- Formulários com URL pública (landing) para captar leads/eleitores sem login.
-- Todo acesso é mediado pelo backend Express usando service_role; o role anon
-- NUNCA toca estas tabelas diretamente (mais seguro). Por isso só há policy de
-- service_role — anon/authenticated ficam sem acesso direto.

CREATE TABLE IF NOT EXISTS public.public_forms (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       uuid NOT NULL,
  slug              text UNIQUE NOT NULL,
  title             text NOT NULL,
  description       text,
  target            text NOT NULL DEFAULT 'contacts',
  schema            jsonb NOT NULL DEFAULT '[]'::jsonb,  -- array de CustomField
  success_message   text,
  is_active         boolean NOT NULL DEFAULT true,
  submissions_count integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.form_submissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id     uuid NOT NULL REFERENCES public.public_forms(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_id  uuid,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_public_forms_campaign   ON public.public_forms(campaign_id);
CREATE INDEX IF NOT EXISTS idx_public_forms_slug       ON public.public_forms(slug);
CREATE INDEX IF NOT EXISTS idx_form_submissions_form   ON public.form_submissions(form_id);

ALTER TABLE public.public_forms     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "svc bypass public_forms" ON public.public_forms;
CREATE POLICY "svc bypass public_forms" ON public.public_forms
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "svc bypass form_submissions" ON public.form_submissions;
CREATE POLICY "svc bypass form_submissions" ON public.form_submissions
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
