-- PR 0 — Base compartilhada do módulo Blindagem Jurídico-Contábil.
-- Estende knowledge_chunks com proveniência + versionamento por ano eleitoral
-- + status (fila de revisão), e cria um RPC de busca com múltiplos escopos
-- (campanha + 'global:legal') filtrando por status ativo.
--
-- A base jurídica (Resoluções TSE/TRE, manuais SPCE, jurisprudência) é
-- COMPARTILHADA entre todas as campanhas → fica no escopo sentinela
-- campaignId = 'global:legal', evitando re-embeddar a mesma norma por campanha.

-- 1) Novas colunas (idempotentes). Linhas existentes ficam status='active'
--    para o RAG por campanha continuar funcionando sem mudança de comportamento.
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS status         text        NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "electionYear" int,
  ADD COLUMN IF NOT EXISTS "sourceOrg"    text,
  ADD COLUMN IF NOT EXISTS "sourceUrl"    text,
  ADD COLUMN IF NOT EXISTS "docNumber"    text,
  ADD COLUMN IF NOT EXISTS "publishedAt"  timestamptz,
  ADD COLUMN IF NOT EXISTS "capturedAt"   timestamptz,
  ADD COLUMN IF NOT EXISTS "contentHash"  text;

-- 2) Índices: filtro por status, detecção de mudança por hash e busca jurídica
--    por ano eleitoral.
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_status
  ON knowledge_chunks ("campaignId", status);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_hash
  ON knowledge_chunks ("contentHash");
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_legal
  ON knowledge_chunks ("campaignId", "electionYear", status);

-- 3) RLS: qualquer usuário autenticado pode LER a base jurídica global, mas só
--    o que já foi aprovado (status='active'). Documentos 'pending' (fila de
--    revisão) não vazam entre campanhas. O backend usa service_role e ignora
--    RLS; esta policy é defesa em profundidade pra leitura direta do cliente.
DROP POLICY IF EXISTS "Authenticated read active global legal" ON knowledge_chunks;
CREATE POLICY "Authenticated read active global legal"
  ON knowledge_chunks FOR SELECT
  USING ("campaignId" = 'global:legal' AND status = 'active' AND auth.uid() IS NOT NULL);

-- 4) RPC de busca com múltiplos escopos + filtro de status/ano. Aditivo: o
--    match_knowledge_chunks antigo (por campanha) continua intacto.
CREATE OR REPLACE FUNCTION match_knowledge_chunks_scoped(
  query_embedding vector(1536),
  scopes          text[],
  match_count     int     DEFAULT 5,
  only_active     boolean DEFAULT true,
  election_year   int     DEFAULT NULL
)
RETURNS TABLE (
  id             uuid,
  content        text,
  source         text,
  metadata       jsonb,
  "campaignId"   text,
  status         text,
  "electionYear" int,
  "sourceOrg"    text,
  "sourceUrl"    text,
  similarity     float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    k.id,
    k.content,
    k.source,
    k.metadata,
    k."campaignId",
    k.status,
    k."electionYear",
    k."sourceOrg",
    k."sourceUrl",
    1 - (k.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunks k
  WHERE k."campaignId" = ANY(scopes)
    AND (NOT only_active OR k.status = 'active')
    -- ano nulo = norma atemporal; sempre entra. Senão casa o ano pedido.
    AND (election_year IS NULL OR k."electionYear" IS NULL OR k."electionYear" = election_year)
  ORDER BY k.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Sem isto o PostgREST devolve 404 nas colunas/função novas.
NOTIFY pgrst, 'reload schema';
