-- =============================================
-- PARTE 6 v3: Trigger corrigido — sem necessidade de app.anon_key
-- A Edge Function tem verify_jwt = false, então funciona sem token válido
-- Execute no SQL Editor do Supabase
-- =============================================

-- PASSO 1: Garantir pg_net
CREATE EXTENSION IF NOT EXISTS pg_net;

-- PASSO 2: Remover triggers duplicados da versão anterior
DROP TRIGGER IF EXISTS auto_pipeline_trigger ON street_reports;
DROP FUNCTION IF EXISTS notify_auto_pipeline_on_negative_report();

-- PASSO 3: Recriar função SEM necessidade de anon_key
CREATE OR REPLACE FUNCTION trigger_auto_pipeline_on_negative_report()
RETURNS TRIGGER AS $$
DECLARE
    project_ref  TEXT := 'jvmtcsxoxgzepslxqtdy';
    function_url TEXT;
    payload      JSONB;
    col_campaign TEXT;
    campaign_val TEXT;
BEGIN
    -- Só processa reportes NEGATIVOS
    IF NEW.clima <> 'Negativo' THEN
        RETURN NEW;
    END IF;

    -- URL da Edge Function
    function_url := format('https://%s.supabase.co/functions/v1/auto-pipeline', project_ref);

    -- Descobrir nome real da coluna de campanha
    SELECT column_name INTO col_campaign
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'street_reports'
      AND column_name IN ('campaignId', 'campaign_id')
    ORDER BY CASE column_name WHEN 'campaignId' THEN 1 ELSE 2 END
    LIMIT 1;

    IF col_campaign = 'campaignId' THEN
        campaign_val := NEW."campaignId";
    ELSE
        campaign_val := NEW.campaign_id::TEXT;
    END IF;

    -- Montar payload
    payload := jsonb_build_object(
        'type',   'INSERT',
        'record', jsonb_build_object(
            'campaignId', campaign_val,
            'bairro',     NEW.bairro,
            'clima',      NEW.clima,
            'reclamacao', NEW.reclamacao
        )
    );

    -- Chamar Edge Function de forma ASSÍNCRONA
    -- Sem token pois verify_jwt = false na função
    PERFORM net.http_post(
        url     := function_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json'
        ),
        body    := payload::TEXT::BYTEA,
        timeout_milliseconds := 5000
    );

    RAISE LOG '[auto-pipeline] Webhook enviado para bairro: %', NEW.bairro;
    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
    -- Nunca bloqueia o INSERT mesmo se webhook falhar
    RAISE LOG '[auto-pipeline] Aviso (nao critico): %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- PASSO 4: Recriar o trigger (DROP + CREATE para garantir versão limpa)
DROP TRIGGER IF EXISTS auto_pipeline_on_negative_report ON street_reports;
CREATE TRIGGER auto_pipeline_on_negative_report
    AFTER INSERT ON street_reports
    FOR EACH ROW
    EXECUTE FUNCTION trigger_auto_pipeline_on_negative_report();

-- PASSO 5: Confirmar resultado (deve mostrar APENAS 1 trigger)
SELECT
    trigger_name,
    event_manipulation,
    event_object_table,
    action_timing
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table  = 'street_reports';
