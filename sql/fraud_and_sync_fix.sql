-- Padronização da tabela war_room_intelligence e Criação do sistema de Antifraude
-- Autor: Antigravity AI

-- 1. Padronizar war_room_intelligence para snake_case (criando colunas se não existirem)
DO $$
BEGIN
    -- campaign_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'war_room_intelligence' AND column_name = 'campaign_id') THEN
        ALTER TABLE war_room_intelligence ADD COLUMN campaign_id UUID;
    END IF;

    -- created_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'war_room_intelligence' AND column_name = 'created_at') THEN
        ALTER TABLE war_room_intelligence ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- 2. Tabela de Auditoria de Fraude (Mecanismo para o novo Agente)
CREATE TABLE IF NOT EXISTS fraud_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL, -- 'voter', 'street_report', 'volunteer'
    entity_id UUID NOT NULL,
    risk_level TEXT DEFAULT 'Baixo', -- 'Baixo', 'Médio', 'Alto', 'CRÍTICO'
    reason TEXT NOT NULL,
    detected_by TEXT DEFAULT 'FraudAuditor_AI',
    is_resolved BOOLEAN DEFAULT FALSE,
    resolved_by UUID REFERENCES users(id),
    metadata JSONB DEFAULT '{}', -- Guardará as "respostas contraditórias" identificadas
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Adicionar campo de status de auditoria na tabela de eleitores (voters) se existir
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'voters') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'voters' AND column_name = 'audit_status') THEN
            ALTER TABLE voters ADD COLUMN audit_status TEXT DEFAULT 'pending'; -- 'pending', 'verified', 'flagged'
        END IF;
    END IF;
END $$;

-- RLS para Fraud Audit Logs
ALTER TABLE fraud_audit_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins and Leaders can see fraud logs') THEN
        CREATE POLICY "Admins and Leaders can see fraud logs" ON fraud_audit_logs
          FOR ALL TO authenticated USING (campaign_id = (SELECT campaign_id FROM users WHERE id = auth.uid()));
    END IF;
END $$;
