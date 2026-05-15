-- Phase 3: RAG with pgvector (replaces ExaForge's vectorStore.json)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId"    text        NOT NULL,
  source          text        NOT NULL,
  content         text        NOT NULL,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  embedding       vector(1536),
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

-- IVFFlat index for fast approximate nearest neighbour search
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_campaign
  ON knowledge_chunks ("campaignId");

ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Campaign members read knowledge"
  ON knowledge_chunks FOR SELECT
  USING ("campaignId" IN (SELECT campaign_id::text FROM users WHERE id = auth.uid()));

CREATE POLICY "Service role bypass knowledge"
  ON knowledge_chunks FOR ALL
  USING (auth.role() = 'service_role');

-- RPC for semantic similarity search
CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  query_embedding vector(1536),
  campaign_id     text,
  match_count     int DEFAULT 5
)
RETURNS TABLE (
  id          uuid,
  content     text,
  source      text,
  metadata    jsonb,
  similarity  float
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
    1 - (k.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunks k
  WHERE k."campaignId" = campaign_id
  ORDER BY k.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
