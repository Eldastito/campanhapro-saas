// Cargos eletivos do Brasil — usados para gerar a numeração de candidatura correta
// e adaptar futuros campos da Prestação de Contas TRE/TSE.
export type CargoEleitoral =
    | 'Vereador'
    | 'Prefeito'
    | 'Vice-Prefeito'
    | 'Deputado Estadual'
    | 'Deputado Distrital'
    | 'Deputado Federal'
    | 'Senador'
    | 'Governador'
    | 'Vice-Governador'
    | 'Presidente'
    | 'Vice-Presidente';

export const CARGOS_ELETIVOS: CargoEleitoral[] = [
    'Vereador',
    'Prefeito',
    'Vice-Prefeito',
    'Deputado Estadual',
    'Deputado Distrital',
    'Deputado Federal',
    'Senador',
    'Governador',
    'Vice-Governador',
    'Presidente',
    'Vice-Presidente',
];

export interface CampaignDetails {
    nomeCompleto: string;
    nomeUrna?: string;
    numero?: string;
    cargo?: CargoEleitoral;
    partido?: string;
    cnpj: string;             // CNPJ da campanha — obrigatório (TSE)
    cpf: string;
    identidade: string;
    dataNascimento: string;
    estadoCivil: string;
    endereco: string;
    cidade: string;
    estado: string;
    cep: string;
    orcamento: number;
    candidatePhotoUrl?: string;

    // Alvo eleitoral (calendário TSE + contexto pra IA)
    electionDate?: string;        // ISO date (YYYY-MM-DD) da eleição alvo
    electionState?: string;       // UF da eleição (ex: 'RJ')
    electionCity?: string;        // município (cargos municipais)
    electionRound?: 1 | 2;        // 1º ou 2º turno

    // Inteligência competitiva — principais adversários (um por linha: "Nome - Número")
    adversarios?: string;
}

export type AdvisorTipType = 'success' | 'warning' | 'info' | 'sparkles' | 'error';

export interface AdvisorTip {
    type: AdvisorTipType;
    title: string;
    message: string;
}
