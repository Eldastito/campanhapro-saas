-- =============================================
-- PARTE 1: Extensions e Tabelas Core
-- Execute este bloco PRIMEIRO no SQL Editor do Supabase
-- =============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    plan TEXT CHECK (plan IN ('Essencial', 'Estrategico', 'Total')),
    type TEXT CHECK (type IN ('Admin', 'Líder', 'Apoiador', 'Colaborador', 'Pesquisador', 'Candidato', 'Suporte', 'Manutenção', 'blocked')),
    role TEXT,
    phone TEXT,
    assigned_leader_id UUID REFERENCES users(id),
    cost DECIMAL(10,2),
    campaign_id TEXT,
    is_supreme_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Locations table
CREATE TABLE IF NOT EXISTS locations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    name TEXT NOT NULL,
    municipality TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Team Members table
CREATE TABLE IF NOT EXISTS team_members (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT CHECK (role IN ('Líder', 'Apoiador', 'Colaborador', 'Pesquisador', 'blocked')),
    email TEXT NOT NULL,
    password TEXT,
    phone TEXT,
    assigned_leader_id UUID REFERENCES users(id),
    added_by UUID REFERENCES users(id),
    cost DECIMAL(10,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Visits table
CREATE TABLE IF NOT EXISTS visits (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id TEXT NOT NULL,
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
    tipo_pet TEXT,
    criancas TEXT CHECK (criancas IN ('sim', 'nao')),
    solicit TEXT,
    realizada TEXT CHECK (realizada IN ('sim', 'nao')),
    lider TEXT,
    leader_id TEXT,
    interesse TEXT,
    nivel_engajamento TEXT CHECK (nivel_engajamento IN ('baixo', 'medio', 'alto')),
    observacoes_qualitativas TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Engagement Actions table
CREATE TABLE IF NOT EXISTS engagement_actions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    data DATE NOT NULL,
    apoiador TEXT NOT NULL,
    tipo TEXT CHECK (tipo IN ('Abordagem Rápida', 'Distribuição de Material', 'Evento')),
    local TEXT,
    sentimento TEXT CHECK (sentimento IN ('Positivo', 'Neutro', 'Negativo')),
    material_distribuido INTEGER,
    evento_nome TEXT,
    pessoas_contatadas INTEGER,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Incomes table
CREATE TABLE IF NOT EXISTS incomes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    data DATE NOT NULL,
    origem TEXT CHECK (origem IN ('Doação Pessoal', 'Recursos Próprios', 'Partido', 'Venda de Material', 'Outra')),
    doador TEXT,
    documento_doador TEXT,
    descricao TEXT NOT NULL,
    valor DECIMAL(15,2) NOT NULL,
    tipo_documento TEXT CHECK (tipo_documento IN ('Recibo', 'Transferência', 'Depósito', 'Outro')),
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Expenses table
CREATE TABLE IF NOT EXISTS expenses (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    data DATE NOT NULL,
    categoria TEXT CHECK (categoria IN ('Alimentação', 'Combustível', 'Aluguel de Carro', 'Aluguel de Espaço', 'Material Gráfico', 'Pessoal (Ajuda de Custo)', 'Pessoal (Salário)', 'Advogado', 'Contador', 'Eventos', 'Marketing Digital', 'Outra')),
    fornecedor TEXT,
    documento_fornecedor TEXT,
    descricao TEXT NOT NULL,
    valor DECIMAL(15,2) NOT NULL,
    nota_fiscal_url TEXT,
    status_documento TEXT CHECK (status_documento IN ('Pendente', 'Validado', 'Recusado')),
    tipo_documento TEXT CHECK (tipo_documento IN ('Nota Fiscal', 'Cupom Fiscal', 'Recibo', 'Contrato', 'Outro')),
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
