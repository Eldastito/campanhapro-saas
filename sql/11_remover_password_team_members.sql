-- Remove coluna password de team_members.
-- Senhas de acesso pertencem exclusivamente ao Supabase Auth (auth.users).
-- Armazenar senha em tabela operacional é risco de segurança independente de estar em uso.
ALTER TABLE team_members DROP COLUMN IF EXISTS password;
