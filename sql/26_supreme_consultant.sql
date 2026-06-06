-- =============================================
-- PARTE 26: Agente Consultor IA do Supreme Admin (F6)
--
-- (1) Tabela consultant_reports — persiste cada análise gerada.
-- (2) Função supreme_campaign_analytics(campaignId) — monta um snapshot
--     analítico da campanha (equipe, CRM/contatos, visitas, reportes de
--     rua, pesquisas, jornada do eleitor/funil, engajamento, metas, uso de
--     IA, WhatsApp) que alimenta o agente consultor.
--
-- O endpoint POST /api/v1/supreme/campaigns/:id/analyze chama esta função,
-- envia o snapshot ao callAgent (chain OpenAI→Anthropic→Gemini) com persona
-- de consultor político especialista em conversão eleitor→apoiador, e grava
-- o resultado (SWOT, diagnóstico por fase, recomendações) em consultant_reports.
--
-- Execute no SQL Editor do Supabase. Idempotente.
-- =============================================

CREATE TABLE IF NOT EXISTS consultant_reports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "generatedBy" UUID,
    provider TEXT,
    model TEXT,
    snapshot JSONB,
    analysis JSONB,
    narrative TEXT,
    "tokensIn" INTEGER DEFAULT 0,
    "tokensOut" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consultant_reports_campaign ON consultant_reports("campaignId", "createdAt" DESC);

ALTER TABLE consultant_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages consultant reports" ON consultant_reports;
CREATE POLICY "service role manages consultant reports" ON consultant_reports
    FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE OR REPLACE FUNCTION supreme_campaign_analytics(p_campaign_id TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  result jsonb;
  v_uuid uuid;
BEGIN
  BEGIN v_uuid := p_campaign_id::uuid; EXCEPTION WHEN others THEN v_uuid := NULL; END;

  SELECT jsonb_build_object(
    'campaignId', p_campaign_id,
    'generatedAt', now(),
    'campaign', (
      SELECT jsonb_build_object(
        'name', (SELECT name FROM public.users WHERE "campaignId" = v_uuid AND type='Admin' ORDER BY "createdAt" LIMIT 1),
        'plan', cc."planTier", 'status', cc.status, 'features', cc.features, 'createdAt', cc."createdAt",
        -- Dados eleitorais (TRE/TSE) — vêm de settings.campaignDetails (jsonb)
        'cnpj', (SELECT "campaignDetails"->>'cnpj' FROM settings WHERE "campaignId" = p_campaign_id LIMIT 1),
        'nomeUrna', (SELECT "campaignDetails"->>'nomeUrna' FROM settings WHERE "campaignId" = p_campaign_id LIMIT 1),
        'partido', (SELECT "campaignDetails"->>'partido' FROM settings WHERE "campaignId" = p_campaign_id LIMIT 1)
      ) FROM campaign_configs cc WHERE cc.id = p_campaign_id
    ),
    'team', (
      SELECT coalesce(jsonb_object_agg(coalesce(type,'sem_tipo'), cnt), '{}'::jsonb)
      FROM (SELECT type, count(*) cnt FROM public.users WHERE "campaignId" = v_uuid GROUP BY type) t
    ),
    'contacts', (
      SELECT jsonb_build_object(
        'total', count(*),
        'last30d', count(*) FILTER (WHERE "createdAt" > now() - interval '30 days'),
        'byClassification', (SELECT coalesce(jsonb_object_agg(coalesce(classification,'(sem)'), c),'{}'::jsonb) FROM (SELECT classification, count(*) c FROM contacts WHERE "campaignId"=p_campaign_id GROUP BY 1) x),
        'bySupportLevel', (SELECT coalesce(jsonb_object_agg(coalesce("supportLevel",'(sem)'), c),'{}'::jsonb) FROM (SELECT "supportLevel", count(*) c FROM contacts WHERE "campaignId"=p_campaign_id GROUP BY 1) x),
        'avgEngagementScore', round(avg("engagementScore")::numeric, 1)
      ) FROM contacts WHERE "campaignId" = p_campaign_id
    ),
    'visits', (
      SELECT jsonb_build_object(
        'total', count(*),
        'last30d', count(*) FILTER (WHERE "createdAt" > now() - interval '30 days'),
        'topBairros', (SELECT coalesce(jsonb_agg(row_to_json(b)),'[]'::jsonb) FROM (SELECT bairro, count(*) c FROM visits WHERE "campaignId"=p_campaign_id AND bairro IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10) b)
      ) FROM visits WHERE "campaignId" = p_campaign_id
    ),
    'streetReports', (
      SELECT jsonb_build_object(
        'total', count(*),
        'byClima', (SELECT coalesce(jsonb_object_agg(coalesce(clima,'(sem)'), c),'{}'::jsonb) FROM (SELECT clima, count(*) c FROM street_reports WHERE "campaignId"=p_campaign_id GROUP BY 1) x),
        'topBairrosNegativos', (SELECT coalesce(jsonb_agg(row_to_json(b)),'[]'::jsonb) FROM (SELECT bairro, count(*) c FROM street_reports WHERE "campaignId"=p_campaign_id AND clima='Negativo' GROUP BY 1 ORDER BY 2 DESC LIMIT 10) b)
      ) FROM street_reports WHERE "campaignId" = p_campaign_id
    ),
    'pesquisas', (
      SELECT jsonb_build_object(
        'total', count(*),
        'byIntencaoVoto', (SELECT coalesce(jsonb_object_agg(coalesce("intencaoVoto",'(sem)'), c),'{}'::jsonb) FROM (SELECT "intencaoVoto", count(*) c FROM pesquisas WHERE "campaignId"=p_campaign_id GROUP BY 1) x),
        'avgNotaBairro', round(avg("notaBairro")::numeric, 1)
      ) FROM pesquisas WHERE "campaignId" = p_campaign_id
    ),
    'voterJourney', (
      SELECT coalesce(jsonb_object_agg(coalesce("currentStage",'(sem)'), c), '{}'::jsonb)
      FROM (SELECT "currentStage", count(*) c FROM voter_journey WHERE "campaignId"=p_campaign_id GROUP BY 1) x
    ),
    'engagement', (
      SELECT jsonb_build_object(
        'total', count(*),
        'byTipo', (SELECT coalesce(jsonb_object_agg(coalesce(tipo,'(sem)'), c),'{}'::jsonb) FROM (SELECT tipo, count(*) c FROM engagement_actions WHERE "campaignId"=p_campaign_id GROUP BY 1) x)
      ) FROM engagement_actions WHERE "campaignId" = p_campaign_id
    ),
    'goals', (
      SELECT jsonb_build_object(
        'total', count(*),
        'byStatus', (SELECT coalesce(jsonb_object_agg(coalesce(status,'(sem)'), c),'{}'::jsonb) FROM (SELECT status, count(*) c FROM campaign_goals WHERE "campaignId"=p_campaign_id GROUP BY 1) x)
      ) FROM campaign_goals WHERE "campaignId" = p_campaign_id
    ),
    'ai', (
      SELECT jsonb_build_object(
        'runs', count(*),
        'tokens', coalesce(sum("tokensIn" + "tokensOut"),0),
        'costUsd', coalesce(round(sum("costCentsUsd")/100.0, 2), 0)
      ) FROM agent_runs WHERE "campaignId" = p_campaign_id
    ),
    'whatsapp', (
      SELECT jsonb_build_object(
        'instances', (SELECT count(*) FROM whatsapp_instances WHERE "campaignId"=p_campaign_id AND status <> 'deleted'),
        'messages', (SELECT count(*) FROM channel_messages WHERE "campaignId"=p_campaign_id)
      )
    )
  ) INTO result;

  RETURN coalesce(result, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION supreme_campaign_analytics(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supreme_campaign_analytics(TEXT) TO service_role;
