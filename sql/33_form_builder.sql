-- 33_form_builder.sql — F5 Form Builder
--
-- As DEFINIÇÕES de campos personalizáveis por campanha (por alvo: visits,
-- contacts, pesquisa) já vivem em campaign_configs.custom_fields (jsonb).
-- Estrutura: { "visits": [ {id,label,type,required,options?,placeholder?,help?} ], ... }
--
-- Este arquivo adiciona onde GUARDAR os VALORES capturados por esses campos
-- custom, por registro. Idempotente.

ALTER TABLE public.visits   ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

-- F5b (futuro): formulários públicos (landing/lead capture) terão tabelas
-- próprias (public_forms, form_submissions) com RLS para acesso anônimo.
