export type EngagementType = 'Abordagem Rápida' | 'Distribuição de Material' | 'Evento';
export type Sentiment = 'Positivo' | 'Neutro' | 'Negativo';

/** Pessoa identificada durante uma ação de campo. Vira contato no CRM. */
export interface IdentifiedPerson {
    nome: string;
    phone?: string;
    bairro?: string;
    tipo: 'apoiador' | 'indeciso'; // apoiador vira supportLevel='apoiador'; indeciso entra como lead
}

export interface EngagementAction {
    id: string | number;
    campaignId?: string;
    title?: string;
    status?: string;
    data: string;
    apoiador: string;
    tipo: EngagementType;
    local?: string;
    sentimento?: Sentiment;
    materialDistribuido?: number;
    eventoNome?: string;
    pessoasContatadas?: number;
    novosApoiadores?: number;    // conversões: viraram apoiador nesta ação (contador agregado)
    contatosColetados?: number;  // contatos coletados nesta ação (contador agregado)
    /** Lista opcional de pessoas identificadas — cada uma vira um contato real no CRM. */
    pessoasIdentificadas?: IdentifiedPerson[];
    targetAudience?: string;
    createdAt?: string;
    createdBy?: string;
}
