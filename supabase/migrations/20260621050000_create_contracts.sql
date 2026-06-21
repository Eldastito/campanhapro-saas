-- Contratos de prestação de serviço / licenciamento de software (Supreme Control).
-- O operador da plataforma cria contratos com seus clientes, preenchendo dados
-- variáveis (empresa prestadora, empresa contratante, pessoas, cláusulas) e,
-- numa etapa seguinte, gera PDF e coleta assinaturas desenhadas na tela.
--
-- Dados variáveis ficam em jsonb (flexível pra "outros dados" / cláusulas livres).
-- Acesso: só service_role (backend supremo). Frontend nunca lê direto — RLS ON
-- sem policy = deny-all exceto service_role.

CREATE TABLE IF NOT EXISTS contracts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'signed')),
  provider    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- empresa que presta/licencia
  client      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- empresa contratante
  people      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{nome, papel, cpf, email}]
  clauses     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{titulo, texto}]
  fields      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- objeto, valor, vigência, outros
  signatures  jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{nome, papel, imageDataUrl, signedAt}]
  "createdBy" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_contracts_created ON contracts ("createdAt" DESC);

NOTIFY pgrst, 'reload schema';
