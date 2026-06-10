export enum Plan {
  ESSENCIAL = 'Essencial',
  ESTRATEGICO = 'Estrategico',
  TOTAL = 'Total',
}

export interface User {
  id: string;
  uid?: string;
  name: string;
  email: string;
  plan: Plan;
}

export interface Permissions {
    visitLimit: number | null;
    canUseCollaborationTools: boolean;
    canExportData: boolean;
    canUseTeamPanels: boolean;
    canUseAIAdvisor: boolean;
    canCreateTeams: boolean;
}

// Tipo unificado para o usuário logado
export interface AuthenticatedUser {
  id: string | number;
  uid?: string;
  name: string;
  email: string;
  type: 'Admin' | 'Coordenador' | 'Líder' | 'Apoiador' | 'Colaborador' | 'Pesquisador' | 'Fiscal' | 'Candidato' | 'Presidente de Partido' | 'Candidato de Partido' | 'Suporte' | 'Manutenção' | 'blocked';
  plan?: Plan;
  role?: string;
  phone?: string;
  assignedLeaderId?: string | number;
  cost?: number;
  campaignId?: string;
  isSupremeAdmin?: boolean;
}
