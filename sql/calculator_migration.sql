-- MIGRAR CALCULATOR_SETTINGS PARA SNAKE_CASE
ALTER TABLE calculator_settings RENAME COLUMN "idealScenarioId" TO ideal_scenario_id;
ALTER TABLE calculator_settings RENAME COLUMN "calcState" TO calc_state;
ALTER TABLE calculator_settings RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE calculator_settings RENAME COLUMN "updatedAt" TO updated_at;

-- MIGRAR SCENARIOS PARA SNAKE_CASE
ALTER TABLE scenarios RENAME COLUMN "campaignId" TO campaign_id;
ALTER TABLE scenarios RENAME COLUMN "createdBy" TO created_by;
ALTER TABLE scenarios RENAME COLUMN "createdAt" TO created_at;

-- ATUALIZAR POLÍTICAS RLS (necessário porque os nomes das colunas mudaram)
DROP POLICY IF EXISTS "calculator_settings_select" ON calculator_settings;
DROP POLICY IF EXISTS "calculator_settings_insert" ON calculator_settings;
DROP POLICY IF EXISTS "calculator_settings_update" ON calculator_settings;

CREATE POLICY "calculator_settings_select" ON calculator_settings FOR SELECT USING (id = get_user_campaign_id() OR is_supreme_admin());
CREATE POLICY "calculator_settings_insert" ON calculator_settings FOR INSERT WITH CHECK (id = get_user_campaign_id() OR is_supreme_admin());
CREATE POLICY "calculator_settings_update" ON calculator_settings FOR UPDATE USING (id = get_user_campaign_id() OR is_supreme_admin());

DROP POLICY IF EXISTS "scenarios_select" ON scenarios;
DROP POLICY IF EXISTS "scenarios_insert" ON scenarios;
DROP POLICY IF EXISTS "scenarios_update" ON scenarios;
DROP POLICY IF EXISTS "scenarios_delete" ON scenarios;

CREATE POLICY "scenarios_select" ON scenarios FOR SELECT USING (campaign_id = get_user_campaign_id() OR is_supreme_admin());
CREATE POLICY "scenarios_insert" ON scenarios FOR INSERT WITH CHECK (campaign_id = get_user_campaign_id() OR is_supreme_admin());
CREATE POLICY "scenarios_update" ON scenarios FOR UPDATE USING (campaign_id = get_user_campaign_id() OR is_supreme_admin());
CREATE POLICY "scenarios_delete" ON scenarios FOR DELETE USING (campaign_id = get_user_campaign_id() OR is_supreme_admin());
