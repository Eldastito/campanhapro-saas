-- =============================================
-- PARTE 4: RLS Policies — versão FINAL CORRIGIDA
-- Lida com campaign_id UUID (expenses) e campaignId TEXT (demais tabelas)
-- Execute DEPOIS da Parte 3
-- =============================================

-- === USUÁRIOS (usa auth.uid() diretamente) ===
DROP POLICY IF EXISTS "users_select_own"     ON users;
DROP POLICY IF EXISTS "users_select_supreme" ON users;
DROP POLICY IF EXISTS "users_insert_own"     ON users;
DROP POLICY IF EXISTS "users_update_own"     ON users;
DROP POLICY IF EXISTS "users_update_supreme" ON users;

CREATE POLICY "users_select_own"     ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_select_supreme" ON users FOR SELECT USING (is_supreme_admin());
CREATE POLICY "users_insert_own"     ON users FOR INSERT WITH CHECK (auth.uid() = id OR is_supreme_admin());
CREATE POLICY "users_update_own"     ON users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "users_update_supreme" ON users FOR UPDATE USING (is_supreme_admin());

-- === TABELAS COM campaignId/campaign_id ===
DO $$
DECLARE
  tbl      TEXT;
  col      TEXT;
  col_type TEXT;
  -- Comparação: se UUID, castamos para text; se text, comparação direta
  cmp_expr TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'visits', 'engagement_actions', 'team_members', 'locations',
    'incomes', 'expenses', 'scenarios', 'backups',
    'agent_outputs', 'content_briefs', 'neighborhood_flags',
    'field_tickets', 'pesquisas', 'street_reports'
  ])
  LOOP
    -- 1. Verificar se a tabela existe
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      RAISE NOTICE 'Tabela % não encontrada, pulando...', tbl;
      CONTINUE;
    END IF;

    -- 2. Descobrir nome e tipo real da coluna de campanha
    SELECT column_name, data_type
      INTO col, col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = tbl
      AND column_name IN ('campaignId', 'campaign_id')
    ORDER BY CASE column_name WHEN 'campaignId' THEN 1 ELSE 2 END
    LIMIT 1;

    IF col IS NULL THEN
      RAISE NOTICE 'Tabela % não tem coluna campaign*, pulando...', tbl;
      CONTINUE;
    END IF;

    -- 3. Montar expressão de comparação com o tipo correto
    --    Se a coluna for UUID, precisamos comparar com get_user_campaign_id()::uuid
    --    (ou cast a coluna para text — mais seguro caso o campaignId seja inválido como UUID)
    IF col_type = 'uuid' THEN
      -- Cast da coluna UUID para text para comparar com a função que retorna text
      cmp_expr := format('%I::text = get_user_campaign_id()', col);
    ELSE
      -- Comparação direta text = text
      cmp_expr := format('%I = get_user_campaign_id()', col);
    END IF;

    -- 4. Remover policies antigas
    EXECUTE format('DROP POLICY IF EXISTS "%s_select" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON %I', tbl, tbl);

    -- 5. Criar policies com tipo correto
    EXECUTE format(
      'CREATE POLICY "%s_select" ON %I FOR SELECT USING (%s OR is_supreme_admin())',
      tbl, tbl, cmp_expr
    );
    EXECUTE format(
      'CREATE POLICY "%s_insert" ON %I FOR INSERT WITH CHECK (%s OR is_supreme_admin())',
      tbl, tbl, cmp_expr
    );
    EXECUTE format(
      'CREATE POLICY "%s_update" ON %I FOR UPDATE USING (%s OR is_supreme_admin())',
      tbl, tbl, cmp_expr
    );
    EXECUTE format(
      'CREATE POLICY "%s_delete" ON %I FOR DELETE USING (%s OR is_supreme_admin())',
      tbl, tbl, cmp_expr
    );

    RAISE NOTICE '✓ Policies criadas: % | coluna: % | tipo: %', tbl, col, col_type;
  END LOOP;
END;
$$;

-- === TABELAS DE SETTINGS (chave primária = id que representa campaignId) ===
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['settings', 'campaign_configs', 'calculator_settings'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      RAISE NOTICE 'Tabela de settings % não encontrada, pulando...', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS "%s_select" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON %I', tbl, tbl);

    EXECUTE format(
      'CREATE POLICY "%s_select" ON %I FOR SELECT USING (id::text = get_user_campaign_id() OR is_supreme_admin())',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY "%s_insert" ON %I FOR INSERT WITH CHECK (id::text = get_user_campaign_id() OR is_supreme_admin())',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY "%s_update" ON %I FOR UPDATE USING (id::text = get_user_campaign_id() OR is_supreme_admin())',
      tbl, tbl
    );
    RAISE NOTICE '✓ Policies criadas para settings: %', tbl;
  END LOOP;
END;
$$;

-- === PLATFORM/ADMIN (apenas Supreme Admin) ===
DO $$
BEGIN
  -- ai_usage
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_usage') THEN
    DROP POLICY IF EXISTS "ai_usage_select" ON ai_usage;
    DROP POLICY IF EXISTS "ai_usage_insert" ON ai_usage;
    CREATE POLICY "ai_usage_select" ON ai_usage FOR SELECT USING (is_supreme_admin());
    CREATE POLICY "ai_usage_insert" ON ai_usage FOR INSERT WITH CHECK (true);
    RAISE NOTICE '✓ Policies ai_usage criadas.';
  END IF;

  -- platform_stats
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'platform_stats') THEN
    DROP POLICY IF EXISTS "platform_stats_select" ON platform_stats;
    DROP POLICY IF EXISTS "platform_stats_insert" ON platform_stats;
    DROP POLICY IF EXISTS "platform_stats_update" ON platform_stats;
    CREATE POLICY "platform_stats_select" ON platform_stats FOR SELECT USING (is_supreme_admin());
    CREATE POLICY "platform_stats_insert" ON platform_stats FOR INSERT WITH CHECK (is_supreme_admin());
    CREATE POLICY "platform_stats_update" ON platform_stats FOR UPDATE USING (is_supreme_admin());
    RAISE NOTICE '✓ Policies platform_stats criadas.';
  END IF;
END;
$$;

-- === CONFIRMAR RESULTADO ===
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;
