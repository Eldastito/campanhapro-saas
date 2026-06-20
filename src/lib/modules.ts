/**
 * Registry de Módulos (Fatia 1 do Control Plane modular).
 *
 * Esta é a ÚNICA fonte de verdade do catálogo de apps da plataforma. Para
 * "adicionar um app novo" à plataforma, basta registrar um ModuleDef aqui e
 * mapear quem tem acesso em `deriveUserModules`. Nada de espalhar regra por
 * vários arquivos.
 *
 * Aditivo/shadow: hoje os módulos são DERIVADOS do estado atual (tipo do usuário
 * + campanha). Quando entrarem as tabelas de entitlement/grant (próximas fatias),
 * só a função de derivação muda — o resto (Hub, rotas) continua igual.
 *
 * Arquivo PURO (sem React) para poder ser importado pelo frontend e pelo backend.
 */

export interface ModuleDef {
  key: string;
  name: string;
  description: string;
  icon: string;          // nome do ícone lucide-react (resolvido na UI)
  appRoute: string;      // pra onde o card leva quando o usuário TEM o módulo
  salesRoute?: string;   // página comercial pública (cross-sell) quando NÃO tem
  sellable: boolean;     // aparece como "disponível para contratar"?
}

export const MODULES: ModuleDef[] = [
  {
    key: 'campanha',
    name: 'Campanha',
    description: 'Gestão completa da campanha: CRM, território, agentes de IA, agenda e cenários.',
    icon: 'Megaphone',
    appRoute: '/app',
    salesRoute: '/casos-de-uso',
    sellable: true,
  },
  {
    key: 'partido',
    name: 'Partido',
    description: 'Painel do presidente: candidatos, repasses, comprovação e telão.',
    icon: 'Landmark',
    appRoute: '/app',
    salesRoute: '/proposta/partido',
    sellable: true,
  },
  {
    key: 'callcenter',
    name: 'Call Center',
    description: 'Estação de atendimento: fila, chat e handoff entre operadores.',
    icon: 'Headphones',
    appRoute: '/app',
    sellable: false,
  },
];

export const moduleByKey = (key: string): ModuleDef | undefined => MODULES.find((m) => m.key === key);

// Papéis que pertencem ao produto "Campanha".
const CAMPAIGN_ROLES = new Set([
  'Admin', 'Coordenador', 'Candidato', 'Líder', 'Pesquisador', 'Fiscal',
  'Apoiador', 'Colaborador', 'Suporte', 'Manutenção',
]);

/**
 * Deriva os módulos ATIVOS de um usuário a partir do estado atual (sem tabelas
 * novas). É a regra de acesso "efetiva" da Fatia 1 — o backend é a fonte
 * autoritativa (modulesRouter chama isto com os dados do token).
 */
export function deriveUserModules(input: {
  userType?: string | null;
  campaignId?: string | null;
  isSupremeAdmin?: boolean | null;
}): string[] {
  const t = (input.userType || '').trim();
  const out: string[] = [];

  // Admin supremo enxerga todos os produtos (governança).
  if (input.isSupremeAdmin) return MODULES.map((m) => m.key);

  if (t === 'Presidente de Partido') out.push('partido');
  if (t === 'Candidato de Partido') out.push('partido');
  if (t === 'Líder Call Center' || t === 'Operador Call Center') out.push('callcenter');
  if (CAMPAIGN_ROLES.has(t) || (input.campaignId && out.length === 0)) out.push('campanha');

  return [...new Set(out)];
}
