-- 10_war_room_sync.sql
-- Inteligência Compartilhada Inter-Agentes (Sala de Guerra)

CREATE TABLE IF NOT EXISTS war_room_intelligence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id TEXT NOT NULL,
    source_agent TEXT NOT NULL, -- 'CRM', 'Estrategista', 'Criativo', 'Comandante'
    target_agent TEXT, -- Opcional: Se for direcionado a um agente específico
    priority TEXT DEFAULT 'Media', -- Baixa, Media, Alta, CRÍTICO
    category TEXT, -- 'Nicho', 'Crise', 'Oportunidade', 'Logística'
    insight_text TEXT NOT NULL,
    metadata JSONB DEFAULT '{}', -- Ex: { neighborhood: 'Centro', sentiment: 'Negativo' }
    action_taken BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE war_room_intelligence ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can see war room intel') THEN
        CREATE POLICY "Users can see war room intel" ON war_room_intelligence
          FOR ALL TO authenticated USING (campaign_id = (SELECT campaign_id FROM users WHERE id = auth.uid()));
    END IF;
END $$;

-- View para facilitar a leitura do feed recente para as IAs
CREATE OR REPLACE VIEW recent_war_room_insights AS
SELECT * FROM war_room_intelligence
WHERE created_at > (now() - interval '48 hours')
ORDER BY created_at DESC
LIMIT 50;
