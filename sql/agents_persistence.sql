-- Tabela para persistência total do chat dos agentes
CREATE TABLE IF NOT EXISTS agent_chat_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL, -- 'strategist', 'growth', 'social', 'field', 'creative', 'backup'
    role TEXT NOT NULL, -- 'user' ou 'agent'
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}', -- Para salvar URLs de imagens, tool_calls, etc
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela para Ordens de Produção (Estado da Linha de Montagem)
-- Isso garante que um agente "passe a bola" para o outro de forma persistente
CREATE TABLE IF NOT EXISTS production_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    origin_agent TEXT NOT NULL,
    target_agent TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'processed', 'archived'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance de busca
CREATE INDEX IF NOT EXISTS idx_agent_chat_campaign ON agent_chat_history(campaign_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_production_orders_campaign ON production_orders(campaign_id, status);
