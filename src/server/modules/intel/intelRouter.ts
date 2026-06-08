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

function parseJsonLoose(text: string): any | null {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch { /* tenta recortar */ }
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* */ } }
  return null;
}

const SYSTEM = `Você é um analista de INTELIGÊNCIA COMPETITIVA ELEITORAL.
Pesquise EXCLUSIVAMENTE fontes públicas e cite-as: redes sociais públicas
(Instagram, TikTok, X, YouTube, Facebook), portais de notícias regionais e
nacionais, TSE/DivulgaCand, e a Biblioteca de Anúncios da Meta (Ad Library,
que mantém anúncios político/sociais por ~7 anos).
Regras: nunca invente dados — se não encontrar, diga "não encontrado". Nunca
sugira ataque pessoal: foque em propostas, pautas, narrativas e desempenho.
Responda SOMENTE com um objeto JSON válido, sem texto fora dele.`;

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
      `}` + adContext;

    let result;
    try {
      result = await callAgent(supabase, 'competitive_intel', prompt, {
        campaignId,
        userId,
        systemInstruction: SYSTEM,
        complexity: 'premium',
        enableWebSearch: true,
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
      dossier.anunciosMeta = {
        resumo: adlib.reason === 'sem_token'
          ? 'Biblioteca de Anúncios não configurada — defina META_ADLIBRARY_TOKEN no servidor para dados estruturados.'
          : 'Nenhum anúncio político/social encontrado na Biblioteca de Anúncios da Meta.',
        total: 0, exemplos: [],
      };
    }
    const { data: saved, error } = await supabase.from('competitor_intel').insert({
      campaignId, name: nome, cargo: cargo || null, cidade: cidade || null, uf: uf || null,
      dossier: dossier ?? null,
      narrative: dossier ? null : result.text,
      createdBy: userId,
    }).select('*').single();
    if (error) return res.status(500).json({ error: 'save_failed', detail: error.message });

    return res.json({ intel: saved, provider: result.provider, model: result.model });
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
