-- =========================================================
-- PADRONIZAÇÃO GLOBAL DO BANCO DE DADOS (VERSÃO UNIVERSAL)
-- =========================================================
-- Este script renomeia automaticamente colunas camelCase para snake_case
-- em TODAS as tabelas do esquema 'public'.

-- Desativar triggers temporariamente para evitar efeitos colaterais
SET session_replication_role = 'replica';

DO $$
DECLARE
    tbl RECORD;
    col RECORD;
    old_name TEXT;
    new_name TEXT;
BEGIN
    -- 1. LOOP POR TODAS AS TABELAS NO ESQUEMA PUBLIC
    FOR tbl IN (
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
    ) LOOP
        
        -- 2. LOOP POR TODAS AS COLUNAS DA TABELA
        FOR col IN (
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = tbl.table_name
        ) LOOP
            old_name := col.column_name;
            
            -- Lógica de conversão: campaignId -> campaign_id, createdAt -> created_at, etc.
            -- Usamos regex para identificar letras maiúsculas e inserir underscore antes delas
            new_name := lower(regexp_replace(old_name, '([A-Z])', '_\1', 'g'));
            
            -- Remove underscore inicial se houver (ex: _id)
            IF left(new_name, 1) = '_' THEN
                new_name := substring(new_name from 2);
            END IF;

            -- Se o nome mudou, executamos o RENAME
            IF old_name <> new_name THEN
                BEGIN
                    EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', tbl.table_name, old_name, new_name);
                    RAISE NOTICE 'Renomeado: public.% . % -> %', tbl.table_name, old_name, new_name;
                EXCEPTION 
                    WHEN duplicate_column THEN
                        RAISE NOTICE 'Aviso: Coluna % já existe em %, pulando...', new_name, tbl.table_name;
                    WHEN others THEN
                        RAISE NOTICE 'Erro ao renomear % em %: %', old_name, tbl.table_name, SQLERRM;
                END;
            END IF;
            
        END LOOP;
    END LOOP;
END $$;

-- 3. AJUSTES DE TIPOS ESPECÍFICOS (Garantir UUID onde necessário)
-- Muitos campaign_id antigos podem estar como TEXT, vamos garantir que sejam UUID se seguirem o padrão
DO $$
DECLARE
    tbl RECORD;
BEGIN
    FOR tbl IN (
        SELECT table_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND column_name = 'campaign_id' 
          AND data_type = 'text'
    ) LOOP
        BEGIN
            EXECUTE format('ALTER TABLE public.%I ALTER COLUMN campaign_id TYPE UUID USING campaign_id::uuid', tbl.table_name);
            RAISE NOTICE 'Tipo alterado para UUID: public.% . campaign_id', tbl.table_name;
        EXCEPTION WHEN others THEN
            RAISE NOTICE 'Não foi possível converter campaign_id para UUID em % (dados incompatíveis)', tbl.table_name;
        END;
    END LOOP;
END $$;

-- 4. REATIVAÇÃO DE FUNÇÕES E POLICIES
CREATE OR REPLACE FUNCTION get_user_campaign_id()
RETURNS UUID AS $$
BEGIN
  RETURN (SELECT campaign_id FROM public.users WHERE id = auth.uid() LIMIT 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SET session_replication_role = 'origin';
