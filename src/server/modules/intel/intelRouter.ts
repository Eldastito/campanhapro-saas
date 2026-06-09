/**
 * Inteligência Competitiva por FONTES PÚBLICAS.
 *
 * A Meta não libera os "3C" do Instagram. Em vez disso, montamos um dossiê do
 * adversário a partir de fontes públicas, usando o web_search nativo do agente:
 *  - Redes sociais públicas (Instagram/TikTok/X/YouTube/Facebook)
 *  - Portais de notícias (regionais e nacionais)
 *  - TSE / DivulgaCand (candidatura e contas)
 *  - Biblioteca de Anúncios da Meta (Ad Library — anúncios públicos, 7 anos)
 *
 *   POST   /api/v1/intel/adversary   { name, cargo?, cidade?, uf? }
 *   GET    /api/v1/intel/adversaries
 *   DELETE /api/v1/intel/adversaries/:id
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callAgent, BudgetExceededError } from '../../../lib/aiCallAgent';
import { searchMetaAds } from './metaAdLibrary';
import { ingestArtifact, retrieveContext } from '../rag/knowledgeIngest';

/** Remove recursivamente tags de citação <cite...> dos valores string do objeto. */
function stripCites(v: any): any {
  if (typeof v === 'string') return v.replace(/<\/?cite[^>]*>/gi, '').replace(/\s{2,}/g, ' ').trim();
  if (Array.isArray(v)) return v.map(stripCites);
  if (v && typeof v === 'object') { const o: any = {}; for (const k of Object.keys(v)) o[k] = stripCites(v[k]); return o; }
  return v;
}

/** Repara JSON truncado: fecha string aberta e balanceia {}/[] que ficaram abertos. */
function repairJson(s: string): string {
  let inStr = false, esc = false;
  const stack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { if (inStr) esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }
  let out = s;
  if (inStr) out += '"';                 // fecha string cortada no meio
  out = out.replace(/[,\s]+$/, '');       // remove vírgula/espaço pendente
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
  return out;
}

function parseJsonLoose(text: string): any | null {
  if (!text) return null;
  // 1) Remove citações do web_search; 2) cercas markdown; 3) recorta do 1º {.
  let t = text.replace(/<\/?cite[^>]*>/gi, '').replace(/```json/gi, '').replace(/```/g, '');
  const a = t.indexOf('{');
  if (a < 0) return null;
  t = t.slice(a).trim();
  const lastClose = t.lastIndexOf('}');
  const tries = [
    lastClose > 0 ? t.slice(0, lastClose + 1) : t,   // caso JSON completo
    repairJson(t),                                   // caso truncado (corte de tokens)
  ].map((c) => c.replace(/,\s*([}\]])/g, '$1'));
  for (const cand of tries) {
    try { return stripCites(JSON.parse(cand)); } catch { /* próxima */ }
  }
  return null;
}

const SYSTEM = `Você é um analista de INTELIGÊNCIA COMPETITIVA ELEITORAL.
Pesquise EXCLUSIVAMENTE fontes públicas e cite-as: redes sociais públicas
(Instagram, TikTok, X, YouTube, Facebook), portais de notícias regionais e
nacionais, TSE/DivulgaCand, e a Biblioteca de Anúncios da Meta (Ad Library,
que mantém anúncios político/sociais por ~7 anos).
Regras: nunca invente dados — se não encontrar, diga "não encontrado". Nunca
sugira ataque pessoal: foque em propostas, pautas, narrativas e desempenho.
FORMATO OBRIGATÓRIO: responda APENAS com um objeto JSON válido — começando com
{ e terminando com }. NÃO escreva preâmbulo, NÃO use blocos markdown (\`\`\`),
e NÃO inclua tags de citação como <cite ...> dentro dos valores. As URLs das
fontes vão no array "fontes".`;

export function createIntelRouter(supabase: SupabaseClient): Router {
  const router = Router();

  router.post('/adversary', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    const userId = (req as any).user?.id ?? null;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const { name, cargo, cidade, uf } = req.body as { name?: string; cargo?: string; cidade?: string; uf?: string };
    const nome = (name || '').trim();
    if (!nome) return res.status(400).json({ error: 'name_required' });

    const alvo = [nome, cargo ? `(${cargo})` : '', cidade ? `de ${cidade}` : '', uf ? `/${uf}` : ''].filter(Boolean).join(' ');

    // Biblioteca de Anúncios da Meta — dados REAIS via API (não dá pra raspar pelo web_search).
    const adlib = await searchMetaAds(nome, 15);
    const adContext = adlib.available && adlib.ads.length
      ? `\n\nDADOS REAIS DA BIBLIOTECA DE ANÚNCIOS DA META (use exatamente estes no campo "anunciosMeta", não invente):\n`
        + JSON.stringify(adlib.ads.map((a) => ({ pagina: a.pageName, texto: a.bodies, periodo: [a.startDate, a.stopDate], gasto: a.spend, impressoes: a.impressions, plataformas: a.platforms })))
      : `\n\n(A Biblioteca de Anúncios da Meta ${adlib.reason === 'sem_token' ? 'não está configurada (sem token)' : 'não retornou anúncios'} — preencha "anunciosMeta" como "não encontrado".)`;

    // RAG: consulta a MEMÓRIA da campanha (dossiês/relatórios anteriores) antes de gerar.
    const memoria = await retrieveContext(supabase, campaignId, [nome, cargo, cidade].filter(Boolean).join(' '), 4);
    const memBlock = memoria
      ? `\n\nMEMÓRIA DA CAMPANHA (análises anteriores — considere e atualize, não repita cegamente):\n${memoria}`
      : '';

    const prompt =
      `Faça um dossiê de inteligência competitiva sobre o(a) candidato(a)/adversário(a): ${alvo}.\n` +
      `Use o web_search para buscar em fontes públicas atuais. Procure também a Biblioteca de Anúncios ` +
      `da Meta (facebook.com/ads/library) por anúncios pagos dele(a), e dados do TSE/DivulgaCand.\n\n` +
      `Responda SOMENTE com este JSON:\n` +
      `{\n` +
      `  "resumo": "2-4 frases do momento da candidatura",\n` +
      `  "redesSociais": [{"rede":"Instagram","handle":"@...","observacao":"tom/engajamento/frequência"}],\n` +
      `  "pautasPrincipais": ["..."],\n` +
      `  "narrativas": ["mensagens/bordões que está usando"],\n` +
      `  "noticiasRecentes": [{"titulo":"...","fonte":"...","data":"AAAA-MM-DD","url":"...","resumo":"..."}],\n` +
      `  "anunciosMeta": {"resumo":"o que aparece na Biblioteca de Anúncios","exemplos":["..."]},\n` +
      `  "tseDivulgacand": {"resumo":"o que consta no TSE (partido, nº, situação)"},\n` +
      `  "pontosFortes": ["..."],\n` +
      `  "pontosFracos": ["..."],\n` +
      `  "ameacasParaNos": ["..."],\n` +
      `  "oportunidadesParaNos": ["..."],\n` +
      `  "recomendacoes": ["ações práticas para a nossa campanha"],\n` +
      `  "fontes": ["urls consultadas"]\n` +
      `}` + adContext + memBlock;

    let result;
    try {
      result = await callAgent(supabase, 'competitive_intel', prompt, {
        campaignId,
        userId,
        systemInstruction: SYSTEM,
        complexity: 'premium',
        enableWebSearch: true,
        maxTokens: 5000, // suficiente p/ o JSON sem citações; o repair cobre qualquer cauda
      } as any);
    } catch (err: any) {
      if (err instanceof BudgetExceededError) return res.status(402).json({ error: 'ai_budget_exceeded', detail: err.message });
      return res.status(502).json({ error: 'ai_call_failed', detail: err?.message });
    }

    const dossier = parseJsonLoose(result.text);
    // Sobrepõe com os dados REAIS da Biblioteca de Anúncios (fonte da verdade).
    if (dossier && adlib.available && adlib.ads.length) {
      dossier.anunciosMeta = {
        resumo: `${adlib.total} anúncio(s) político/social encontrado(s) na Biblioteca de Anúncios da Meta.`,
        total: adlib.total,
        fonte: 'Meta Ad Library API',
        exemplos: adlib.ads.slice(0, 10).map((a) => ({
          pagina: a.pageName, texto: a.bodies, periodo: [a.startDate, a.stopDate].filter(Boolean).join(' → '),
          gasto: a.spend, impressoes: a.impressions, link: a.snapshotUrl,
        })),
      };
    } else if (dossier) {
      const reason = (adlib.reason || '').toLowerCase();
      let resumo: string;
      if (reason === 'sem_token') {
        resumo = 'Biblioteca de Anúncios NÃO configurada — defina META_ADLIBRARY_TOKEN no servidor (App ID|App Secret) e faça redeploy.';
      } else if (reason.includes('permission') || reason.includes('identity') || reason.includes('authoriz') || reason.includes('(#10)') || reason.includes('(#200)')) {
        resumo = 'O app da Meta ainda NÃO tem acesso aos anúncios políticos — conclua a "Confirmação de identidade / verificação de negócio" no Meta for Developers.';
      } else if (reason && reason !== 'sem_termo') {
        resumo = `A Biblioteca de Anúncios retornou: ${adlib.reason}. Verifique o token/permissões.`;
      } else {
        resumo = 'Nenhum anúncio político/social encontrado para este nome (pode ser que o adversário não faça anúncios pagos, ou use outro nome de página).';
      }
      dossier.anunciosMeta = {
        resumo,
        total: 0,
        exemplos: [],
        verificarEm: `https://www.facebook.com/ads/library/?active_status=all&ad_type=political_and_issue_ads&country=BR&q=${encodeURIComponent(nome)}`,
      };
    }
    const { data: saved, error } = await supabase.from('competitor_intel').insert({
      campaignId, name: nome, cargo: cargo || null, cidade: cidade || null, uf: uf || null,
      dossier: dossier ?? null,
      narrative: dossier ? null : result.text,
      createdBy: userId,
    }).select('*').single();
    if (error) return res.status(500).json({ error: 'save_failed', detail: error.message });

    // RAG: indexa o dossiê na memória da campanha (best-effort, não bloqueia).
    const texto = dossier
      ? [
          `Dossiê de inteligência competitiva — ${nome}${cargo ? ` (${cargo})` : ''}${cidade ? ` — ${cidade}/${uf || ''}` : ''}.`,
          dossier.resumo,
          dossier.pautasPrincipais?.length ? `Pautas: ${dossier.pautasPrincipais.join('; ')}` : '',
          dossier.narrativas?.length ? `Narrativas: ${dossier.narrativas.join('; ')}` : '',
          dossier.pontosFortes?.length ? `Forças: ${dossier.pontosFortes.join('; ')}` : '',
          dossier.pontosFracos?.length ? `Fraquezas: ${dossier.pontosFracos.join('; ')}` : '',
          dossier.ameacasParaNos?.length ? `Ameaças p/ nós: ${dossier.ameacasParaNos.join('; ')}` : '',
          dossier.oportunidadesParaNos?.length ? `Oportunidades p/ nós: ${dossier.oportunidadesParaNos.join('; ')}` : '',
          dossier.recomendacoes?.length ? `Recomendações: ${dossier.recomendacoes.join('; ')}` : '',
        ].filter(Boolean).join('\n')
      : (result.text || '');
    void ingestArtifact(supabase, {
      campaignId, source: 'intel:adversary', title: `Adversário: ${nome}`,
      text: texto, metadata: { adversario: nome, cargo: cargo || null, intelId: (saved as any)?.id },
    });

    return res.json({ intel: saved, provider: result.provider, model: result.model });
  });

  // Memória da campanha (RAG) — o que os agentes já indexaram.
  router.get('/memory', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { data, error } = await supabase.from('knowledge_chunks')
      .select('source, content, "createdAt"').eq('campaignId', campaignId)
      .order('createdAt', { ascending: false }).limit(200);
    if (error) return res.json({ total: 0, bySource: {}, recent: [] });
    const rows = data ?? [];
    const bySource: Record<string, number> = {};
    rows.forEach((r: any) => { bySource[r.source] = (bySource[r.source] || 0) + 1; });
    const recent = rows.slice(0, 12).map((r: any) => ({ source: r.source, snippet: String(r.content || '').slice(0, 140), createdAt: r.createdAt }));
    return res.json({ total: rows.length, bySource, recent });
  });

  // Reprocessa um dossiê que ficou como texto cru (re-parseia o narrative já
  // salvo com o parser corrigido — SEM nova pesquisa/custo de IA).
  router.post('/adversaries/:id/reprocess', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { data: rec } = await supabase.from('competitor_intel')
      .select('*').eq('id', req.params.id).eq('campaignId', campaignId).maybeSingle();
    if (!rec) return res.status(404).json({ error: 'not_found' });
    const text = (rec as any).narrative || ((rec as any).dossier ? JSON.stringify((rec as any).dossier) : '');
    const dossier = parseJsonLoose(text);
    if (!dossier) return res.status(422).json({ error: 'parse_failed', detail: 'Não foi possível estruturar — rode "Analisar de novo".' });
    const { data: saved, error } = await supabase.from('competitor_intel')
      .update({ dossier, narrative: null, updatedAt: new Date().toISOString() })
      .eq('id', req.params.id).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ intel: saved });
  });

  router.get('/adversaries', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { data, error } = await supabase.from('competitor_intel')
      .select('*').eq('campaignId', campaignId).order('createdAt', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ adversaries: data ?? [] });
  });

  router.delete('/adversaries/:id', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });
    const { error } = await supabase.from('competitor_intel').delete().eq('id', req.params.id).eq('campaignId', campaignId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  });

  return router;
}
