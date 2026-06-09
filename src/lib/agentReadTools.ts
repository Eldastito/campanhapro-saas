/**
 * Ferramentas de LEITURA compartilhadas pelos agentes (chat e orquestrador).
 *
 * São "read-only": consultam dados reais da campanha sem efeitos colaterais —
 * seguras para qualquer agente, inclusive sub-agentes acionados pelo Manager.
 * Centralizar aqui evita duplicar handlers entre /api/agents/chat e runManager.
 */
import { getConversionFunnelStats, getTerritorialAlerts } from '../services/intelligenceService';
import { getLeaderConversionStats } from '../services/engagementService';
import { retrieveContext } from '../server/modules/rag/knowledgeIngest';

/** Definições (formato OpenAI) das ferramentas de leitura. */
export const READ_TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'get_competitive_intel',
      description: 'Retorna os dossiês de Inteligência Competitiva dos adversários já pesquisados (resumo, pontos fracos, ameaças para nós, recomendações). Use SEMPRE que precisar basear estratégia, conteúdo ou resposta em dados reais do oponente.',
      parameters: { type: 'object', properties: { nome: { type: 'string', description: 'opcional: filtra por nome do adversário' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_team_activity',
      description: 'Retorna o desempenho das lideranças/equipe: total de contatos, conversões e taxa por líder.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_conversion_funnel',
      description: 'Retorna as estatísticas do funil de conversão (quantos eleitores em cada estágio da jornada).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_territorial_gap',
      description: 'Analisa os bairros com maior diferença entre visitas realizadas e potencial de votos (Gaps Territoriais).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_campaign_memory',
      description: 'Busca na memória de longo prazo da campanha (dossiês, reuniões, análises anteriores) por um assunto específico.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
];

const READ_TOOL_NAMES = new Set(READ_TOOL_DEFS.map((t) => t.function.name));
export const isReadTool = (name: string): boolean => READ_TOOL_NAMES.has(name);

/**
 * Executa uma ferramenta de leitura. Retorna o objeto de saída (nunca lança —
 * em erro devolve um objeto com `error`).
 */
export async function executeReadTool(
  supabaseAdmin: any,
  campaignId: string,
  name: string,
  args: any
): Promise<any> {
  try {
    if (name === 'get_competitive_intel') {
      if (!supabaseAdmin) return { adversarios: [], total: 0 };
      const { data } = await supabaseAdmin.from('competitor_intel')
        .select('name, cargo, dossier').eq('campaignId', campaignId)
        .order('createdAt', { ascending: false }).limit(10);
      const filtro = String(args?.nome || '').toLowerCase();
      const items = (data || [])
        .filter((r: any) => !filtro || String(r.name || '').toLowerCase().includes(filtro))
        .map((r: any) => ({
          nome: r.name, cargo: r.cargo,
          resumo: r.dossier?.resumo,
          pontosFracos: r.dossier?.pontosFracos,
          ameacasParaNos: r.dossier?.ameacasParaNos,
          recomendacoes: r.dossier?.recomendacoes,
        }));
      return { adversarios: items, total: items.length };
    }
    if (name === 'get_team_activity') {
      const stats = await getLeaderConversionStats(campaignId);
      return { equipe: stats };
    }
    if (name === 'get_conversion_funnel') {
      const stats = await getConversionFunnelStats(campaignId);
      return { funil: stats };
    }
    if (name === 'analyze_territorial_gap') {
      const alerts = await getTerritorialAlerts(campaignId);
      return { gaps_territoriais: alerts };
    }
    if (name === 'search_campaign_memory') {
      const mem = supabaseAdmin ? await retrieveContext(supabaseAdmin, campaignId, String(args?.query || ''), 6) : '';
      return { memoria: mem || 'Nada relevante encontrado na memória.' };
    }
    return { error: `Ferramenta de leitura desconhecida: ${name}` };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}
