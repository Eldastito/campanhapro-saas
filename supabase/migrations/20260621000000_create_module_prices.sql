-- Preço de venda avulsa dos módulos (add-ons).
-- Catálogo (features/ícone/rota) continua em `src/lib/modules.ts` — banco
-- guarda só o preço, pra dar de ajustar sem deploy igual fazemos em `plans`.
-- Quem assina um plano que já carrega a feature do módulo NÃO paga add-on:
-- a inclusão automática vive em PLAN_FEATURE_TO_MODULE + modulesRouter.

CREATE TABLE IF NOT EXISTS module_prices (
  "moduleKey"    TEXT PRIMARY KEY,             -- bate com MODULES[].key
  "monthlyCents" INTEGER NOT NULL DEFAULT 0,   -- BRL cents, mesmo padrão de `plans`
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE module_prices ENABLE ROW LEVEL SECURITY;

-- Leitura pública: a página comercial mostra preço sem login.
CREATE POLICY "module_prices_public_read"
  ON module_prices FOR SELECT
  USING (active = TRUE);

-- Seed: Cenários e Inteligência a R$ 2.000/mês cada (decisão do produto:
-- âncora baixa pra unbundle ser atrativo a quem está no Essencial).
INSERT INTO module_prices ("moduleKey", "monthlyCents", active) VALUES
  ('cenarios',    200000, TRUE),
  ('inteligencia', 200000, TRUE)
ON CONFLICT ("moduleKey") DO UPDATE SET
  "monthlyCents" = EXCLUDED."monthlyCents",
  active         = EXCLUDED.active,
  "updatedAt"    = NOW();

NOTIFY pgrst, 'reload schema';
