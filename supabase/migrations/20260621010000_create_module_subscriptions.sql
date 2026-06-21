-- Assinatura recorrente de um add-on (módulo vendido avulso).
-- Espelha `subscriptions`, mas em vez de planId carrega moduleKey. O motivo de
-- não reusar `subscriptions` é prático: a UNIQUE index dela impõe 1 assinatura
-- ATIVA por campanha, o que faz sentido pra plano mas não pra add-on (a mesma
-- campanha pode contratar Cenários E Inteligência ao mesmo tempo).
--
-- Decisão arquitetural (validada): no Asaas cada add-on é uma assinatura
-- separada (a API não tem "subscription items" como o Stripe).
--
-- Quando o pagamento confirma (webhook 'paid'), o backend escreve em
-- `tenant_module_entitlements` (source='addon:asaas') — é dali que o Hub e o
-- featureGate enxergam o módulo ativo. Esta tabela é o LADO DA COBRANÇA;
-- entitlement é o LADO DO ACESSO. Mantemos separados pra cancelamento manual
-- (supremo admin) continuar funcionando independente do gateway.

CREATE TABLE IF NOT EXISTS module_subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"              TEXT NOT NULL,
  "tenantKind"            TEXT NOT NULL CHECK ("tenantKind" IN ('campaign', 'party')),
  "moduleKey"             TEXT NOT NULL REFERENCES module_prices("moduleKey"),
  status                  TEXT NOT NULL DEFAULT 'pending_payment'
                            CHECK (status IN ('pending_payment', 'active', 'past_due', 'canceled')),
  "amountCents"           INTEGER NOT NULL,
  "currentPeriodStart"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "currentPeriodEnd"      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  "paymentProvider"       TEXT NOT NULL DEFAULT 'asaas',
  "asaasCustomerId"       TEXT,
  "asaasSubscriptionId"   TEXT,
  metadata                JSONB NOT NULL DEFAULT '{}',
  "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE module_subscriptions ENABLE ROW LEVEL SECURITY;

-- Tenant só vê suas próprias assinaturas de add-on (campanhas via users.campaignId).
CREATE POLICY "module_subscriptions_tenant_isolation"
  ON module_subscriptions FOR SELECT
  USING (
    "tenantKind" = 'campaign' AND "tenantId" IN (SELECT "campaignId"::text FROM users WHERE id = auth.uid())
  );

-- Lookup do webhook por asaasSubscriptionId precisa ser barato.
CREATE INDEX IF NOT EXISTS idx_module_subscriptions_asaas_sub
  ON module_subscriptions ("asaasSubscriptionId")
  WHERE "asaasSubscriptionId" IS NOT NULL;

-- Só pode existir UMA assinatura "viva" por (tenant, módulo). Evita double-charge
-- se o usuário clica "Contratar" duas vezes. canceled fica fora (pode reassinar).
CREATE UNIQUE INDEX IF NOT EXISTS uq_module_subscriptions_active
  ON module_subscriptions ("tenantId", "moduleKey")
  WHERE status IN ('pending_payment', 'active', 'past_due');

NOTIFY pgrst, 'reload schema';
