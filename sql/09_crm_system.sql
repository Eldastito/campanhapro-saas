-- 09_crm_system.sql
-- Sistema CRM Eleitoral Inteligente (IA-Managed)

-- Tabela Principal de Contatos (Eleitores/Apoiadores)
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  birth_date DATE,
  address TEXT,
  neighborhood TEXT,
  city TEXT,
  zip_code TEXT,
  
  -- Classificação e Inteligência
  classification TEXT DEFAULT 'Indeciso', -- Apoiador, Neutro, Rejeição, Indeciso, Multiplicador
  engagement_score INTEGER DEFAULT 0, -- 0-100
  sentiment_termometer TEXT DEFAULT 'Neutro', -- Positivo, Neutro, Negativo
  voto_estimado BOOLEAN DEFAULT NULL,
  
  -- Origem e Tags
  source TEXT DEFAULT 'Manual', -- Manual, Importação, App Externa, WhatsApp
  tags JSONB DEFAULT '[]',
  interests JSONB DEFAULT '[]',
  
  -- Metadados para IA
  ai_notes TEXT, -- Resumo gerado pela IA sobre o perfil
  last_interaction_at TIMESTAMPTZ,
  next_follow_up_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Histórico de Atendimentos / Interações
CREATE TABLE IF NOT EXISTS contact_interactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL, -- WhatsApp, Ligação, Visita, E-mail, Reunião
  notes TEXT,
  sentiment TEXT, -- Análise de sentimento da conversa
  duration_minutes INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Atividades e Tarefas (To-do List do CRM)
CREATE TABLE IF NOT EXISTS contact_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  priority TEXT DEFAULT 'Media', -- Baixa, Media, Alta, Urgente
  status TEXT DEFAULT 'Pendente', -- Pendente, Concluído, Cancelado
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Recomendações Pró-ativas da IA
CREATE TABLE IF NOT EXISTS ai_crm_recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  reason TEXT, -- Ex: "Aniversariante influente", "Lead esfriando"
  suggested_action TEXT, -- Ex: "Ligar para parabenizar", "Enviar vídeo de proposta X"
  status TEXT DEFAULT 'Pendente', -- Pendente, Aceito, Ignorado
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_crm_recommendations ENABLE ROW LEVEL SECURITY;

-- Políticas (Simplificadas para o contexto de campanha)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can see campaign contacts') THEN
        CREATE POLICY "Users can see campaign contacts" ON contacts
          FOR ALL TO authenticated USING (campaign_id = (SELECT campaign_id FROM users WHERE id = auth.uid()));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can see interactions') THEN
        CREATE POLICY "Users can see interactions" ON contact_interactions
          FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM contacts WHERE id = contact_interactions.contact_id AND campaign_id = (SELECT campaign_id FROM users WHERE id = auth.uid())));
    END IF;
END $$;
