import { SupabaseClient } from '@supabase/supabase-js';
import { embed, embedBatch } from './embeddings';

export interface KnowledgeChunk {
  id?: string;
  campaignId: string;
  source: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  content: string;
  source: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

/**
 * Inserts one or more knowledge chunks with embeddings.
 */
export async function ingestChunks(
  supabase: SupabaseClient,
  chunks: KnowledgeChunk[]
): Promise<number> {
  if (chunks.length === 0) return 0;

  const vectors = await embedBatch(chunks.map(c => c.content));

  const rows = chunks.map((c, i) => ({
    campaignId: c.campaignId,
    source: c.source,
    content: c.content,
    metadata: c.metadata ?? {},
    embedding: vectors[i],
  }));

  const { error } = await supabase.from('knowledge_chunks').insert(rows);
  if (error) throw error;
  return rows.length;
}

/**
 * Semantic search via pgvector. Requires the match_knowledge_chunks
 * SQL function (created in the migration).
 */
export async function search(
  supabase: SupabaseClient,
  campaignId: string,
  query: string,
  limit = 5
): Promise<SearchResult[]> {
  const vector = await embed(query);

  const { data, error } = await supabase.rpc('match_knowledge_chunks', {
    query_embedding: vector,
    campaignId: campaignId,
    match_count: limit,
  });

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    content: row.content,
    source: row.source,
    similarity: row.similarity,
    metadata: row.metadata ?? {},
  }));
}
