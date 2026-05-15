-- Tabela para armazenar tokens de acesso de mídias sociais
CREATE TABLE IF NOT EXISTS social_tokens (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    provider TEXT NOT NULL, -- 'meta', 'instagram', 'facebook', 'whatsapp'
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    settings JSONB DEFAULT '{}',
    UNIQUE("campaignId", provider)
);

-- Habilitar RLS
ALTER TABLE social_tokens ENABLE ROW LEVEL SECURITY;

-- Política de acesso (apenas admins da campanha podem ver/editar)
CREATE POLICY "Admins can manage social tokens" ON social_tokens
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users."campaignId" = social_tokens."campaignId"
            AND users.role = 'Admin'
        )
    );
