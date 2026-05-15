export type EngagementType = 'Abordagem Rápida' | 'Distribuição de Material' | 'Evento';
export type Sentiment = 'Positivo' | 'Neutro' | 'Negativo';

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
    targetAudience?: string;
    createdAt?: string;
    createdBy?: string;
}
