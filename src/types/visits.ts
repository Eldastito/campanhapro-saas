export interface Visit {
  id: string;
  campaignId?: string;
  data: string;
  hora?: string; // HH:MM (24h). Opcional — preenchido para visitas agendadas/realizadas com horário.
  resp: string;
  tel: string;
  nasc: string;
  municipio: string;
  bairro: string;
  apoiador: string;
  eleitores: number;
  participantes: number;
  votos: number;
  pet: 'sim' | 'nao';
  tipoPet?: string;
  criancas: 'sim' | 'nao';
  solicit: string;
  realizada: 'sim' | 'nao';
  lider?: string;
  interesse?: string;
  leaderId?: string;
  nivelEngajamento?: 'baixo' | 'medio' | 'alto';
  observacoesQualitativas?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any; // Permite campos customizados
}
