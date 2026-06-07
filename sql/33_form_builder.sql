-- 33_form_builder.sql — F5 Form Builder
--
-- IMPORTANTE: o projeto ativo (clfivmzwjydtmqobzxzb) usa colunas em camelCase
-- (campaignId, customFields, createdAt…). campaign_configs JÁ possui a coluna
-- "customFields" (jsonb) que guarda as DEFINIÇÕES de campos por alvo:
--   { "visits": [ {id,label,type,required,options?,placeholder?,help?} ], ... }
--
-- Aqui adicionamos onde GUARDAR os VALORES capturados por esses campos custom,
-- por registro de visita e de contato. Em camelCase, idempotente.

ALTER TABLE public.visits   ADD COLUMN IF NOT EXISTS "customFields" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS "customFields" jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Recarrega o cache do PostgREST após DDL.
NOTIFY pgrst, 'reload schema';
