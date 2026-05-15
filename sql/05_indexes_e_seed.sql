-- =============================================
-- PARTE 5: Indexes e Seed Data — versão CORRIGIDA
-- Detecta automaticamente snake_case ou camelCase
-- Execute POR ÚLTIMO
-- =============================================

-- Criar indexes dinamicamente (detecta nome real da coluna)
DO $$
DECLARE
  tbl TEXT;
  tbl_col TEXT;
  idx_name TEXT;
  tables_cols TEXT[][] := ARRAY[
    ARRAY['visits',            'idx_visits_campaign'],
    ARRAY['engagement_actions','idx_engagement_campaign'],
    ARRAY['incomes',           'idx_incomes_campaign'],
    ARRAY['expenses',          'idx_expenses_campaign'],
    ARRAY['team_members',      'idx_team_campaign'],
    ARRAY['locations',         'idx_locations_campaign'],
    ARRAY['scenarios',         'idx_scenarios_campaign'],
    ARRAY['pesquisas',         'idx_pesquisas_campaign'],
    ARRAY['backups',           'idx_backups_campaign'],
    ARRAY['ai_usage',          'idx_ai_usage_campaign'],
    ARRAY['agent_outputs',     'idx_agent_outputs_campaign'],
    ARRAY['street_reports',    'idx_street_reports_campaign'],
    ARRAY['field_tickets',     'idx_field_tickets_campaign'],
    ARRAY['content_briefs',    'idx_content_briefs_campaign'],
    ARRAY['neighborhood_flags','idx_neighborhood_flags_campaign']
  ];
  pair TEXT[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY tables_cols
  LOOP
    tbl      := pair[1];
    idx_name := pair[2];

    -- Verificar se tabela existe
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      RAISE NOTICE 'Tabela % não existe, pulando index...', tbl;
      CONTINUE;
    END IF;

    -- Descobrir nome real da coluna
    SELECT column_name INTO tbl_col
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = tbl
      AND column_name IN ('campaignId', 'campaign_id')
    ORDER BY CASE column_name WHEN 'campaignId' THEN 1 ELSE 2 END
    LIMIT 1;

    IF tbl_col IS NULL THEN
      RAISE NOTICE 'Tabela % não tem coluna campaign*, pulando index...', tbl;
      CONTINUE;
    END IF;

    -- Criar index (IF NOT EXISTS não suporta nome variável, então drop first)
    EXECUTE format('DROP INDEX IF EXISTS %I', idx_name);
    EXECUTE format('CREATE INDEX %I ON %I(%I)', idx_name, tbl, tbl_col);
    RAISE NOTICE 'Index % criado em %.%', idx_name, tbl, tbl_col;
  END LOOP;
END;
$$;

-- Index de data em visits (sempre existe)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'visits'
  ) THEN
    DROP INDEX IF EXISTS idx_visits_data;
    CREATE INDEX idx_visits_data ON visits(data);
    RAISE NOTICE 'Index idx_visits_data criado.';
  END IF;
END;
$$;

-- =============================================
-- SEED: Configurar contas admin
-- Detecta automaticamente os nomes das colunas
-- =============================================
DO $$
DECLARE
  col_admin TEXT;
  col_type  TEXT;
  col_plan  TEXT;
BEGIN
  -- Descobrir nome da coluna isSupremeAdmin
  SELECT column_name INTO col_admin
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'users'
    AND column_name IN ('isSupremeAdmin', 'is_supreme_admin')
  LIMIT 1;

  -- Descobrir nome da coluna type
  SELECT column_name INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'users'
    AND column_name = 'type'
  LIMIT 1;

  -- Descobrir nome da coluna plan
  SELECT column_name INTO col_plan
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'users'
    AND column_name = 'plan'
  LIMIT 1;

  -- Aplicar seed para eldastito@gmail.com
  IF col_admin IS NOT NULL THEN
    EXECUTE format(
      'UPDATE users SET %I = TRUE WHERE email = ''eldastito@gmail.com''',
      col_admin
    );
  END IF;
  IF col_type IS NOT NULL THEN
    UPDATE users SET type = 'Admin' WHERE email IN ('eldastito@gmail.com', 'examepad@gmail.com');
  END IF;
  IF col_plan IS NOT NULL THEN
    UPDATE users SET plan = 'Total' WHERE email IN ('eldastito@gmail.com', 'examepad@gmail.com');
  END IF;

  RAISE NOTICE 'Seed de admins aplicado com sucesso!';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Aviso no seed de admins (usuários podem não existir ainda): %', SQLERRM;
END;
$$;

-- Confirmar o que foi criado
SELECT indexname, tablename FROM pg_indexes 
WHERE schemaname = 'public' 
  AND indexname LIKE 'idx_%campaign%'
ORDER BY tablename;
