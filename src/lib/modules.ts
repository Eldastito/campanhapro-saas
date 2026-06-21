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
  // Add-ons: já incluídos no plano Total (feature `scenarios`/`intelligence` no
  // `plans.features`). Quem tem o plano ganha o módulo automaticamente em
  // `active` via mapeamento no modulesRouter — sem cobrar duas vezes. Quem NÃO
  // tem fica em `available` (cross-sell) e pode contratar avulso via
  // `tenant_module_entitlements`.
  {
    key: 'cenarios',
    name: 'Cenários',
    description: 'Simulações Monte Carlo da campanha: cenários eleitorais, projeção de meta e plano B.',
    icon: 'LineChart',
    // O app não usa sub-rotas: a aba "Cenários" é selecionada por nome dentro de
    // /app (gated pela feature `scenarios`). Igual a campanha/partido/callcenter.
    appRoute: '/app',
    salesRoute: '/casos-de-uso',
    sellable: true,
  },
  {
    key: 'inteligencia',
    name: 'Inteligência',
    description: 'Mapeamento estratégico, adversários, sentimento e leitura tática do território.',
    icon: 'Brain',
    appRoute: '/app',
    salesRoute: '/casos-de-uso',
    sellable: true,
  },
];

// Mapeia uma feature do plano (plans.features) para o módulo que ela libera.
// Mantém os planos como fonte primária: quem assina Total NÃO precisa de
// entitlement explícito pra usar Cenários/Inteligência — o plano já paga.
export const PLAN_FEATURE_TO_MODULE: Record<string, string> = {
  scenarios: 'cenarios',
  intelligence: 'inteligencia',
};

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
