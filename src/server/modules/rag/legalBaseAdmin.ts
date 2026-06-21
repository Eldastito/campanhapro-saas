import type { SupabaseClient } from '@supabase/supabase-js';
import {
  GLOBAL_LEGAL_SCOPE,
  ingestLegalDocument,
  contentHash,
  type LegalSourceOrg,
} from './legalKnowledge';

/**
 * Curadoria da base jurídica compartilhada (global:legal). Upload manual → fila
 * de revisão → aprovação. Aprovar ativa os chunks; rejeitar os remove.
 *
 * Tudo aqui roda com service_role (chamado pelo legalBaseRouter, atrás de
 * requireSupremeAdmin), então ignora RLS de propósito.
 */

export interface ImportLegalInput {
  title: string;
  content: string;
  sourceOrg: LegalSourceOrg;
  sourceUrl?: string;
  docNumber?: string;
  electionYear?: number;
  publishedAt?: string;
  userId?: string | null;
}

export interface ImportLegalResult {
  status: 'imported' | 'unchanged';
  source: string;
  docId: string | null;
  chunks: number;
}

/**
 * Ingere um documento (status pending) e cria/atualiza a linha de revisão.
 * Dedup por hash: documento idêntico já existente é pulado (status 'unchanged').
 */
export async function importLegalSource(
  supabase: SupabaseClient,
  input: ImportLegalInput,
): Promise<ImportLegalResult> {
  const source = input.title.trim();

  const ing = await ingestLegalDocument(supabase, {
    source,
    content: input.content,
    sourceOrg: input.sourceOrg,
    sourceUrl: input.sourceUrl,
    docNumber: input.docNumber,
    electionYear: input.electionYear,
    publishedAt: input.publishedAt,
    status: 'pending',
  });

  // Conteúdo idêntico ao já indexado → não reabre revisão.
  if (ing.skipped > 0 && ing.ingested === 0) {
    return { status: 'unchanged', source, docId: null, chunks: 0 };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('legal_source_documents')
    .upsert(
      {
        source,
        title: source,
        sourceOrg: input.sourceOrg,
        sourceUrl: input.sourceUrl ?? null,
        docNumber: input.docNumber ?? null,
        electionYear: input.electionYear ?? null,
        publishedAt: input.publishedAt ?? null,
        contentHash: ing.docHash,
        status: 'pending',
        chunkCount: ing.ingested,
        // re-importação reseta a revisão anterior
        rejectionReason: null,
        reviewedByUserId: null,
        reviewedAt: null,
        createdByUserId: input.userId ?? null,
        updatedAt: now,
      },
      { onConflict: 'source' },
    )
    .select('id')
    .single();
  if (error) throw error;

  return { status: 'imported', source, docId: (data as any)?.id ?? null, chunks: ing.ingested };
}

/** Aprova: ativa o doc e os chunks embeddados dele no escopo global. */
export async function approveSource(
  supabase: SupabaseClient,
  id: string,
  userId?: string | null,
): Promise<{ ok: boolean; error?: string; document?: any }> {
  const { data: doc } = await supabase
    .from('legal_source_documents')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!doc) return { ok: false, error: 'not_found' };

  const now = new Date().toISOString();
  await supabase
    .from('knowledge_chunks')
    .update({ status: 'active' })
    .eq('campaignId', GLOBAL_LEGAL_SCOPE)
    .eq('source', (doc as any).source);

  const { data, error } = await supabase
    .from('legal_source_documents')
    .update({ status: 'active', reviewedByUserId: userId ?? null, reviewedAt: now, updatedAt: now })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return { ok: true, document: data };
}

/** Rejeita: marca o doc como rejected e remove os chunks dele da base. */
export async function rejectSource(
  supabase: SupabaseClient,
  id: string,
  userId?: string | null,
  reason?: string,
): Promise<{ ok: boolean; error?: string; document?: any }> {
  const { data: doc } = await supabase
    .from('legal_source_documents')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!doc) return { ok: false, error: 'not_found' };

  const now = new Date().toISOString();
  await supabase
    .from('knowledge_chunks')
    .delete()
    .eq('campaignId', GLOBAL_LEGAL_SCOPE)
    .eq('source', (doc as any).source);

  const { data, error } = await supabase
    .from('legal_source_documents')
    .update({
      status: 'rejected',
      rejectionReason: reason ?? null,
      reviewedByUserId: userId ?? null,
      reviewedAt: now,
      updatedAt: now,
      chunkCount: 0,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return { ok: true, document: data };
}

export async function listReviewQueue(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('legal_source_documents')
    .select('*')
    .eq('status', 'pending')
    .order('createdAt', { ascending: false })
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

export async function listActiveDocuments(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('legal_source_documents')
    .select('*')
    .eq('status', 'active')
    .order('updatedAt', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return data ?? [];
}

export async function listUpdates(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('legal_rule_updates')
    .select('*')
    .order('startedAt', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

// re-export pra quem importa o admin precisar do hash (ex.: dedup no caller)
export { contentHash };
