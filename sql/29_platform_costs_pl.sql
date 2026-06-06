-- =============================================
-- PARTE 29: Custos operacionais + P&L do Supreme Admin (complemento da F3)
--
-- (1) Tabela platform_costs — custos do operador SaaS: infraestrutura,
--     assinaturas de IA, impostos, pessoal, marketing, outros.
-- (2) supreme_financial_metrics(p_usd_brl) atualizada com seções:
--     - costs: total mensal + por categoria + itens
--     - profitLoss: receita - custos fixos - custo IA variável = lucro,
--       com margem %. Custo de IA (USD, agent_runs 30d) convertido a BRL.
--
-- Endpoints: GET/POST/PATCH/DELETE /api/v1/supreme/costs.
-- Execute no SQL Editor do Supabase. Idempotente.
-- A definição completa da função está aplicada via migration; este arquivo
-- documenta a tabela. (A função vive em 27_supreme_financial.sql atualizado.)
-- =============================================

CREATE TABLE IF NOT EXISTS platform_costs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN ('infraestrutura','ia','impostos','pessoal','marketing','outros')),
    description TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL CHECK ("amountCents" >= 0),
    recurrence TEXT NOT NULL DEFAULT 'monthly' CHECK (recurrence IN ('monthly','once')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    "referenceMonth" DATE,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_costs_active ON platform_costs(active, category);

ALTER TABLE platform_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages platform costs" ON platform_costs;
CREATE POLICY "service role manages platform costs" ON platform_costs
    FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
