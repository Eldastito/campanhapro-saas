-- =============================================
-- PARTE 2: Tabelas de Configuração e Auxiliares
-- Execute DEPOIS da Parte 1
-- =============================================

-- Settings (configurações visuais e de campanha)
CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    campaign_details JSONB,
    header_logo TEXT,
    footer_logo TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Campaign Configs (permissões e features por campanha)
CREATE TABLE IF NOT EXISTS campaign_configs (
    id TEXT PRIMARY KEY,
    features TEXT[],
    limits JSONB DEFAULT '{"aiCalls": 100, "teamMembers": 50, "visits": 10000}'::jsonb,
    custom_fields JSONB DEFAULT '{}'::jsonb,
    profile_permissions JSONB,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Calculator Settings
CREATE TABLE IF NOT EXISTS calculator_settings (
    id TEXT PRIMARY KEY,
    ideal_scenario_id TEXT,
    calc_state JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Scenarios (calculadora eleitoral)
CREATE TABLE IF NOT EXISTS scenarios (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    name TEXT NOT NULL,
    meta INTEGER NOT NULL,
    eleicao TEXT NOT NULL,
    ds INTEGER NOT NULL,
    vpf INTEGER NOT NULL,
    cap INTEGER NOT NULL,
    buff DECIMAL(5,2) NOT NULL,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Backups
CREATE TABLE IF NOT EXISTS backups (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'Backup Manual',
    data TEXT NOT NULL,
    stats JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agent Outputs (resultados das pipelines de IA)
CREATE TABLE IF NOT EXISTS agent_outputs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    input JSONB,
    output JSONB,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Content Briefs
CREATE TABLE IF NOT EXISTS content_briefs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    tema TEXT NOT NULL,
    formato TEXT,
    tom_de_voz TEXT,
    status TEXT DEFAULT 'pendente',
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Neighborhood Flags
CREATE TABLE IF NOT EXISTS neighborhood_flags (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    bairro TEXT NOT NULL,
    status TEXT NOT NULL,
    motivo TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Field Tickets
CREATE TABLE IF NOT EXISTS field_tickets (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    bairro TEXT NOT NULL,
    instrucao TEXT NOT NULL,
    prioridade TEXT CHECK (prioridade IN ('Alta', 'Media', 'Baixa')),
    status TEXT DEFAULT 'aberto' CHECK (status IN ('aberto', 'em_andamento', 'concluido')),
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- AI Usage
CREATE TABLE IF NOT EXISTS ai_usage (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id TEXT,
    user_id TEXT,
    model TEXT,
    prompt_tokens INTEGER DEFAULT 0,
    response_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    estimated_cost DECIMAL(10,6) DEFAULT 0,
    endpoint TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Platform Stats
CREATE TABLE IF NOT EXISTS platform_stats (
    id TEXT PRIMARY KEY,
    campaign_id TEXT,
    total_tokens BIGINT DEFAULT 0,
    total_cost DECIMAL(10,4) DEFAULT 0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pesquisas
CREATE TABLE IF NOT EXISTS pesquisas (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    data DATE NOT NULL,
    entrevistador_id UUID REFERENCES users(id),
    bairro TEXT NOT NULL,
    genero TEXT CHECK (genero IN ('masculino', 'feminino', 'outro', 'nao_informado')),
    faixa_etaria TEXT CHECK (faixa_etaria IN ('16-24', '25-34', '35-44', '45-59', '60+')),
    intencao_voto TEXT CHECK (intencao_voto IN ('candidato', 'outro', 'branco/nulo', 'indeciso')),
    fator_rejeicao TEXT CHECK (fator_rejeicao IN ('corrupcao', 'extremismo', 'inexperiencia', 'propostas_ruins', 'nenhum')),
    consumo_noticias TEXT CHECK (consumo_noticias IN ('whatsapp', 'instagram', 'facebook', 'tv', 'boca_a_boca', 'igreja', 'outros')),
    dor_imediata TEXT CHECK (dor_imediata IN ('saude', 'educacao', 'seguranca', 'transporte', 'emprego', 'infraestrutura', 'lazer')),
    nota_bairro INTEGER CHECK (nota_bairro >= 1 AND nota_bairro <= 5),
    perfil_respostas TEXT[],
    perfil_disc TEXT CHECK (perfil_disc IN ('D', 'I', 'S', 'C')),
    observacoes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Street Reports
CREATE TABLE IF NOT EXISTS street_reports (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    bairro TEXT NOT NULL,
    clima TEXT CHECK (clima IN ('Positivo', 'Neutro', 'Negativo')),
    reclamacao TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
