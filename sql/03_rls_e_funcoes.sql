-- =============================================
-- PARTE 3: RLS, Funções e Triggers — PADRONIZADO
-- Execute DEPOIS da Parte 2
-- =============================================

-- Enable RLS em todas as tabelas
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'users', 'locations', 'team_members', 'visits', 'engagement_actions',
    'incomes', 'expenses', 'settings', 'campaign_configs', 'calculator_settings',
    'scenarios', 'backups', 'agent_outputs', 'content_briefs', 'neighborhood_flags',
    'field_tickets', 'ai_usage', 'platform_stats', 'pesquisas', 'street_reports'
  ])
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    END IF;
  END LOOP;
END;
$$;

-- Função: verificar Supreme Admin
CREATE OR REPLACE FUNCTION is_supreme_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
      AND (is_supreme_admin = TRUE OR email IN ('eldastito@gmail.com', 'examepad@gmail.com'))
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função: obter campaign_id do usuário atual
CREATE OR REPLACE FUNCTION get_user_campaign_id()
RETURNS UUID AS $$
BEGIN
  RETURN (SELECT campaign_id FROM users WHERE id = auth.uid() LIMIT 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função trigger: atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger nas tabelas que possuem updated_at
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'users', 'team_members', 'visits', 'settings', 
    'campaign_configs', 'calculator_settings', 'field_tickets'
  ])
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tbl
        AND column_name = 'updated_at'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', tbl);
      EXECUTE format(
        'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
        tbl
      );
    END IF;
  END LOOP;
END;
$$;
