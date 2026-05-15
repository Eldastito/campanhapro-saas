-- =============================================
-- CampanhaPro — Schema Completo para Supabase
-- Alinhado com o frontend (camelCase)
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- TABELAS CORE
-- =============================================

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    plan TEXT CHECK (plan IN ('Essencial', 'Estrategico', 'Total')),
    type TEXT CHECK (type IN ('Admin', 'Líder', 'Apoiador', 'Colaborador', 'Pesquisador', 'Candidato', 'Suporte', 'Manutenção', 'blocked')),
    role TEXT,
    phone TEXT,
    "assignedLeaderId" UUID REFERENCES users(id),
    cost DECIMAL(10,2),
    "campaignId" TEXT,
    "isSupremeAdmin" BOOLEAN DEFAULT FALSE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Locations table
CREATE TABLE IF NOT EXISTS locations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    name TEXT NOT NULL,
    municipality TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Team Members table
CREATE TABLE IF NOT EXISTS team_members (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT CHECK (role IN ('Líder', 'Apoiador', 'Colaborador', 'Pesquisador', 'blocked')),
    email TEXT NOT NULL,
    password TEXT,
    phone TEXT,
    "assignedLeaderId" TEXT,
    "addedBy" TEXT,
    cost DECIMAL(10,2),
    cpf TEXT,
    rg TEXT,
    "voterId" TEXT,
    address TEXT,
    neighborhood TEXT,
    city TEXT,
    state TEXT,
    zipcode TEXT,
    "bankName" TEXT,
    "bankAgency" TEXT,
    "bankAccount" TEXT,
    "pixKey" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Visits table
CREATE TABLE IF NOT EXISTS visits (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    data DATE NOT NULL,
    resp TEXT NOT NULL,
    tel TEXT,
    nasc DATE,
    municipio TEXT,
    bairro TEXT NOT NULL,
    apoiador TEXT NOT NULL,
    eleitores INTEGER,
    participantes INTEGER,
    votos INTEGER NOT NULL,
    pet TEXT CHECK (pet IN ('sim', 'nao')),
    "tipoPet" TEXT,
    criancas TEXT CHECK (criancas IN ('sim', 'nao')),
    solicit TEXT,
    realizada TEXT CHECK (realizada IN ('sim', 'nao')),
    lider TEXT,
    "leaderId" TEXT,
    interesse TEXT,
    "nivelEngajamento" TEXT CHECK ("nivelEngajamento" IN ('baixo', 'medio', 'alto')),
    "observacoesQualitativas" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Engagement Actions table
CREATE TABLE IF NOT EXISTS engagement_actions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    data DATE NOT NULL,
    apoiador TEXT NOT NULL,
    tipo TEXT CHECK (tipo IN ('Abordagem Rápida', 'Distribuição de Material', 'Evento')),
    local TEXT,
    sentimento TEXT CHECK (sentimento IN ('Positivo', 'Neutro', 'Negativo')),
    "materialDistribuido" INTEGER,
    "eventoNome" TEXT,
    "pessoasContatadas" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Incomes table
CREATE TABLE IF NOT EXISTS incomes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    data DATE NOT NULL,
    origem TEXT CHECK (origem IN ('Doação Pessoal', 'Recursos Próprios', 'Partido', 'Venda de Material', 'Outra')),
    doador TEXT,
    "documentoDoador" TEXT,
    descricao TEXT NOT NULL,
    valor DECIMAL(15,2) NOT NULL,
    "tipoDocumento" TEXT CHECK ("tipoDocumento" IN ('Recibo', 'Transferência', 'Depósito', 'Outro')),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Expenses table
CREATE TABLE IF NOT EXISTS expenses (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    data DATE NOT NULL,
    categoria TEXT CHECK (categoria IN ('Alimentação', 'Combustível', 'Aluguel de Carro', 'Aluguel de Espaço', 'Material Gráfico', 'Pessoal (Ajuda de Custo)', 'Pessoal (Salário)', 'Advogado', 'Contador', 'Eventos', 'Marketing Digital', 'Outra')),
    fornecedor TEXT,
    "documentoFornecedor" TEXT,
    descricao TEXT NOT NULL,
    valor DECIMAL(15,2) NOT NULL,
    "notaFiscalUrl" TEXT,
    "statusDocumento" TEXT CHECK ("statusDocumento" IN ('Pendente', 'Validado', 'Recusado')),
    "tipoDocumento" TEXT CHECK ("tipoDocumento" IN ('Nota Fiscal', 'Cupom Fiscal', 'Recibo', 'Contrato', 'Outro')),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- TABELAS DE CONFIGURAÇÃO
-- =============================================

-- Settings (configurações visuais e de campanha)
CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    "campaignDetails" JSONB,
    "headerLogo" TEXT,
    "footerLogo" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Campaign Configs (permissões e features por campanha)
CREATE TABLE IF NOT EXISTS campaign_configs (
    id TEXT PRIMARY KEY,
    features TEXT[],
    limits JSONB DEFAULT '{"aiCalls": 100, "teamMembers": 50, "visits": 10000}'::jsonb,
    "customFields" JSONB DEFAULT '{}'::jsonb,
    "profilePermissions" JSONB,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Calculator Settings (configurações da calculadora por campanha)
CREATE TABLE IF NOT EXISTS calculator_settings (
    id TEXT PRIMARY KEY,
    "idealScenarioId" TEXT,
    "calcState" JSONB,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Scenarios (cenários da calculadora eleitoral)
CREATE TABLE IF NOT EXISTS scenarios (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    name TEXT NOT NULL,
    meta INTEGER NOT NULL,
    eleicao TEXT NOT NULL,
    ds INTEGER NOT NULL,
    vpf INTEGER NOT NULL,
    cap INTEGER NOT NULL,
    buff DECIMAL(5,2) NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- TABELAS DE BACKUP E MIGRAÇÃO
-- =============================================

-- Backups
CREATE TABLE IF NOT EXISTS backups (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'Backup Manual',
    data TEXT NOT NULL,
    stats JSONB,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- TABELAS DE IA E AGENTES
-- =============================================

-- Agent Outputs (resultados das pipelines de IA)
CREATE TABLE IF NOT EXISTS agent_outputs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    input JSONB,
    output JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Content Briefs (briefings de conteúdo gerados por IA)
CREATE TABLE IF NOT EXISTS content_briefs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    tema TEXT NOT NULL,
    formato TEXT,
    "tomDeVoz" TEXT,
    status TEXT DEFAULT 'pendente',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Neighborhood Flags (sinalizações táticas de bairros)
CREATE TABLE IF NOT EXISTS neighborhood_flags (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    bairro TEXT NOT NULL,
    status TEXT NOT NULL,
    motivo TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Field Tickets (ordens de serviço para equipe de campo)
CREATE TABLE IF NOT EXISTS field_tickets (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    bairro TEXT NOT NULL,
    instrucao TEXT NOT NULL,
    prioridade TEXT CHECK (prioridade IN ('Alta', 'Media', 'Baixa')),
    status TEXT DEFAULT 'aberto' CHECK (status IN ('aberto', 'em_andamento', 'concluido')),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- AI Usage (logs detalhados de consumo de tokens de IA)
CREATE TABLE IF NOT EXISTS ai_usage (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT,
    "userId" TEXT,
    model TEXT,
    "promptTokens" INTEGER DEFAULT 0,
    "responseTokens" INTEGER DEFAULT 0,
    "totalTokens" INTEGER DEFAULT 0,
    "estimatedCost" DECIMAL(10,6) DEFAULT 0,
    endpoint TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Platform Stats (estatísticas agregadas)
CREATE TABLE IF NOT EXISTS platform_stats (
    id TEXT PRIMARY KEY,
    "campaignId" TEXT,
    "totalTokens" BIGINT DEFAULT 0,
    "totalCost" DECIMAL(10,4) DEFAULT 0,
    "lastUpdated" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pesquisas (pesquisa eleitoral)
CREATE TABLE IF NOT EXISTS pesquisas (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    data DATE NOT NULL,
    "entrevistadorId" UUID REFERENCES users(id),
    bairro TEXT NOT NULL,
    genero TEXT CHECK (genero IN ('masculino', 'feminino', 'outro', 'nao_informado')),
    "faixaEtaria" TEXT CHECK ("faixaEtaria" IN ('16-24', '25-34', '35-44', '45-59', '60+')),
    "intencaoVoto" TEXT CHECK ("intencaoVoto" IN ('candidato', 'outro', 'branco/nulo', 'indeciso')),
    "fatorRejeicao" TEXT CHECK ("fatorRejeicao" IN ('corrupcao', 'extremismo', 'inexperiencia', 'propostas_ruins', 'nenhum')),
    "consumoNoticias" TEXT CHECK ("consumoNoticias" IN ('whatsapp', 'instagram', 'facebook', 'tv', 'boca_a_boca', 'igreja', 'outros')),
    "dorImediata" TEXT CHECK ("dorImediata" IN ('saude', 'educacao', 'seguranca', 'transporte', 'emprego', 'infraestrutura', 'lazer')),
    "notaBairro" INTEGER CHECK ("notaBairro" >= 1 AND "notaBairro" <= 5),
    "perfilRespostas" TEXT[],
    "perfilDisc" TEXT CHECK ("perfilDisc" IN ('D', 'I', 'S', 'C')),
    observacoes TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Street Reports (reportes de rua/voluntários)
CREATE TABLE IF NOT EXISTS street_reports (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    bairro TEXT NOT NULL,
    clima TEXT CHECK (clima IN ('Positivo', 'Neutro', 'Negativo')),
    reclamacao TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- ENABLE ROW LEVEL SECURITY
-- =============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE incomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculator_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE neighborhood_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE pesquisas ENABLE ROW LEVEL SECURITY;
ALTER TABLE street_reports ENABLE ROW LEVEL SECURITY;

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Função para verificar se o usuário é Supreme Admin
CREATE OR REPLACE FUNCTION is_supreme_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() 
    AND ("isSupremeAdmin" = TRUE OR email = 'eldastito@gmail.com')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para obter o campaignId do usuário atual
CREATE OR REPLACE FUNCTION get_user_campaign_id()
RETURNS TEXT AS $$
BEGIN
  RETURN (SELECT "campaignId" FROM users WHERE id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para atualizar updatedAt automaticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger nas tabelas com updatedAt
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['users', 'team_members', 'visits', 'settings', 'campaign_configs', 'calculator_settings', 'field_tickets'])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', tbl);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()', tbl);
  END LOOP;
END;
$$;

-- =============================================
-- RLS POLICIES — USERS
-- =============================================
DROP POLICY IF EXISTS "users_select_own" ON users;
DROP POLICY IF EXISTS "users_select_supreme" ON users;
DROP POLICY IF EXISTS "users_insert_own" ON users;
DROP POLICY IF EXISTS "users_update_own" ON users;
DROP POLICY IF EXISTS "users_update_supreme" ON users;

CREATE POLICY "users_select_own" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_select_supreme" ON users FOR SELECT USING (is_supreme_admin());
CREATE POLICY "users_insert_own" ON users FOR INSERT WITH CHECK (auth.uid() = id OR is_supreme_admin());
CREATE POLICY "users_update_own" ON users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "users_update_supreme" ON users FOR UPDATE USING (is_supreme_admin());

-- =============================================
-- RLS POLICIES — CAMPAIGN DATA (padrão por campaignId)
-- =============================================

-- Macro para criar policies em tabelas com campaignId
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'visits', 'engagement_actions', 'team_members', 'locations', 
    'incomes', 'expenses', 'scenarios', 'backups',
    'agent_outputs', 'content_briefs', 'neighborhood_flags', 
    'field_tickets', 'pesquisas', 'street_reports'
  ])
  LOOP
    -- Drop existing policies
    EXECUTE format('DROP POLICY IF EXISTS "%s_select" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON %I', tbl, tbl);
    
    -- SELECT: usuário da mesma campanha OU supreme admin
    EXECUTE format('CREATE POLICY "%s_select" ON %I FOR SELECT USING ("campaignId" = get_user_campaign_id() OR is_supreme_admin())', tbl, tbl);
    
    -- INSERT: usuário da mesma campanha OU supreme admin
    EXECUTE format('CREATE POLICY "%s_insert" ON %I FOR INSERT WITH CHECK ("campaignId" = get_user_campaign_id() OR is_supreme_admin())', tbl, tbl);
    
    -- UPDATE: usuário da mesma campanha OU supreme admin
    EXECUTE format('CREATE POLICY "%s_update" ON %I FOR UPDATE USING ("campaignId" = get_user_campaign_id() OR is_supreme_admin())', tbl, tbl);
    
    -- DELETE: usuário da mesma campanha OU supreme admin
    EXECUTE format('CREATE POLICY "%s_delete" ON %I FOR DELETE USING ("campaignId" = get_user_campaign_id() OR is_supreme_admin())', tbl, tbl);
  END LOOP;
END;
$$;

-- =============================================
-- RLS POLICIES — SETTINGS (por ID = campaignId)
-- =============================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['settings', 'campaign_configs', 'calculator_settings'])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_select" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON %I', tbl, tbl);
    
    EXECUTE format('CREATE POLICY "%s_select" ON %I FOR SELECT USING (id = get_user_campaign_id() OR is_supreme_admin())', tbl, tbl);
    EXECUTE format('CREATE POLICY "%s_insert" ON %I FOR INSERT WITH CHECK (id = get_user_campaign_id() OR is_supreme_admin())', tbl, tbl);
    EXECUTE format('CREATE POLICY "%s_update" ON %I FOR UPDATE USING (id = get_user_campaign_id() OR is_supreme_admin())', tbl, tbl);
  END LOOP;
END;
$$;

-- =============================================
-- RLS POLICIES — PLATFORM (apenas Supreme Admin)
-- =============================================
DROP POLICY IF EXISTS "ai_usage_select" ON ai_usage;
DROP POLICY IF EXISTS "ai_usage_insert" ON ai_usage;
DROP POLICY IF EXISTS "platform_stats_select" ON platform_stats;
DROP POLICY IF EXISTS "platform_stats_insert" ON platform_stats;
DROP POLICY IF EXISTS "platform_stats_update" ON platform_stats;

-- AI Usage: Supreme admin pode ler, servidor pode inserir (via service_role bypass RLS)
CREATE POLICY "ai_usage_select" ON ai_usage FOR SELECT USING (is_supreme_admin());
CREATE POLICY "ai_usage_insert" ON ai_usage FOR INSERT WITH CHECK (true); -- Inserido pelo server via service_role

-- Platform Stats: Supreme admin lê e escreve
CREATE POLICY "platform_stats_select" ON platform_stats FOR SELECT USING (is_supreme_admin());
CREATE POLICY "platform_stats_insert" ON platform_stats FOR INSERT WITH CHECK (is_supreme_admin());
CREATE POLICY "platform_stats_update" ON platform_stats FOR UPDATE USING (is_supreme_admin());

-- =============================================
-- INDEXES PARA PERFORMANCE
-- =============================================
CREATE INDEX IF NOT EXISTS idx_visits_campaign ON visits("campaignId");
CREATE INDEX IF NOT EXISTS idx_visits_data ON visits(data);
CREATE INDEX IF NOT EXISTS idx_engagement_campaign ON engagement_actions("campaignId");
CREATE INDEX IF NOT EXISTS idx_incomes_campaign ON incomes("campaignId");
CREATE INDEX IF NOT EXISTS idx_expenses_campaign ON expenses("campaignId");
CREATE INDEX IF NOT EXISTS idx_team_campaign ON team_members("campaignId");
CREATE INDEX IF NOT EXISTS idx_locations_campaign ON locations("campaignId");
CREATE INDEX IF NOT EXISTS idx_scenarios_campaign ON scenarios("campaignId");
CREATE INDEX IF NOT EXISTS idx_pesquisas_campaign ON pesquisas("campaignId");
CREATE INDEX IF NOT EXISTS idx_backups_campaign ON backups("campaignId");
CREATE INDEX IF NOT EXISTS idx_ai_usage_campaign ON ai_usage("campaignId");
CREATE INDEX IF NOT EXISTS idx_agent_outputs_campaign ON agent_outputs("campaignId");

-- =============================================
-- SEED: Configurar contas admin
-- =============================================

-- Garantir que eldastito@gmail.com é Supreme Admin
UPDATE users SET "isSupremeAdmin" = TRUE, type = 'Admin', plan = 'Total' WHERE email = 'eldastito@gmail.com';

-- Garantir que examepad@gmail.com é Campaign Admin com acesso total
UPDATE users SET type = 'Admin', plan = 'Total' WHERE email = 'examepad@gmail.com';