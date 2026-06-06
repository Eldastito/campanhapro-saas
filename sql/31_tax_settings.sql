-- =============================================
-- PARTE 31: Configuração fiscal manual (CNAE/regime/anexo/taxa USD) — F4
--
-- Tabela singleton tax_settings. Permite o operador sobrepor o enquadramento
-- automático (Fator R) quando o contador indicar outro anexo, e definir a
-- taxa US$→R$ usada nos custos, lucro e impostos.
--   regime: simples | presumido
--   anexo_override: auto (decide pelo Fator R) | III | V
--   cnae: código CNAE da atividade-fim (SaaS = licenciamento de software)
--   usdBrlRate: cotação do dólar usada nas conversões
--
-- Lida por GET/PUT /api/v1/supreme/tax-config e pelos endpoints /taxes e
-- /financial. Execute no SQL Editor do Supabase. Idempotente.
-- =============================================

CREATE TABLE IF NOT EXISTS tax_settings (
    id TEXT PRIMARY KEY DEFAULT 'global',
    regime TEXT NOT NULL DEFAULT 'simples' CHECK (regime IN ('simples','presumido')),
    anexo_override TEXT NOT NULL DEFAULT 'auto' CHECK (anexo_override IN ('auto','III','V')),
    cnae TEXT,
    "usdBrlRate" NUMERIC NOT NULL DEFAULT 5.40 CHECK ("usdBrlRate" > 0),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tax_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages tax settings" ON tax_settings;
CREATE POLICY "service role manages tax settings" ON tax_settings
    FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

INSERT INTO tax_settings (id, regime, anexo_override, cnae, "usdBrlRate")
VALUES ('global', 'simples', 'auto', '6203-1/00', 5.40)
ON CONFLICT (id) DO NOTHING;
