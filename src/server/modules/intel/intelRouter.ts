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
import { fireOrchestration } from '../../../lib/orchestrationTriggers';
import { executeReadTool } from '../../../lib/agentReadTools';

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
CONTEXTO TEMPORAL (crítico): estamos na ELEIÇÃO DE 2026 (governador, senador,
deputados, presidente). 2024 foi eleição MUNICIPAL (prefeito/vereador). Para
CADA fato (notícia, post, fala), informe a DATA e a qual ciclo/eleição se refere.
PRIORIZE o ciclo de 2026 e o cargo que o alvo disputa AGORA. Rotule
explicitamente o que for de ciclos passados (ex.: "[2024]"). NUNCA misture
ciclos nem atribua a 2026 algo que foi de 2024. Se a data for incerta, escreva
"data não confirmada".
Regras: nunca invente dados — se não encontrar, diga "não encontrado". Nunca
sugira ataque pessoal: foque em propostas, pautas, narrativas e desempenho.
REGRA DE FONTE (obrigatória): toda afirmação FACTUAL (processos, sanções,
patrimônio, números de votação, datas, valores) DEVE vir com a fonte (veículo
ou órgão + URL quando houver) e a data. Se você NÃO tem uma fonte confirmada
para um fato, não o afirme como certo — marque "sem fonte confirmada". É melhor
COMPLETAR poucas informações (frase inteira, sem cortar no meio) do que listar
muitas pela metade. Seja COMPLETO mas CONCISO: 3 a 6 itens por lista, sempre
fechando a frase.
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
      `Use o web_search para CAVAR FUNDO em fontes públicas atuais. Cubra:\n` +
      `- Redes sociais: Instagram, TikTok, X, YouTube, Facebook, e ESPECIALMENTE Kwai, Telegram (canais públicos), LinkedIn e Threads.\n` +
      `- Biblioteca de Anúncios da Meta (facebook.com/ads/library) — anúncios pagos.\n` +
      `- TSE/DivulgaCand: candidatura, número, partido, bens declarados.\n` +
      `- Histórico eleitoral: como foi em eleições anteriores, onde é FORTE e onde é FRACO (bairros/zonas/regiões).\n` +
      `- Processos judiciais, investigações, sanções públicas (TJ/STJ/TCU/TCE/MP).\n` +
      `- Patrimônio e empresas/sócios ligados a ele(a) ou familiares.\n` +
      `- Tendência de busca (Google Trends) e pesquisas de intenção de voto citadas na imprensa.\n\n` +
      `Responda SOMENTE com este JSON:\n` +
      `{\n` +
      `  "resumo": "2-4 frases do momento da candidatura NO CICLO DE 2026",\n` +
      `  "eleicaoAtual": {"ano":2026,"cargo":"cargo que disputa em 2026","situacao":"pré-candidato/confirmado/incerto"},\n` +
      `  "redesSociais": [{"rede":"Instagram|TikTok|Kwai|Telegram|LinkedIn|X|YouTube|Threads","handle":"@...","observacao":"tom/alcance; se citar um post específico, inclua a DATA e o ciclo [2026]/[2024]"}],\n` +
      `  "pautasPrincipais": ["..."],\n` +
      `  "narrativas": ["mensagens/bordões que está usando"],\n` +
      `  "noticiasRecentes": [{"titulo":"...","fonte":"...","data":"AAAA-MM-DD","contexto":"2026 | 2024 | não-eleitoral","url":"...","resumo":"..."}],\n` +
      `  "anunciosMeta": {"resumo":"o que aparece na Biblioteca de Anúncios","exemplos":["..."]},\n` +
      `  "tseDivulgacand": {"resumo":"o que consta no TSE/DivulgaCand","numero":"","partido":"","situacao":"deferido/indeferido/etc","bensDeclarados":"valor total e principais bens, se houver","doadores":["maiores doadores, se houver"],"maioresGastos":["maiores gastos/fornecedores, se houver"]},\n` +
      `  "pontosFortes": ["..."],\n` +
      `  "pontosFracos": ["..."],\n` +
      `  "ameacasParaNos": ["..."],\n` +
      `  "oportunidadesParaNos": ["..."],\n` +
      `  "recomendacoes": ["ações práticas para a nossa campanha"],\n` +
      `  "historicoEleitoral": {"resumo":"desempenho em eleições anteriores","ondeForte":["regiões/bairros/zonas"],"ondeFraco":["..."]},\n` +
      `  "processos": [{"titulo":"processo/investigação/sanção (frase COMPLETA, sem cortar)","fonte":"veículo ou órgão + URL","data":"AAAA-MM ou AAAA"}],\n` +
      `  "patrimonio": {"resumo":"bens declarados/evolução","empresas":["empresas/sócios ligados"],"fonte":"fonte do patrimônio, se houver"},\n` +
      `  "tendencia": "tendência de busca (Google Trends) + pesquisas de intenção citadas",\n` +
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
        maxTokens: 7000, // teto alto p/ o dossiê NÃO truncar (antes 5000 era ignorado → caía em 4000)
      });
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
    if (dossier) {
      dossier.tseDivulgacand = {
        ...(dossier.tseDivulgacand || {}),
        linkOficial: 'https://divulgacandcontas.tse.jus.br/divulgacandcontas/',
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
          dossier.historicoEleitoral?.resumo ? `Histórico eleitoral: ${dossier.historicoEleitoral.resumo}. Forte: ${(dossier.historicoEleitoral.ondeForte || []).join(', ')}. Fraco: ${(dossier.historicoEleitoral.ondeFraco || []).join(', ')}` : '',
          dossier.processos?.length ? `Processos/sanções: ${dossier.processos.map((p: any) => typeof p === 'string' ? p : `${p.titulo || ''}${p.fonte ? ` (${p.fonte}${p.data ? `, ${p.data}` : ''})` : ''}`).join('; ')}` : '',
          dossier.patrimonio?.resumo ? `Patrimônio: ${dossier.patrimonio.resumo}. Empresas: ${(dossier.patrimonio.empresas || []).join(', ')}` : '',
          dossier.tendencia ? `Tendência: ${dossier.tendencia}` : '',
          dossier.tseDivulgacand?.resumo ? `TSE: ${dossier.tseDivulgacand.resumo}. Nº ${dossier.tseDivulgacand.numero || '?'}, ${dossier.tseDivulgacand.partido || '?'}. Bens: ${dossier.tseDivulgacand.bensDeclarados || '—'}` : '',
        ].filter(Boolean).join('\n')
      : (result.text || '');
    void ingestArtifact(supabase, {
      campaignId, source: 'intel:adversary', title: `Adversário: ${nome}`,
      text: texto, metadata: { adversario: nome, cargo: cargo || null, intelId: (saved as any)?.id },
    });

    // GATILHO POR EVENTO: novo dossiê estruturado → o orquestrador o transforma
    // em estratégia automaticamente. Só para campanhas com IA proativa habilitada
    // (controle de custo — evita disparo-surpresa de orquestração).
    if (dossier && saved) {
      try {
        const { data: camp } = await supabase.from('campaigns')
          .select('"proactiveMonitoringEnabled"').eq('id', campaignId).maybeSingle();
        if ((camp as any)?.proactiveMonitoringEnabled) {
          fireOrchestration(supabase, {
            campaignId,
            source: 'intel_dossier_saved',
            intent: `Um novo dossiê de Inteligência Competitiva sobre "${nome}"${cargo ? ` (${cargo})` : ''} acabou de ser gerado. ` +
              `Use a ferramenta get_competitive_intel para lê-lo, analise os pontos fracos e ameaças do adversário e produza ` +
              `recomendações estratégicas ACIONÁVEIS para a NOSSA campanha (bairros/temas/conteúdo). ` +
              `Publique os 1-3 alertas mais importantes no war room. Seja eficiente: no máximo 3 rodadas.`,
          });
        }
      } catch { /* gatilho é best-effort, nunca quebra a resposta */ }
    }

    return res.json({ intel: saved, provider: result.provider, model: result.model });
  });

  // PLANO DE BATALHA — "do dossiê à ação". O Estrategista lê os dossiês dos
  // adversários + funil + gaps territoriais e devolve um plano semanal acionável,
  // que é GRAVADO em Objetivos (campaign_goals) e Tarefas da equipe (team_tasks).
  router.post('/battle-plan', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    const userId = (req as any).user?.id ?? null;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    // 1. Reúne contexto real (reusa as ferramentas de leitura).
    const [intel, funil, terr] = await Promise.all([
      executeReadTool(supabase, campaignId, 'get_competitive_intel', {}),
      executeReadTool(supabase, campaignId, 'get_conversion_funnel', {}),
      executeReadTool(supabase, campaignId, 'analyze_territorial_gap', {}),
    ]);

    const SYS_PLAN = `Você é o ESTRATEGISTA-CHEFE de uma campanha eleitoral (eleição de 2026).
Transforme inteligência e dados em um PLANO DE BATALHA SEMANAL, concreto e executável.
Baseie-se nos DADOS REAIS fornecidos (dossiês de adversários, funil, gaps territoriais).
Nunca invente dados. Foque onde o adversário é fraco e onde temos estrutura ociosa.
Nunca proponha ataque pessoal — só contraposição de propostas/desempenho.
Responda APENAS um objeto JSON válido (sem markdown, sem preâmbulo).`;

    const prompt =
      `DADOS REAIS DA CAMPANHA:\n` +
      `# Dossiês de adversários:\n${JSON.stringify(intel).slice(0, 4000)}\n\n` +
      `# Funil de conversão:\n${JSON.stringify(funil).slice(0, 1500)}\n\n` +
      `# Gaps territoriais (bairros sub-atendidos):\n${JSON.stringify(terr).slice(0, 2000)}\n\n` +
      `Gere o PLANO DE BATALHA da semana SOMENTE neste JSON:\n` +
      `{\n` +
      `  "resumo": "1-2 frases do foco estratégico da semana",\n` +
      `  "objetivos": [{"title":"objetivo tático","description":"por que / como","priority":"critical|high|medium|low","dueDate":"AAAA-MM-DD"}],\n` +
      `  "tarefas": [{"title":"tarefa de campo concreta","description":"o que fazer","bairro":"bairro/região alvo","dueDate":"AAAA-MM-DD"}],\n` +
      `  "conteudo": [{"tema":"...","formato":"post|vídeo|card","angulo":"mensagem"}]\n` +
      `}\n` +
      `Regras: 3 a 5 objetivos, 4 a 8 tarefas (cada uma ligada a um bairro real dos gaps quando possível), 2 a 4 ideias de conteúdo. Frases completas.`;

    let result;
    try {
      result = await callAgent(supabase, 'strategist', prompt, {
        campaignId, userId, systemInstruction: SYS_PLAN, complexity: 'premium', maxTokens: 4000,
      });
    } catch (err: any) {
      if (err instanceof BudgetExceededError) return res.status(402).json({ error: 'ai_budget_exceeded', detail: err.message });
      return res.status(502).json({ error: 'ai_call_failed', detail: err?.message });
    }

    const plan = parseJsonLoose(result.text);
    if (!plan) return res.status(422).json({ error: 'parse_failed', detail: 'A IA não retornou um plano estruturado. Tente de novo.' });

    // 2. Persiste OBJETIVOS em campaign_goals (nível tático).
    const objetivos = Array.isArray(plan.objetivos) ? plan.objetivos : [];
    const goalRows = objetivos.slice(0, 8).map((o: any) => ({
      campaignId, title: String(o.title || 'Objetivo').slice(0, 300),
      description: o.description ? String(o.description).slice(0, 1000) : null,
      level: 'tactical', status: 'planned',
      priority: ['critical', 'high', 'medium', 'low'].includes(o.priority) ? o.priority : 'medium',
      ownerAgentId: 'strategist',
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(o.dueDate || '') ? o.dueDate : null,
      metadata: { source: 'battle_plan', generatedAt: new Date().toISOString() },
    }));
    let goalsCreated = 0;
    if (goalRows.length) {
      const { data, error } = await supabase.from('campaign_goals').insert(goalRows).select('id');
      if (!error) goalsCreated = (data || []).length;
    }

    // 3. Persiste TAREFAS em team_tasks (sem atribuição — o líder atribui na UI).
    const tarefas = Array.isArray(plan.tarefas) ? plan.tarefas : [];
    const taskRows = tarefas.slice(0, 12).map((t: any) => ({
      campaignId, leaderId: null, assignedToUserId: null, assignedToName: 'A definir',
      title: String(t.title || 'Tarefa').slice(0, 300),
      description: t.description ? String(t.description).slice(0, 1000) : null,
      bairro: t.bairro ? String(t.bairro).slice(0, 120) : null,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate || '') ? t.dueDate : null,
      status: 'pendente', createdBy: userId,
    }));
    let tasksCreated = 0;
    if (taskRows.length) {
      const { data, error } = await supabase.from('team_tasks').insert(taskRows).select('id');
      if (!error) tasksCreated = (data || []).length;
    }

    // 4. Indexa o plano na memória (best-effort).
    void ingestArtifact(supabase, {
      campaignId, source: 'strategy:battle_plan', title: 'Plano de batalha da semana',
      text: [plan.resumo, ...objetivos.map((o: any) => `Objetivo: ${o.title}`), ...tarefas.map((t: any) => `Tarefa (${t.bairro || '—'}): ${t.title}`)].filter(Boolean).join('\n'),
      metadata: { goalsCreated, tasksCreated },
    });

    return res.json({ plan, goalsCreated, tasksCreated, provider: result.provider });
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

  /**
   * GET /neighborhood-heat — heat de sentimento por bairro (#52).
   *
   * Agrega contatos (supportLevel) por bairro+município e calcula um score
   * -100..100 onde:
   *   +100 = só apoiadores/multiplicadores
   *      0 = neutro
   *   -100 = só rejeitadores
   *
   * É 100% rule-based / SQL — NÃO chama IA. Roda em milissegundos.
   * Frontend usa pra plotar marcadores coloridos no mapa.
   */
  router.get('/neighborhood-heat', async (req: Request, res: Response) => {
    const campaignId = (req as any).user?.campaignId;
    if (!campaignId) return res.status(401).json({ error: 'Unauthorized' });

    const filterMun = (req.query.municipio as string) || undefined;

    try {
      let q = supabase.from('contacts')
        .select('neighborhood, city, "supportLevel", "supportScore", "voteIntention"')
        .eq('campaignId', campaignId)
        .not('neighborhood', 'is', null);
      if (filterMun) q = q.eq('city', filterMun);
      const { data: contacts, error } = await q.limit(20000);
      if (error) throw error;

      // Agrega em memória — bairro:municipio é a chave
      const buckets = new Map<string, {
        municipio: string; bairro: string;
        apoiadores: number; multiplicadores: number; simpatizantes: number;
        indecisos: number; rejeitadores: number; desconhecidos: number;
        total: number; topObjection?: string;
      }>();

      for (const c of (contacts ?? [])) {
        const bairro = String((c as any).neighborhood || '').trim();
        if (!bairro) continue;
        const municipio = String((c as any).city || '').trim();
        const key = `${bairro}::${municipio}`;
        let b = buckets.get(key);
        if (!b) {
          b = { municipio, bairro, apoiadores: 0, multiplicadores: 0, simpatizantes: 0,
                indecisos: 0, rejeitadores: 0, desconhecidos: 0, total: 0 };
          buckets.set(key, b);
        }
        const level = (c as any).supportLevel;
        switch (level) {
          case 'apoiador': b.apoiadores++; break;
          case 'multiplicador': b.multiplicadores++; break;
          case 'simpatizante': b.simpatizantes++; break;
          case 'indeciso': b.indecisos++; break;
          case 'rejeitador': b.rejeitadores++; break;
          default: b.desconhecidos++;
        }
        b.total++;
      }

      // Score: positivos (apoiador+multi+simpatizante*0.5) menos negativos (rejeitador)
      // dividido pelos CLASSIFICADOS (exclui desconhecidos do denominador) * 100.
      // Se não tem nenhum classificado, score=0.
      const heat = Array.from(buckets.values()).map((b) => {
        const classificados = b.total - b.desconhecidos;
        const positivos = b.apoiadores + b.multiplicadores + b.simpatizantes * 0.5;
        const score = classificados > 0
          ? Math.round(((positivos - b.rejeitadores) / classificados) * 100)
          : 0;
        const level: 'green' | 'yellow' | 'red' | 'unknown' =
          classificados === 0 ? 'unknown'
          : score >= 30 ? 'green'
          : score >= -10 ? 'yellow'
          : 'red';
        return { ...b, score, level };
      })
      // Ordena por total de contatos (bairros com mais base têm mais peso visual)
      .sort((a, b) => b.total - a.total);

      res.json({ heat, totalBuckets: heat.length, totalContacts: contacts?.length ?? 0 });
    } catch (err: any) {
      console.error('[intel] neighborhood-heat:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
