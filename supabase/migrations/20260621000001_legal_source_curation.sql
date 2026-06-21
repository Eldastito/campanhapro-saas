-- PR 5 — Curadoria da base jurídica compartilhada (upload manual + fila de revisão).
--
-- legal_source_documents: 1 linha por documento ingerido no escopo global:legal
-- (nível documento). É a fonte de verdade da FILA DE REVISÃO e do changelog. Os
-- chunks embeddados ficam em knowledge_chunks (o status do chunk espelha o do doc).
--
-- legal_rule_updates: 1 linha por "rodada de atualização" (botão Atualizar regras),
-- pro changelog mostrar "3 novos, 1 atualizado…".

CREATE TABLE IF NOT EXISTS legal_source_documents (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source             text        NOT NULL,   -- chave do doc em knowledge_chunks (coluna source)
  title              text        NOT NULL,
  "sourceOrg"        text        NOT NULL,   -- TSE | TRE | CNJ | DJe | SPCE | OAB | OUTRO
  "sourceUrl"        text,
  "docNumber"        text,
  "electionYear"     int,
  "publishedAt"      timestamptz,
  "contentHash"      text        NOT NULL,
  status             text        NOT NULL DEFAULT 'pending', -- pending | active | rejected | archived
  "chunkCount"       int         NOT NULL DEFAULT 0,
  "updateRunId"      uuid,
  "rejectionReason"  text,
  "reviewedByUserId" text,
  "reviewedAt"       timestamptz,
  "createdByUserId"  text,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source)
);

CREATE INDEX IF NOT EXISTS idx_legal_source_docs_status ON legal_source_documents (status);
CREATE INDEX IF NOT EXISTS idx_legal_source_docs_hash   ON legal_source_documents ("contentHash");

CREATE TABLE IF NOT EXISTS legal_rule_updates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "triggeredBy"   text        NOT NULL DEFAULT 'manual', -- manual | scheduled
  "userId"        text,
  status          text        NOT NULL DEFAULT 'running', -- running | done | error
  "newDocs"       int         NOT NULL DEFAULT 0,
  "updatedDocs"   int         NOT NULL DEFAULT 0,
  unchanged       int         NOT NULL DEFAULT 0,
  summary         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "errorMessage"  text,
  "startedAt"     timestamptz NOT NULL DEFAULT now(),
  "finishedAt"    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_legal_rule_updates_started ON legal_rule_updates ("startedAt" DESC);

-- RLS: a base é curada centralmente. Só service_role (backend, atrás de
-- requireSupremeAdmin) escreve/lê. Cliente anônimo é negado por padrão.
ALTER TABLE legal_source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_rule_updates     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role all legal_source_documents" ON legal_source_documents;
CREATE POLICY "Service role all legal_source_documents"
  ON legal_source_documents FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role all legal_rule_updates" ON legal_rule_updates;
CREATE POLICY "Service role all legal_rule_updates"
  ON legal_rule_updates FOR ALL USING (auth.role() = 'service_role');

-- Sem isto o PostgREST devolve 404 nas tabelas/colunas novas.
NOTIFY pgrst, 'reload schema';
