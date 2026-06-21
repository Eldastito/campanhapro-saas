-- PR 6 — Preço do add-on avulso Blindagem Jurídico-Contábil.
-- Add-on puro: não entra em nenhum plano; acesso só via tenant_module_entitlements
-- (compra avulsa). A tabela module_prices é a fonte autoritativa de preço
-- (lida pelo addonRouter no checkout e pelo modulesRouter no cross-sell).
INSERT INTO module_prices ("moduleKey", "monthlyCents", active)
VALUES ('legal_shield', 250000, TRUE)   -- R$ 2.500,00/mês (ajustável depois)
ON CONFLICT ("moduleKey") DO UPDATE SET
  "monthlyCents" = EXCLUDED."monthlyCents",
  active         = EXCLUDED.active,
  "updatedAt"    = NOW();

NOTIFY pgrst, 'reload schema';
