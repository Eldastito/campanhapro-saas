-- Vincula um contrato a uma campanha (tenant) para reaproveitar o cadastro da
-- campanha (pré-preenchimento do contratante) e exibir o contrato no
-- perfil/faturamento do próprio cliente.
--
-- Nullable de propósito: contrato firmado com um contratante externo (que não é
-- uma campanha da plataforma) continua válido sem campanha vinculada.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS "campaignId" text;
CREATE INDEX IF NOT EXISTS idx_contracts_campaign ON contracts ("campaignId");

-- Sem isto o PostgREST devolve 404 na coluna nova.
NOTIFY pgrst, 'reload schema';
