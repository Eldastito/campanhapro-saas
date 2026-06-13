export type TeamMemberRole = 'Coordenador' | 'Líder' | 'Apoiador' | 'Colaborador' | 'Pesquisador' | 'blocked';

export interface TeamMember {
    id: string | number;
    campaignId?: string;
    uid?: string;
    name: string;
    role: TeamMemberRole;
    email: string;
    password?: string;
    phone: string;
    assignedLeaderId?: string | number;
    addedBy?: string;
    cost?: number;
    cpf?: string;
    rg?: string;
    voterId?: string;
    address?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    zipcode?: string;
    bankName?: string;
    bankAgency?: string;
    bankAccount?: string;
    pixKey?: string;
    createdAt?: string;
    updatedAt?: string;
    /** ID do auth.users vinculado. null = membro órfão (cadastrado mas sem login).
     *  Quando órfão, o card mostra "Gerar acesso" no TeamManager. */
    userId?: string | null;
}

export interface Location {
    id: string | number;
    campaignId?: string;
    name: string;
    municipality: string;
    createdAt?: string;
}
