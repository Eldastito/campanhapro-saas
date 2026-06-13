import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { ingestChunks, search } from './vectorStore';
import { callAgent, BudgetExceededError } from '../../../lib/aiCallAgent';

/** Split text into ~chunkSize-word segments with overlap. */
function chunkText(text: string, chunkSize = 400, overlap = 40): string[] {
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

export function createRagRouter(supabaseAdmin: SupabaseClient) {
  const router = Router();

  /**
   * POST /api/v1/rag/ingest
   * Body: { chunks: [{ source, content, metadata? }] }
   * Low-level — prefer POST /documents for user-facing uploads.
   */
  router.post('/ingest', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId ?? req.body.campaignId;
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      const incoming = (req.body.chunks ?? []) as Array<{
        source: string;
        content: string;
        metadata?: Record<string, unknown>;
      }>;

      if (!incoming.length) return res.status(400).json({ error: 'chunks vazio' });

      const count = await ingestChunks(
        supabaseAdmin,
        incoming.map(c => ({ ...c, campaignId }))
      );

      return res.json({ ok: true, ingested: count });
    } catch (err: any) {
      console.error('[RAG] ingest:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/v1/rag/search?q=...&limit=5
   */
  router.get('/search', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId ?? (req.query.campaignId as string);
      const q = (req.query.q as string)?.trim();
      const limit = Math.min(Number(req.query.limit) || 5, 20);

      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });
      if (!q) return res.status(400).json({ error: 'parâmetro q obrigatório' });

      const results = await search(supabaseAdmin, campaignId, q, limit);
      return res.json({ results });
    } catch (err: any) {
      console.error('[RAG] search:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // Document management (higher-level API for the ExaForge UI)
  // -------------------------------------------------------------------------

  /**
   * GET /api/v1/rag/documents
   * Lists distinct documents (grouped by source) with chunk counts.
   */
  router.get('/documents', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId as string;
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { data, error } = await supabaseAdmin
        .from('knowledge_chunks')
        .select('source, createdAt')
        .eq('campaignId', campaignId)
        .order('createdAt', { ascending: false });

      if (error) throw error;

      // Group by source in JS (documents < 200 per campaign in practice)
      const map = new Map<string, { source: string; chunkCount: number; createdAt: string }>();
      for (const row of data ?? []) {
        if (!map.has(row.source)) {
          map.set(row.source, { source: row.source, chunkCount: 0, createdAt: row.createdAt });
        }
        map.get(row.source)!.chunkCount++;
      }

      const documents = [...map.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );

      return res.json({ documents });
    } catch (err: any) {
      console.error('[RAG] list documents:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/v1/rag/documents
   * Body: { title: string; content: string }
   * Auto-chunks the content and ingests with source=title.
   */
  router.post('/documents', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId as string;
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      const { title, content } = req.body as { title: string; content: string };
      if (!title?.trim()) return res.status(400).json({ error: 'título obrigatório' });
      if (!content?.trim()) return res.status(400).json({ error: 'conteúdo obrigatório' });
      if (content.length > 2_000_000) return res.status(400).json({ error: 'Conteúdo muito grande (máx 2MB)' });

      const source = title.trim();
      const textChunks = chunkText(content);
      if (textChunks.length === 0) return res.status(400).json({ error: 'Conteúdo muito curto' });

      // Delete existing chunks for this source (allow re-ingestion)
      await supabaseAdmin
        .from('knowledge_chunks')
        .delete()
        .eq('campaignId', campaignId)
        .eq('source', source);

      const count = await ingestChunks(
        supabaseAdmin,
        textChunks.map((chunk, i) => ({
          campaignId,
          source,
          content: chunk,
          metadata: { chunkIndex: i, totalChunks: textChunks.length },
        }))
      );

      return res.status(201).json({ ok: true, source, ingested: count });
    } catch (err: any) {
      console.error('[RAG] upload document:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/v1/rag/documents/:source
   * Removes all chunks for the given source (URL-encoded).
   */
  router.delete('/documents/:source', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId as string;
      if (!campaignId) return res.status(400).json({ error: 'campaignId obrigatório' });

      const source = decodeURIComponent(req.params.source);

      const { error } = await supabaseAdmin
        .from('knowledge_chunks')
        .delete()
        .eq('campaignId', campaignId)
        .eq('source', source);

      if (error) throw error;
      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[RAG] delete document:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /memory — lista a memória da IA (chunks com source agent:*) com filtros.
   * Servidor não retorna o embedding (binário grande); só metadata utilizável.
   */
  router.get('/memory', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

      const agentId = (req.query.agentId as string) || undefined;
      const limit = Math.min(Number(req.query.limit ?? 100), 500);
      const offset = Math.max(Number(req.query.offset ?? 0), 0);

      let query = supabaseAdmin
        .from('knowledge_chunks')
        .select('id, source, content, metadata, "createdAt"', { count: 'exact' })
        .eq('campaignId', campaignId)
        .like('source', 'agent:%')
        .order('createdAt', { ascending: false })
        .range(offset, offset + limit - 1);

      if (agentId) query = query.eq('source', `agent:${agentId}`);

      const { data, error, count } = await query;
      if (error) throw error;

      // Stats por agente (qtd de chunks). Útil pra UI mostrar facets.
      const { data: facets } = await supabaseAdmin.rpc('count_memory_by_source', { p_campaign_id: campaignId }).then(
        (r: any) => r,
        () => ({ data: [] as Array<{ source: string; n: number }> }),
      );

      res.json({ chunks: data ?? [], total: count ?? 0, facets: facets ?? [] });
    } catch (err: any) {
      console.error('[RAG] list memory:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /memory/:id — apaga 1 chunk de memória da IA. Só Admin/Coordenador
   * (verificação simples por type — autorização granular fica pra depois).
   */
  router.delete('/memory/:id', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      const userType = (req as any).user?.userType;
      if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
      if (userType !== 'Admin' && userType !== 'Coordenador') {
        return res.status(403).json({ error: 'admin_required' });
      }

      const { error } = await supabaseAdmin
        .from('knowledge_chunks')
        .delete()
        .eq('id', req.params.id)
        .eq('campaignId', campaignId)
        .like('source', 'agent:%'); // só permite apagar memória IA, nunca conhecimento ancorado

      if (error) throw error;
      return res.json({ ok: true });
    } catch (err: any) {
      console.error('[RAG] delete memory:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /refresh-external (#56) — semeia a RAG com sinal externo fresco.
   *
   * Dispara 2 callAgent('competitive_intel', enableWebSearch: true) em paralelo:
   *   1) cenário do município (notícias da última semana + agenda pública)
   *   2) movimento dos adversários (declarações, presença em mídia, narrativas)
   *
   * As respostas são auto-persistidas em knowledge_chunks com primarySources
   * preservados (#110 + #112). Todos os agentes que consultam RAG (#61) vão
   * encontrar esse sinal fresco automaticamente — sem mexer em mais nada.
   *
   * Throttle: 1x/dia por campanha (cada chamada custa ~$0.05 USD).
   */
  router.post('/refresh-external', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    const userId = (req as any).user?.id;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    try {
      // 1) Throttle: olha agent_runs nas últimas 24h c/ tag rag-refresh
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await supabaseAdmin
        .from('agent_runs')
        .select('id, "createdAt"')
        .eq('campaignId', campaignId)
        .gte('createdAt', since)
        .like('promptExcerpt', '[rag-refresh]%')
        .limit(1);
      if (recent && recent.length > 0) {
        return res.status(429).json({
          error: 'throttled',
          detail: 'Memória externa já foi atualizada nas últimas 24h. Tente amanhã.',
          nextAvailableAt: new Date(new Date((recent[0] as any).createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString(),
        });
      }

      // 2) Contexto da campanha
      const { data: camp } = await supabaseAdmin.from('campaigns')
        .select('name, "candidateName", party').eq('id', campaignId).maybeSingle();
      if (!camp) return res.status(404).json({ error: 'campaign_not_found' });

      const candidato = (camp as any).candidateName || (camp as any).name || 'o candidato';
      const partido = (camp as any).party || '';

      // Top município (do CRM) — pra direcionar a busca local
      const { data: cityRows } = await supabaseAdmin
        .from('contacts').select('city').eq('campaignId', campaignId)
        .not('city', 'is', null).limit(2000);
      const cityCounts = new Map<string, number>();
      for (const r of (cityRows ?? [])) {
        const c = String((r as any).city || '').trim();
        if (c) cityCounts.set(c, (cityCounts.get(c) || 0) + 1);
      }
      const municipio = [...cityCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';

      // 3) Dispara 2 web_search briefings em paralelo. Cada um já cai na RAG
      //    via auto-persist (#110) com primarySources marcado (#112).
      const SYSTEM = 'Você é um analista de inteligência política. Use web_search para coletar fatos NOVOS (últimos 7-30 dias). Cite a FONTE (veículo + URL + data) em CADA afirmação. Sem fonte, omita. Português do Brasil, conciso e factual.';

      const promptMunicipio =
        `[rag-refresh] Cenário político e eleitoral do município de ${municipio || '[não informado]'} nos últimos 7 dias.\n\n` +
        `Liste:\n` +
        `1. Notícias relevantes (prefeito, vereadores, polêmicas, obras)\n` +
        `2. Agenda pública confirmada (eventos, audiências, comícios)\n` +
        `3. Temas que estão dominando o noticiário local\n` +
        `4. Oportunidades pra ${candidato}${partido ? ' (' + partido + ')' : ''} se posicionar\n\n` +
        `Cada item: 1 linha + (fonte: URL, data). Sem invenção. Se não encontrar, escreva "sem fonte".`;

      const promptAdversarios =
        `[rag-refresh] Movimento dos adversários de ${candidato}${municipio ? ' em ' + municipio : ''} nos últimos 7 dias.\n\n` +
        `Liste pra cada adversário identificado:\n` +
        `1. Nome + cargo que disputa\n` +
        `2. Declarações públicas recentes (com fonte + data)\n` +
        `3. Presença em mídia / redes sociais (volume, tom)\n` +
        `4. Narrativa principal que está usando\n` +
        `5. Vulnerabilidades expostas que podem virar oportunidade pra nós\n\n` +
        `Cada item: fonte: URL + data. Sem invenção. Se não encontrar, escreva "sem dados públicos recentes".`;

      const runOne = async (prompt: string, label: string) => {
        try {
          const r = await callAgent(supabaseAdmin, 'competitive_intel', prompt, {
            campaignId, userId, systemInstruction: SYSTEM,
            complexity: 'balanced', enableWebSearch: true, maxTokens: 3000,
          });
          return { label, ok: true, summary: r.text.slice(0, 400), citations: r.citations || [], webSearches: r.webSearches || 0 };
        } catch (err: any) {
          if (err instanceof BudgetExceededError) return { label, ok: false, error: 'orçamento_de_IA_excedido' };
          return { label, ok: false, error: err?.message || 'ai_failed' };
        }
      };

      const [municipal, adversarios] = await Promise.all([
        runOne(promptMunicipio, 'cenario_municipal'),
        runOne(promptAdversarios, 'movimento_adversarios'),
      ]);

      const briefings = [municipal, adversarios];
      const totalSources = briefings.reduce((acc, b: any) => acc + (b.citations?.length || 0), 0);
      const totalSearches = briefings.reduce((acc, b: any) => acc + (b.webSearches || 0), 0);

      return res.json({
        ok: true,
        refreshedAt: new Date().toISOString(),
        municipio: municipio || null,
        candidato,
        briefings,
        stats: { totalSources, totalSearches, briefingsOk: briefings.filter((b: any) => b.ok).length },
      });
    } catch (err: any) {
      console.error('[RAG] refresh-external:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /refresh-status (#56) — quando foi a última refresh e quando libera próxima.
   */
  router.get('/refresh-status', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

      const { data: last } = await supabaseAdmin
        .from('agent_runs')
        .select('"createdAt"')
        .eq('campaignId', campaignId)
        .like('promptExcerpt', '[rag-refresh]%')
        .order('createdAt', { ascending: false })
        .limit(1);

      const lastAt = last && last.length ? (last[0] as any).createdAt : null;
      const nextAt = lastAt ? new Date(new Date(lastAt).getTime() + 24 * 60 * 60 * 1000).toISOString() : null;
      const canRefresh = !nextAt || new Date(nextAt) <= new Date();
      return res.json({ lastRefreshAt: lastAt, nextAvailableAt: nextAt, canRefresh });
    } catch (err: any) {
      console.error('[RAG] refresh-status:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
