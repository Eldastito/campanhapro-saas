export interface PesquisaEleitoral {
  id: string;
  campaignId?: string;
  data: string;
  entrevistadorId: string;
  bairro: string;
  
  // Demográficos Básicos
  genero: 'masculino' | 'feminino' | 'outro' | 'nao_informado';
  faixaEtaria: '16-24' | '25-34' | '35-44' | '45-59' | '60+';
  
  // Pergunta 1: Intenção de Voto
  intencaoVoto: 'candidato' | 'outro' | 'branco/nulo' | 'indeciso';
  
  // Pergunta 2: Rejeição (Fator Fatal)
  fatorRejeicao: 'corrupcao' | 'extremismo' | 'inexperiencia' | 'propostas_ruins' | 'nenhum';
  
  // Pergunta 3: Canal Principal de Consumo de Informação
  consumoNoticias: 'whatsapp' | 'instagram' | 'facebook' | 'tv' | 'boca_a_boca' | 'igreja' | 'outros';
  
  // Pergunta 4: A maior dor Imediata no Bairro
  dorImediata: 'saude' | 'educacao' | 'seguranca' | 'transporte' | 'emprego' | 'infraestrutura' | 'lazer';
  
  // Pergunta 5: Qualidade de vida geral
  notaBairro: 1 | 2 | 3 | 4 | 5;
  
  // Perfil Comportamental (Respostas rápidas DISC simuladas)
  perfilRespostas: string[]; 
  perfilDisc?: 'D' | 'I' | 'S' | 'C';
  
  observacoes: string;
  createdAt?: any;
}
