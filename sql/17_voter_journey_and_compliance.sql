-- 17_voter_journey_and_compliance.sql
-- Implementação da Jornada do Eleitor, Compliance LGPD e Auditoria de IA

-- 1. Tabela de Jornada do Eleitor (Unificação de CRM e Inteligência)
CREATE TABLE IF NOT EXISTS voter_journey (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  current_stage TEXT NOT NULL DEFAULT 'capturado', -- capturado, validado, interessado, apoiador_confirmado, multiplicador, descadastrado, risco_rejeicao
  previous_stage TEXT,
  trust_score INTEGER DEFAULT 0, -- 0-100 (Confiança na intenção de voto)
  engagement_score INTEGER DEFAULT 0, -- 0-100 (Atividade na campanha)
  fraud_risk_score INTEGER DEFAULT 0, -- 0-100 (Risco de ser dado falso)
  consent_status TEXT DEFAULT 'unknown', -- unknown, granted, revoked
  next_best_action TEXT, -- Recomendação tática da IA
  next_action_reason TEXT, -- Motivo da recomendação
  last_meaningful_interaction_at TIMESTAMPTZ,
  became_supporter_at TIMESTAMPTZ,
  became_multiplier_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Tabela de Registros de Consentimento (LGPD)
CREATE TABLE IF NOT EXISTS consent_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL, -- marketing, electoral_info, research
  granted BOOLEAN NOT NULL,
  source TEXT NOT NULL, -- public_capture_page, manual_entry, api
  privacy_notice_version TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Tabela de Logs de Compliance IA (Auditoria e Transparência)
CREATE TABLE IF NOT EXISTS ai_compliance_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  action_type TEXT NOT NULL, -- generation, publication, analysis
  input_summary TEXT,
  output_summary TEXT,
  used_personal_data BOOLEAN DEFAULT false,
  used_sensitive_data BOOLEAN DEFAULT false,
  ai_disclosure_required BOOLEAN DEFAULT false,
  human_approved BOOLEAN DEFAULT false,
  risk_level TEXT DEFAULT 'baixo', -- baixo, medio, alto, critico
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Expansão da Tabela de Pesquisas para Antifraude
DO $$ 
BEGIN 
    -- Adicionar colunas se não existirem
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pesquisas' AND column_name='started_at') THEN
        ALTER TABLE pesquisas ADD COLUMN started_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pesquisas' AND column_name='submitted_at') THEN
        ALTER TABLE pesquisas ADD COLUMN submitted_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pesquisas' AND column_name='duration_seconds') THEN
        ALTER TABLE pesquisas ADD COLUMN duration_seconds INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pesquisas' AND column_name='gps_lat') THEN
        ALTER TABLE pesquisas ADD COLUMN gps_lat DOUBLE PRECISION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pesquisas' AND column_name='gps_lng') THEN
        ALTER TABLE pesquisas ADD COLUMN gps_lng DOUBLE PRECISION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pesquisas' AND column_name='device_fingerprint_hash') THEN
        ALTER TABLE pesquisas ADD COLUMN device_fingerprint_hash TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pesquisas' AND column_name='fraud_risk_score') THEN
        ALTER TABLE pesquisas ADD COLUMN fraud_risk_score INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pesquisas' AND column_name='audit_status') THEN
        ALTER TABLE pesquisas ADD COLUMN audit_status TEXT DEFAULT 'pending' CHECK (audit_status IN ('pending', 'approved', 'flagged', 'rejected'));
    END IF;
END $$;

-- 5. Configuração de RLS
ALTER TABLE voter_journey ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_compliance_logs ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso por campaign_id (Padrão CampanhaPro)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['voter_journey', 'consent_records', 'ai_compliance_logs'])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_select" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON %I', tbl, tbl);
    
    EXECUTE format('CREATE POLICY "%s_select" ON %I FOR SELECT USING (campaign_id = (SELECT campaign_id FROM users WHERE id = auth.uid()) OR (SELECT is_supreme_admin FROM users WHERE id = auth.uid()))', tbl, tbl);
    EXECUTE format('CREATE POLICY "%s_insert" ON %I FOR INSERT WITH CHECK (campaign_id = (SELECT campaign_id FROM users WHERE id = auth.uid()) OR (SELECT is_supreme_admin FROM users WHERE id = auth.uid()))', tbl, tbl);
    EXECUTE format('CREATE POLICY "%s_update" ON %I FOR UPDATE USING (campaign_id = (SELECT campaign_id FROM users WHERE id = auth.uid()) OR (SELECT is_supreme_admin FROM users WHERE id = auth.uid()))', tbl, tbl);
  END LOOP;
END;
$$;

-- 6. Trigger para atualização de updatedAt na voter_journey
DROP TRIGGER IF EXISTS set_updated_at ON voter_journey;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON voter_journey FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 7. Índices para performance
CREATE INDEX IF NOT EXISTS idx_voter_journey_campaign ON voter_journey(campaign_id);
CREATE INDEX IF NOT EXISTS idx_voter_journey_contact ON voter_journey(contact_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_contact ON consent_records(contact_id);
CREATE INDEX IF NOT EXISTS idx_ai_compliance_campaign ON ai_compliance_logs(campaign_id);
