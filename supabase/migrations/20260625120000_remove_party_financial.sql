-- Remoção do módulo financeiro do PARTIDO.
-- Decisão de produto: o módulo do partido NÃO movimenta mais dinheiro. Repasse,
-- válvula, recorrência e declarações de pagamento (candidato↔equipe) saem por
-- inteiro. Ficam: comitês, geolocalização, equipe, check-ins, metas/score, telão.
-- O presidente autorizou DROP total (dados financeiros não devem mais existir).

-- 1. Tabelas 100% financeiras
DROP TABLE IF EXISTS public.party_valve_log CASCADE;
DROP TABLE IF EXISTS public.party_recurring_repasses CASCADE;
DROP TABLE IF EXISTS public.party_repasses CASCADE;

-- 2. Colunas de dinheiro/válvula em party_candidates
ALTER TABLE public.party_candidates
  DROP COLUMN IF EXISTS "valorRecebido",
  DROP COLUMN IF EXISTS "valorAlocado",
  DROP COLUMN IF EXISTS "repasseStatus",
  DROP COLUMN IF EXISTS "valveNote",
  DROP COLUMN IF EXISTS "valveUpdatedAt";

-- 3. Colunas de declaração de pagamento em party_member_invites
ALTER TABLE public.party_member_invites
  DROP COLUMN IF EXISTS "valorPago",
  DROP COLUMN IF EXISTS "dataPago",
  DROP COLUMN IF EXISTS "valorRecebido",
  DROP COLUMN IF EXISTS "dataRecebido";

-- Recarrega o cache de schema do PostgREST (senão 404 em colunas novas/removidas).
NOTIFY pgrst, 'reload schema';
