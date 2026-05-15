-- Adicionar suporte a API Key para integrações externas
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS api_key UUID DEFAULT uuid_generate_v4();

-- Criar índice para buscas rápidas por API Key
CREATE INDEX IF NOT EXISTS idx_campaigns_api_key ON campaigns(api_key);

-- Comentário para documentação
COMMENT ON COLUMN campaigns.api_key IS 'Chave de acesso para integrações externas via API v1';

-- Novos campos para Auditoria de Integridade (Camada 3)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS data_nascimento DATE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS gps_coords TEXT; -- Formato "lat,long"
ALTER TABLE visits ADD COLUMN IF NOT EXISTS gps_coords TEXT;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS duracao_segundos INTEGER; -- Tempo de preenchimento
