-- 1. Adicionar coluna de tags (interesses) e zona/seção eleitoral se não existirem
ALTER TABLE contacts 
ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS electoral_zone text,
ADD COLUMN IF NOT EXISTS electoral_section text;

-- 2. Criar um índice para busca rápida por tags
CREATE INDEX IF NOT EXISTS idx_contacts_tags ON contacts USING GIN (tags);

-- 3. Inserir algumas tags de exemplo para os contatos existentes (Opcional - para teste)
UPDATE contacts 
SET tags = ARRAY['Saúde', 'Educação'] 
WHERE tags IS NULL OR tags = '{}';
