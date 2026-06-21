import { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { embed, embedBatch } from './embeddings';

/**
 * Escopo sentinela da base de conhecimento jurídico-contábil COMPARTILHADA
 * por todas as campanhas (Resoluções TSE/TRE, manuais SPCE, jurisprudência).
 * Guardar aqui evita re-embeddar a mesma norma por campanha.
 */
export const GLOBAL_LEGAL_SCOPE = 'global:legal';

export type LegalSourceOrg = 'TSE' | 'TRE' | 'CNJ' | 'DJe' | 'SPCE' | 'OAB' | 'OUTRO';
export type LegalChunkStatus = 'pending' | 'active' | 'archived';

export interface LegalDocumentInput {
  /** Título/identificador único do documento dentro do escopo. */
  source: string;
  /** Texto já extraído (use extractPdfText para PDFs). */
  content: string;
  sourceOrg: LegalSourceOrg;
  sourceUrl?: string;
  /** Nº da resolução/processo, p/ citação. */
  docNumber?: string;
  /** Ano eleitoral; null = norma atemporal. */
  electionYear?: number;
  /** ISO date de publicação na fonte. */
  publishedAt?: string;
  /** Default 'pending' — entra na fila de revisão antes de virar fonte ativa. */
  status?: LegalChunkStatus;
  metadata?: Record<string, unknown>;
}

export interface IngestLegalResult {
  source: string;
  ingested: number;
  /** 1 quando o doc não mudou desde a última captura (mesmo hash) e foi pulado. */
  skipped: number;
  docHash: string;
}

export interface LegalSearchResult {
  id: string;
  content: string;
  source: string;
  similarity: number;
  campaignId: string;
  status: string;
  electionYear: number | null;
  sourceOrg: string | null;
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
}

/** Hash estável do conteúdo (normaliza espaços) p/ dedup e detecção de mudança. */
export function contentHash(text: string): string {
  return createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex');
}

/** Quebra texto em segmentos de ~chunkSize palavras com sobreposição. */
function chunkLegalText(text: string, chunkSize = 400, overlap = 40): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
    i += chunkSize - overlap;
    if (i + overlap >= words.length && i < words.length) {
      chunks.push(words.slice(i).join(' '));
      break;
    }
  }
  return chunks.filter(c => c.trim().length > 20);
}

/**
 * Ingere um documento jurídico na base compartilhada (ou em outro escopo).
 *
 * Detecção de mudança: se já existe documento com o mesmo source e o mesmo
 * contentHash no escopo, não re-embeda (economia no crawl agendado). Se o
 * conteúdo mudou, remove a versão antiga e re-ingere com o novo hash.
 *
 * Por padrão entra como 'pending' → fila de revisão antes de virar fonte ativa.
 */
export async function ingestLegalDocument(
  supabase: SupabaseClient,
  doc: LegalDocumentInput,
  scope: string = GLOBAL_LEGAL_SCOPE,
): Promise<IngestLegalResult> {
  const status: LegalChunkStatus = doc.status ?? 'pending';
  const docHash = contentHash(doc.content);

  const { data: existing } = await supabase
    .from('knowledge_chunks')
    .select('id')
    .eq('campaignId', scope)
    .eq('source', doc.source)
    .eq('contentHash', docHash)
    .limit(1);
  if (existing && existing.length > 0) {
    return { source: doc.source, ingested: 0, skipped: 1, docHash };
  }

  // Conteúdo novo ou alterado: limpa a versão anterior desse source no escopo.
  await supabase
    .from('knowledge_chunks')
    .delete()
    .eq('campaignId', scope)
    .eq('source', doc.source);

  const chunks = chunkLegalText(doc.content);
  if (chunks.length === 0) return { source: doc.source, ingested: 0, skipped: 0, docHash };

  const vectors = await embedBatch(chunks);
  const capturedAt = new Date().toISOString();
  const rows = chunks.map((content, i) => ({
    campaignId: scope,
    source: doc.source,
    content,
    metadata: { ...(doc.metadata ?? {}), chunkIndex: i, totalChunks: chunks.length },
    embedding: vectors[i],
    status,
    electionYear: doc.electionYear ?? null,
    sourceOrg: doc.sourceOrg,
    sourceUrl: doc.sourceUrl ?? null,
    docNumber: doc.docNumber ?? null,
    publishedAt: doc.publishedAt ?? null,
    capturedAt,
    contentHash: docHash, // hash do doc inteiro → detecta mudança no próximo crawl
  }));

  const { error } = await supabase.from('knowledge_chunks').insert(rows);
  if (error) throw error;
  return { source: doc.source, ingested: rows.length, skipped: 0, docHash };
}

/**
 * Busca semântica na base jurídica. Por padrão consulta o escopo da campanha
 * + o escopo global compartilhado, retornando só fontes ativas (aprovadas).
 */
export async function searchLegalKnowledge(
  supabase: SupabaseClient,
  campaignId: string,
  query: string,
  opts: { limit?: number; electionYear?: number; includeCampaignScope?: boolean } = {},
): Promise<LegalSearchResult[]> {
  const vector = await embed(query);
  const scopes =
    opts.includeCampaignScope === false
      ? [GLOBAL_LEGAL_SCOPE]
      : [campaignId, GLOBAL_LEGAL_SCOPE];

  const { data, error } = await supabase.rpc('match_knowledge_chunks_scoped', {
    query_embedding: vector,
    scopes,
    match_count: opts.limit ?? 6,
    only_active: true,
    election_year: opts.electionYear ?? null,
  });
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    content: row.content,
    source: row.source,
    similarity: row.similarity,
    campaignId: row.campaignId,
    status: row.status,
    electionYear: row.electionYear ?? null,
    sourceOrg: row.sourceOrg ?? null,
    sourceUrl: row.sourceUrl ?? null,
    metadata: row.metadata ?? {},
  }));
}
