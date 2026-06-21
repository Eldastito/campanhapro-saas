-- Campos exigidos pelo TSE/SPCE na prestação de contas eleitoral, que faltavam
-- nos formulários de receita/despesa do Financeiro.
--
-- RECEITA: espécie (financeira × estimável), fonte do recurso na taxonomia do
-- TSE (FEFC/Fundo Partidário/internet/etc.), conta receptora e nº do recibo
-- eleitoral. DESPESA: forma de pagamento, tipo de gasto (taxonomia TSE) e data
-- de pagamento (distinta da data do fato gerador).
--
-- incomes/expenses usam camelCase (com aspas) — confirmado no information_schema
-- (o arquivo sql/01_*.sql está desatualizado). Colunas aditivas e nullable: não
-- quebram dados nem dashboards existentes (origem/categoria permanecem).
ALTER TABLE incomes
  ADD COLUMN IF NOT EXISTS "especie"         text,
  ADD COLUMN IF NOT EXISTS "fonteRecurso"    text,
  ADD COLUMN IF NOT EXISTS "contaReceptora"  text,
  ADD COLUMN IF NOT EXISTS "reciboEleitoral" text;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS "formaPagamento" text,
  ADD COLUMN IF NOT EXISTS "tipoGasto"      text,
  ADD COLUMN IF NOT EXISTS "dataPagamento"  date;

-- Sem isto o PostgREST devolve 404 nas colunas novas.
NOTIFY pgrst, 'reload schema';
