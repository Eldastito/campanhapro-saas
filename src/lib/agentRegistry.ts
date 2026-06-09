/**
 * Registry de capacidades dos Agentes de IA.
 *
 * Formaliza, por agente: a missão (uma linha), as FERRAMENTAS que ele pode usar,
 * o que ele CONSOME (entradas) e PRODUZ (saídas), e para quem costuma PASSAR A
 * BOLA (handoff). É a base para o Agente Orquestrador (#64) rotear tarefas de
 * forma determinística — e para escopar as tools por agente (cada um só enxerga
 * o que faz sentido pra sua função).
 */

export interface AgentCapability {
  id: string;
  label: string;
  /** Missão em uma frase — usada pelo orquestrador pra decidir o roteamento. */
  mission: string;
  /** Nomes de ferramentas (AGENT_TOOLS) que este agente PODE chamar. */
  tools: string[];
  /** Tipos de entrada que o agente usa. */
  consumes: string[];
  /** Tipos de saída que o agente entrega. */
  produces: string[];
  /** Agentes para quem ele tipicamente delega o próximo passo. */
  handoffTo: string[];
}

export const AGENT_REGISTRY: Record<string, AgentCapability> = {
  strategist: {
    id: 'strategist', label: 'Estrategista',
    mission: 'Define onde brigar e com que mensagem; transforma inteligência e dados em plano de ação.',
    tools: ['get_competitive_intel', 'get_conversion_funnel', 'analyze_territorial_gap', 'get_team_activity', 'search_campaign_memory', 'publish_war_room_insight'],
    consumes: ['dossiês de adversários', 'funil', 'mapa/zonas', 'metas'],
    produces: ['plano estratégico', 'bairros-alvo', 'temas por região'],
    handoffTo: ['creative', 'social', 'field', 'crm'],
  },
  growth: {
    id: 'growth', label: 'Growth Hacker',
    mission: 'Otimiza aquisição e conversão; decide onde investir esforço/verba pra maximizar votos.',
    tools: ['get_conversion_funnel', 'analyze_territorial_gap', 'get_competitive_intel', 'search_campaign_memory', 'publish_war_room_insight'],
    consumes: ['funil', 'custo-por-voto', 'anúncios do adversário'],
    produces: ['recomendações de alocação', 'experimentos'],
    handoffTo: ['social', 'creative'],
  },
  social: {
    id: 'social', label: 'Social Media',
    mission: 'Define pauta e calendário de redes; responde à narrativa do adversário.',
    tools: ['get_competitive_intel', 'search_campaign_memory', 'open_social_media_studio', 'publish_war_room_insight'],
    consumes: ['narrativas do adversário', 'pautas'],
    produces: ['calendário de posts', 'linhas editoriais'],
    handoffTo: ['creative'],
  },
  field: {
    id: 'field', label: 'Comandante de Campo',
    mission: 'Converte estratégia em roteiros de rua e metas por equipe; monitora atividade.',
    tools: ['analyze_territorial_gap', 'get_team_activity', 'get_conversion_funnel', 'search_campaign_memory', 'publish_war_room_insight'],
    consumes: ['plano estratégico', 'mapa', 'equipe'],
    produces: ['roteiros de visita', 'metas por bairro/líder'],
    handoffTo: ['crm'],
  },
  creative: {
    id: 'creative', label: 'Produtor Criativo',
    mission: 'Produz peças de conteúdo a partir do tema/ângulo definido pela estratégia.',
    tools: ['get_competitive_intel', 'search_campaign_memory', 'generate_dalle_image', 'open_social_media_studio'],
    consumes: ['tema/ângulo', 'pontos fracos do adversário'],
    produces: ['peças (texto/imagem)', 'roteiros de vídeo'],
    handoffTo: ['social'],
  },
  crm: {
    id: 'crm', label: 'Especialista CRM',
    mission: 'Cuida do relacionamento 1:1 e da conversão do indeciso; roteiros de abordagem.',
    tools: ['get_conversion_funnel', 'get_competitive_intel', 'get_team_activity', 'search_campaign_memory'],
    consumes: ['funil', 'objeções', 'narrativas do adversário'],
    produces: ['roteiros de abordagem', 'respostas a objeção'],
    handoffTo: ['field'],
  },
  fraud: {
    id: 'fraud', label: 'Auditor de Fraude',
    mission: 'Detecta dados suspeitos e inconsistências; protege a integridade da operação.',
    tools: ['flag_fraudulent_data', 'get_team_activity', 'search_campaign_memory', 'publish_war_room_insight'],
    consumes: ['reportes', 'cadastros', 'atividade da equipe'],
    produces: ['alertas de fraude', 'flags de auditoria'],
    handoffTo: [],
  },
  backup: {
    id: 'backup', label: 'Guardião de Dados',
    mission: 'Garante segurança e integridade dos dados; dispara snapshots.',
    tools: ['create_backup', 'search_campaign_memory'],
    consumes: ['estado dos dados'],
    produces: ['backups', 'avisos de risco'],
    handoffTo: [],
  },
  secretary: {
    id: 'secretary', label: 'Secretário de Agenda',
    mission: 'Organiza compromissos e gera itens de agenda em JSON estrito.',
    tools: ['search_campaign_memory'],
    consumes: ['pedidos de agenda'],
    produces: ['eventos de agenda'],
    handoffTo: [],
  },
  manager: {
    id: 'manager', label: 'Orquestrador',
    mission: 'Decompõe o objetivo, roteia ao agente certo, avalia o resultado e decide o próximo passo até concluir.',
    tools: ['get_competitive_intel', 'get_conversion_funnel', 'analyze_territorial_gap', 'get_team_activity', 'search_campaign_memory', 'publish_war_room_insight'],
    consumes: ['objetivo do usuário', 'resultados parciais dos agentes'],
    produces: ['plano de execução', 'resultado consolidado'],
    handoffTo: ['strategist', 'growth', 'social', 'field', 'creative', 'crm', 'fraud', 'backup', 'secretary'],
  },
};

/**
 * Dado o array completo de ferramentas (formato OpenAI) e um agentId, retorna só
 * as ferramentas que aquele agente pode usar. Agentes fora do registry (ex.: o
 * chat genérico) recebem o conjunto completo.
 */
export function toolsForAgent<T extends { function?: { name?: string } }>(allTools: T[], agentId?: string): T[] {
  const cap = agentId ? AGENT_REGISTRY[agentId] : undefined;
  if (!cap) return allTools;
  const allowed = new Set(cap.tools);
  return allTools.filter((t) => t.function?.name && allowed.has(t.function.name));
}

/** Resumo textual do time de agentes — injetável no prompt do orquestrador. */
export function registrySummary(): string {
  return Object.values(AGENT_REGISTRY)
    .filter((a) => a.id !== 'manager')
    .map((a) => `- ${a.id} (${a.label}): ${a.mission} Produz: ${a.produces.join(', ')}.`)
    .join('\n');
}
