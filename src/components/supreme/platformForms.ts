/**
 * Catálogo dos formulários REAIS da plataforma (campos hardcoded em cada tela),
 * por perfil de uso. Serve para o Supreme Admin revisar com o cliente o que cada
 * formulário captura e decidir o que adicionar/remover/ocultar.
 *
 * Mantido manualmente a partir dos componentes em src/components/**. Se um form
 * mudar, atualize aqui. `customFields` indica se o form já aceita campos
 * personalizados via Form Builder (config.customFields[target]).
 */

export type CatalogFieldType =
  | 'text' | 'tel' | 'email' | 'password' | 'number' | 'date' | 'time'
  | 'select' | 'textarea' | 'toggle' | 'checkbox' | 'file' | 'image'
  | 'buttongroup' | 'multiselect';

export interface CatalogField {
  label: string;
  type: CatalogFieldType;
  required?: boolean;
  options?: string[];
  note?: string; // condicional, origem dinâmica, etc.
}

export interface PlatformForm {
  id: string;
  name: string;
  profiles: string[];      // perfis que usam
  purpose: string;
  file: string;            // caminho do componente (referência)
  customFields: boolean;   // aceita campos personalizados via Form Builder?
  customTarget?: string;   // chave em customFields (ex.: 'visits')
  fields: CatalogField[];
}

/**
 * Campos NATIVOS (hardcoded) que o Supreme Admin pode OCULTAR por campanha,
 * por alvo do Form Builder. A `key` precisa bater com a checada no componente
 * do formulário (ex.: PesquisaForm lê config.customFields._hidden.pesquisa).
 * Alguns keys representam um BLOCO inteiro (lead, competitiva, disc).
 */
export interface NativeHideableField {
  key: string;
  label: string;
  note?: string;
}
export const NATIVE_HIDEABLE: Record<string, NativeHideableField[]> = {
  pesquisa: [
    { key: 'bairro', label: 'Bairro da Coleta', note: 'campo obrigatório se visível' },
    { key: 'genero', label: 'Gênero' },
    { key: 'faixaEtaria', label: 'Faixa Etária' },
    { key: 'notaBairro', label: 'Nota para o Bairro (1-5)' },
    { key: 'lead', label: 'Identificação do entrevistado', note: 'bloco inteiro — vira contato/lead no CRM' },
    { key: 'competitiva', label: 'Inteligência Competitiva', note: 'bloco inteiro (alimenta o SWOT da IA)' },
    { key: 'intencaoVoto', label: 'Intenção de Voto' },
    { key: 'fatorRejeicao', label: 'Fator de Rejeição' },
    { key: 'consumoNoticias', label: 'Principal Fonte de Informação' },
    { key: 'dorImediata', label: 'Dor Imediata' },
    { key: 'disc', label: 'Perfil Comportamental (DISC)', note: 'bloco inteiro (6 perguntas)' },
    { key: 'observacoes', label: 'Observações de Campo' },
  ],
  visits: [],
  contacts: [],
};

export const PLATFORM_FORMS: PlatformForm[] = [
  {
    id: 'visita', name: 'Visita de Campo', profiles: ['Apoiador', 'Líder', 'Colaborador'],
    purpose: 'Registro de visita porta-a-porta (família, engajamento, votos estimados).',
    file: 'src/components/visits/VisitForm.tsx', customFields: true, customTarget: 'visits',
    fields: [
      { label: 'Data da Visita', type: 'date', required: true },
      { label: 'Hora', type: 'time' },
      { label: 'Responsável (Família)', type: 'text', required: true },
      { label: 'Telefone', type: 'tel' },
      { label: 'Data de Nascimento (Resp.)', type: 'date' },
      { label: 'Município', type: 'select', required: true, note: 'lista de municípios do RJ' },
      { label: 'Bairro', type: 'select', required: true, note: 'filtrado pelo município' },
      { label: 'Apoiador Responsável', type: 'select', required: true, note: 'da equipe' },
      { label: 'Líder de Equipe', type: 'select', note: 'opcional, da equipe' },
      { label: 'Eleitores na casa', type: 'number', required: true },
      { label: 'Participantes', type: 'number', required: true },
      { label: 'Estimativa de Votos', type: 'number', required: true },
      { label: 'Tem Crianças?', type: 'toggle' },
      { label: 'Tem Pet?', type: 'toggle' },
      { label: 'Qual Pet?', type: 'text', note: 'só se "Tem Pet?" = Sim' },
      { label: 'Solicitações / Observações', type: 'textarea' },
      { label: 'Interesse Principal', type: 'text' },
      { label: 'Nível de Engajamento', type: 'select', options: ['Baixo', 'Médio', 'Alto'] },
      { label: 'Observações Qualitativas (para IA)', type: 'textarea' },
      { label: 'Status da Visita', type: 'toggle', note: 'Realizada / Pendente' },
    ],
  },
  {
    id: 'pesquisa', name: 'Pesquisa Quantitativa', profiles: ['Pesquisador', 'Coordenador'],
    purpose: 'Perfil do eleitor: intenção de voto, dor imediata, fonte de informação e DISC.',
    file: 'src/components/pesquisa/PesquisaForm.tsx', customFields: false, customTarget: 'pesquisa',
    fields: [
      { label: 'Bairro da Coleta', type: 'text', required: true },
      { label: 'Gênero', type: 'select', options: ['Masculino', 'Feminino', 'Outro', 'Não informar'] },
      { label: 'Faixa Etária', type: 'select', options: ['16-24', '25-34', '35-44', '45-59', '60+'] },
      { label: 'Nota para o Bairro (1-5)', type: 'select', options: ['1-Péssimo', '2-Ruim', '3-Regular', '4-Bom', '5-Excelente'] },
      { label: 'Intenção de Voto', type: 'select', options: ['Votaria no Candidato', 'Votaria na Oposição', 'Branco/Nulo', 'Indeciso'] },
      { label: 'Fator de Rejeição', type: 'select', options: ['Corrupção', 'Extremismo Político', 'Inexperiência Administrativa', 'Propostas Irreais', 'Sem grande rejeição'] },
      { label: 'Principal Fonte de Informação', type: 'select', options: ['Grupos de WhatsApp', 'Instagram/TikTok', 'Facebook', 'TV/Jornais Locais', 'Boca a boca', 'Igreja/Comunidade', 'Outros'] },
      { label: 'Dor Imediata', type: 'select', note: 'saúde, creche/escola, segurança, mobilidade, emprego, infraestrutura, lazer' },
      { label: '1. Atitude Predominante (DISC)', type: 'select' },
      { label: '2. Prioridade no Dia a Dia (DISC)', type: 'select' },
      { label: '3. Reação sob Pressão (DISC)', type: 'select' },
      { label: '4. Estilo de Comunicação (DISC)', type: 'select' },
      { label: '5. Tomada de Decisão (DISC)', type: 'select' },
      { label: '6. Ritmo de Trabalho (DISC)', type: 'select' },
      { label: 'Observações de Campo', type: 'text' },
    ],
  },
  {
    id: 'crm', name: 'CRM — Novo Contato', profiles: ['Coordenador', 'Líder'],
    purpose: 'Cadastro de eleitor/contato com classificação e pautas de interesse.',
    file: 'src/pages/CRMPage.tsx', customFields: false, customTarget: 'contacts',
    fields: [
      { label: 'Nome', type: 'text', required: true },
      { label: 'Telefone', type: 'tel' },
      { label: 'Classificação', type: 'select', options: ['Neutro', 'Indeciso', 'Apoiador', 'Multiplicador', 'Rejeição'] },
      { label: 'Bairro', type: 'text' },
      { label: 'Zona Eleitoral', type: 'text' },
      { label: 'Seção Eleitoral', type: 'text' },
      { label: 'Pautas de Interesse (Tags)', type: 'multiselect' },
    ],
  },
  {
    id: 'engajamento', name: 'Engajamento', profiles: ['Apoiador', 'Colaborador'],
    purpose: 'Registro de ações de campo (abordagem, distribuição de material, evento).',
    file: 'src/components/engagement/EngagementForm.tsx', customFields: false,
    fields: [
      { label: 'Data', type: 'date', required: true },
      { label: 'Apoiador Responsável', type: 'select', required: true, note: 'da equipe' },
      { label: 'Tipo de Ação', type: 'select', options: ['Abordagem Rápida', 'Distribuição de Material', 'Evento'] },
      { label: 'Local da Abordagem', type: 'text', note: 'se Abordagem Rápida' },
      { label: 'Sentimento', type: 'select', options: ['Positivo', 'Neutro', 'Negativo'], note: 'se Abordagem Rápida' },
      { label: 'Local da Distribuição', type: 'text', note: 'se Distribuição' },
      { label: 'Material Distribuído (Qtd)', type: 'number', note: 'se Distribuição' },
      { label: 'Nome do Evento', type: 'text', note: 'se Evento' },
      { label: 'Pessoas Contatadas (Aprox.)', type: 'number', note: 'se Evento' },
    ],
  },
  {
    id: 'reporte_rua', name: 'Reporte de Rua', profiles: ['Apoiador', 'Colaborador', 'Pesquisador'],
    purpose: 'Check-in de clima nas ruas em tempo real, enviado ao comando de campo.',
    file: 'src/components/street/StreetReportForm.tsx', customFields: false,
    fields: [
      { label: 'Bairro / Região atual', type: 'text', required: true },
      { label: 'Clima nas ruas (Sentimento)', type: 'buttongroup', required: true, options: ['Positivo', 'Neutro', 'Negativo'] },
      { label: 'Principal reclamação ouvida', type: 'textarea' },
    ],
  },
  {
    id: 'equipe', name: 'Cadastro de Equipe', profiles: ['Admin', 'Coordenador'],
    purpose: 'Cadastro de membro da equipe: dados pessoais, endereço, bancários e função.',
    file: 'src/components/resources/TeamManager.tsx', customFields: false,
    fields: [
      { label: 'Nome Completo', type: 'text', required: true },
      { label: 'Email (para login)', type: 'email', required: true },
      { label: 'Telefone', type: 'tel', required: true },
      { label: 'Senha', type: 'password', note: 'só na criação' },
      { label: 'Custo Mensal (R$)', type: 'number' },
      { label: 'CPF', type: 'text' },
      { label: 'RG', type: 'text' },
      { label: 'Título Eleitor', type: 'text' },
      { label: 'Função', type: 'select', options: ['Apoiador', 'Líder', 'Colaborador'] },
      { label: 'CEP', type: 'text' },
      { label: 'Logradouro', type: 'text' },
      { label: 'Bairro', type: 'text' },
      { label: 'Município', type: 'text' },
      { label: 'Estado (UF)', type: 'text' },
      { label: 'Nome do Banco', type: 'text' },
      { label: 'Agência', type: 'text' },
      { label: 'Conta', type: 'text' },
      { label: 'Chave PIX', type: 'text' },
    ],
  },
  {
    id: 'despesa', name: 'Despesa (Financeiro)', profiles: ['Admin', 'Coordenador', 'Tesoureiro'],
    purpose: 'Registro de despesa com fornecedor, comprovante e categoria.',
    file: 'src/components/financial/ExpenseForm.tsx', customFields: false,
    fields: [
      { label: 'Data', type: 'date', required: true },
      { label: 'Valor (R$)', type: 'text', required: true },
      { label: 'Categoria da Despesa', type: 'select', note: 'alimentação, combustível, aluguel, gráfica, pessoal, advogado, contador, eventos, marketing...' },
      { label: 'Fornecedor', type: 'text', required: true },
      { label: 'CPF/CNPJ do Fornecedor', type: 'text', required: true },
      { label: 'Descrição', type: 'text', required: true },
      { label: 'Tipo de Comprovante', type: 'select', options: ['Nota Fiscal', 'Cupom Fiscal', 'Recibo', 'Contrato', 'Outro'] },
      { label: 'Nota Fiscal/Anexo', type: 'file' },
    ],
  },
  {
    id: 'receita', name: 'Receita (Financeiro)', profiles: ['Admin', 'Coordenador', 'Tesoureiro'],
    purpose: 'Registro de receita/doação com documentação do doador.',
    file: 'src/components/financial/IncomeForm.tsx', customFields: false,
    fields: [
      { label: 'Data', type: 'date', required: true },
      { label: 'Valor (R$)', type: 'text', required: true },
      { label: 'Origem da Receita', type: 'select', options: ['Doação Pessoal', 'Recursos Próprios', 'Partido', 'Venda de Material', 'Outra'] },
      { label: 'Nome do Doador', type: 'text', note: 'se Doação Pessoal' },
      { label: 'CPF do Doador', type: 'text', note: 'se Doação Pessoal' },
      { label: 'Instituição/Doador', type: 'text', note: 'se Partido/Outra' },
      { label: 'CPF/CNPJ', type: 'text', note: 'se Partido/Outra' },
      { label: 'Comprovante', type: 'select', options: ['Recibo', 'Transferência', 'Depósito', 'Outro'] },
      { label: 'Descrição', type: 'text', required: true },
    ],
  },
  {
    id: 'calculadora', name: 'Calculadora de Metas', profiles: ['Admin', 'Coordenador'],
    purpose: 'Projeção de visitas/equipe necessárias a partir da meta de votos.',
    file: 'src/components/calculator/CalculatorForm.tsx', customFields: false,
    fields: [
      { label: 'Meta de Votos', type: 'number' },
      { label: 'Data da Eleição', type: 'date' },
      { label: 'Dias de Visita/Semana', type: 'number' },
      { label: 'Capacidade de Visitas/Dia', type: 'number' },
      { label: 'Votos/Família (Base)', type: 'number' },
      { label: 'Buffer % (não comparecimento)', type: 'number' },
    ],
  },
  {
    id: 'config_campanha', name: 'Informações da Campanha', profiles: ['Admin', 'Coordenador'],
    purpose: 'Dados do candidato, número de urna, partido, alvo eleitoral e orçamento.',
    file: 'src/components/settings/CampaignDetailsForm.tsx', customFields: false,
    fields: [
      { label: 'Nome Completo do Candidato', type: 'text', required: true },
      { label: 'Nome de Urna', type: 'text' },
      { label: 'Cargo Disputado', type: 'select', note: 'Prefeito, Vereador, Deputado...' },
      { label: 'Número de Urna', type: 'text' },
      { label: 'Partido', type: 'text' },
      { label: 'CNPJ da Campanha', type: 'text', required: true },
      { label: 'CPF', type: 'text', required: true },
      { label: 'Identidade (RG)', type: 'text', required: true },
      { label: 'Data de Nascimento', type: 'date' },
      { label: 'Estado Civil', type: 'text' },
      { label: 'Endereço Completo', type: 'text' },
      { label: 'Cidade', type: 'text' },
      { label: 'Estado', type: 'text' },
      { label: 'CEP', type: 'text' },
      { label: 'Data da Eleição', type: 'date' },
      { label: 'UF da Eleição', type: 'text' },
      { label: 'Cidade da Eleição', type: 'text' },
      { label: 'Turno', type: 'select', options: ['1º turno', '2º turno'] },
      { label: 'Orçamento Total (R$)', type: 'number' },
      { label: 'Foto do Candidato', type: 'image' },
    ],
  },
  {
    id: 'captura_publica', name: 'Captura Pública (Lead)', profiles: ['Público (sem login)'],
    purpose: 'Cidadão se cadastra como apoiador; registra consentimento LGPD.',
    file: 'src/pages/PublicCapturePage.tsx', customFields: false,
    fields: [
      { label: 'Seu Nome Completo', type: 'text', required: true },
      { label: 'WhatsApp (com DDD)', type: 'tel', required: true },
      { label: 'Seu Bairro', type: 'text', required: true },
      { label: 'Data de Nascimento', type: 'date' },
      { label: 'Interesses principais', type: 'multiselect', options: ['Saúde', 'Educação', 'Segurança', 'Causa Animal', 'Emprego', 'Cultura'] },
      { label: 'Consentimento (LGPD)', type: 'checkbox', required: true },
    ],
  },
  {
    id: 'cadastro_equipe_publico', name: 'Cadastro Público de Equipe', profiles: ['Público (convidado)'],
    purpose: 'Membro de equipe se cadastra com dados pessoais e bancários (pagamento).',
    file: 'src/pages/PublicTeamRegistrationPage.tsx', customFields: false,
    fields: [
      { label: 'Nome', type: 'text', required: true },
      { label: 'Email', type: 'email', required: true },
      { label: 'Telefone', type: 'tel', required: true },
      { label: 'CPF', type: 'text', required: true },
      { label: 'RG', type: 'text', required: true },
      { label: 'Título Eleitor', type: 'text', required: true },
      { label: 'CEP', type: 'text', note: 'auto-preenche endereço (ViaCEP)' },
      { label: 'Logradouro', type: 'text' },
      { label: 'Bairro', type: 'text' },
      { label: 'Município', type: 'text' },
      { label: 'Estado', type: 'text' },
      { label: 'Nome do Banco', type: 'text' },
      { label: 'Agência', type: 'text' },
      { label: 'Conta', type: 'text' },
      { label: 'Chave PIX', type: 'text' },
    ],
  },
  {
    id: 'boletim_urna', name: 'Boletim de Urna (Dia da Eleição)', profiles: ['Fiscal'],
    purpose: 'Leitura de BU via QR/foto para apuração em tempo real.',
    file: 'src/pages/ElectionDayPage.tsx', customFields: false,
    fields: [
      { label: 'Seção/Urna (stationId)', type: 'text', note: 'capturado via QR' },
      { label: 'Votos do Candidato', type: 'number', note: 'via OCR/Vision' },
      { label: 'Votos Totais da Seção', type: 'number', note: 'via OCR/Vision' },
    ],
  },
];
