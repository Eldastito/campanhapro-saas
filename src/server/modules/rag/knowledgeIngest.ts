import { SupabaseClient } from '@supabase/supabase-js';
import { ingestChunks, search } from './vectorStore';

/**
 * Memória de longo prazo (RAG) alimentada pelos próprios agentes de IA.
 * Toda saída relevante (dossiês de concorrência, relatórios do consultor,
 * resumos de reunião…) é indexada em knowledge_chunks; antes de gerar uma
 * resposta, o agente consulta os trechos mais relevantes como CONTEXTO.
 *
 * Tudo best-effort: nunca lança — se embeddings/OpenAI falharem, o fluxo segue.
 */

/** Quebra texto longo em pedaços ~maxChars respeitando parágrafos. */
function chunkText(text: string, maxChars = 1500): string[] {
  const clean = (text || '').trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];
  const paras = clean.split(/\n{2,}/);
  const out: string[] = [];
  let buf = '';
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > maxChars) {
      if (buf) out.push(buf.trim());
      if (p.length > maxChars) { for (let i = 0; i < p.length; i += maxChars) out.push(p.slice(i, i + maxChars)); buf = ''; }
      else buf = p;
    } else { buf = buf ? buf + '\n\n' + p : p; }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

export async function ingestArtifact(
  supabase: SupabaseClient,
  args: { campaignId: string; source: string; title?: string; text: string; metadata?: Record<string, unknown> }
): Promise<number> {
  try {
    if (!args.campaignId || !args.text?.trim()) return 0;
    const parts = chunkText(args.text);
    if (!parts.length) return 0;
    const chunks = parts.map((content, i) => ({
      campaignId: args.campaignId,
      source: args.source,
      content: args.title ? `${args.title}\n${content}` : content,
      metadata: { ...(args.metadata || {}), title: args.title ?? null, part: i, indexedAt: new Date().toISOString() },
    }));
    return await ingestChunks(supabase, chunks);
  } catch (e: any) {
    console.warn('[rag] ingestArtifact falhou (seguindo sem indexar):', e?.message);
    return 0;
  }
}

/**
 * Recupera o contexto mais relevante da memória da campanha para um query.
 * Retorna string pronta pra colar no prompt (ou '' se nada/erro).
 */
export async function retrieveContext(
  supabase: SupabaseClient,
  campaignId: string,
  query: string,
  limit = 5
): Promise<string> {
  try {
    if (!campaignId || !query?.trim()) return '';
    // Timeout defensivo: a busca (embeddings OpenAI + pgvector) NUNCA pode travar
    // o fluxo principal. Se demorar > 8s, segue sem memória.
    const results = await Promise.race([
      search(supabase, campaignId, query, limit),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('rag_timeout')), 8000)),
    ]);
    if (!results.length) return '';
    // Marca cada chunk com o ORIGEM real pra IA não confundir memória vs fonte:
    //   • Chunk com source não-agent (formulário, settings, doc carregado) → "FONTE"
    //   • Chunk com source=agent:* + hasPrimarySources → "MEMÓRIA ANCORADA"
    //   • Chunk com source=agent:* sem fontes → "MEMÓRIA NÃO-ANCORADA"
    //     (a IA deve tratar essas como INFERÊNCIA anterior, não como fato.)
    return results
      .map((r, i) => {
        const meta: any = r.metadata || {};
        const isAgent = r.source.startsWith('agent:');
        const hasSources = isAgent && meta.hasPrimarySources;
        const tag = !isAgent ? 'FONTE'
          : hasSources ? 'MEMÓRIA ANCORADA'
          : 'MEMÓRIA NÃO-ANCORADA — trate como inferência, não como fato verificado';
        const sourcesLine = hasSources && Array.isArray(meta.primarySources) && meta.primarySources.length
          ? `\nFontes citadas: ${meta.primarySources.slice(0, 3).map((s: any) => s.url || s.title).filter(Boolean).join(' | ')}`
          : '';
        return `[${i + 1}] ${tag} (${r.source}, relevância ${(r.similarity * 100).toFixed(0)}%)${sourcesLine}\n${r.content.slice(0, 600)}`;
      })
      .join('\n\n');
  } catch (e: any) {
    console.warn('[rag] retrieveContext falhou:', e?.message);
    return '';
  }
}
