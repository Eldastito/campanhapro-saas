-- Plano do app Partido (produto próprio, tenant = partido) — preço base R$3.000/mês.
-- Reusa a infra de módulos vendáveis: o preço vive em module_prices e a cobrança
-- por partido vive em module_subscriptions (tenantKind='party'). O acesso ao
-- módulo 'partido' continua liberado por derivação (Presidente/Candidato de
-- Partido) — esta etapa NÃO bloqueia acesso, só registra preço e cobrança.
--
-- Idempotente: se a linha já existir, mantém o preço atual (operador pode editar
-- no Supreme Control). Só cria se faltar.

INSERT INTO module_prices ("moduleKey", "monthlyCents", active)
VALUES ('partido', 300000, TRUE)
ON CONFLICT ("moduleKey") DO NOTHING;

NOTIFY pgrst, 'reload schema';
