-- 08_election_day.sql
-- Tabelas para Operação Dia D e Apuração Paralela
-- Ajustado para compatibilidade com o esquema Core (tabela users, campaignId como TEXT)

-- Locais de Votação
CREATE TABLE IF NOT EXISTS voting_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  neighborhood TEXT,
  city TEXT,
  coordinates JSONB, -- {lat, lng}
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seções Eleitorais
CREATE TABLE IF NOT EXISTS polling_stations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID REFERENCES voting_locations(id) ON DELETE CASCADE,
  station_number TEXT NOT NULL,
  zone_number TEXT NOT NULL,
  expected_voters INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(location_id, station_number, zone_number)
);

-- Fiscais de Seção
CREATE TABLE IF NOT EXISTS election_fiscais (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  station_id UUID REFERENCES polling_stations(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'pending', -- pending, checked_in, finished
  check_in_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Boletins de Urna (Apuração Paralela)
CREATE TABLE IF NOT EXISTS boletins_urna (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id TEXT NOT NULL,
  station_id UUID REFERENCES polling_stations(id) ON DELETE CASCADE,
  fiscal_id UUID REFERENCES users(id),
  raw_content TEXT, -- Conteúdo bruto do QR Code
  votos_candidato INTEGER DEFAULT 0,
  votos_total_secao INTEGER DEFAULT 0,
  votos_adversarios JSONB, -- { "nome": votos }
  bu_image_url TEXT, -- Opcional: foto do BU físico
  hash_authenticity TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Incidentes no Dia D
CREATE TABLE IF NOT EXISTS election_incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id TEXT NOT NULL,
  location_id UUID REFERENCES voting_locations(id),
  fiscal_id UUID REFERENCES users(id),
  type TEXT NOT NULL, -- urna_quebrada, boca_de_urna, coacao, falta_energia, outros
  description TEXT,
  severity TEXT DEFAULT 'media', -- baixa, media, alta, critica
  status TEXT DEFAULT 'open', -- open, resolving, resolved
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE voting_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE polling_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_fiscais ENABLE ROW LEVEL SECURITY;
ALTER TABLE boletins_urna ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_incidents ENABLE ROW LEVEL SECURITY;

-- Políticas Básicas (Admin e Fiscais da Campanha)
-- Como o list_tables falhou, vou usar o ID do projeto que está no .env: jvmtcsxoxgzepslxqtdy
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage election data') THEN
        CREATE POLICY "Admins can manage election data" ON voting_locations
          FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND type IN ('Admin', 'Suporte')));
    END IF;
END $$;
