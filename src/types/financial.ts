export type IncomeSource = 'Doação Pessoal' | 'Recursos Próprios' | 'Partido' | 'Venda de Material' | 'Outra';

// Campos da prestação de contas eleitoral (TSE/SPCE).
export type IncomeEspecie = 'Financeira' | 'Estimável em bens/serviços';
export type IncomeFonteRecurso =
    | 'Recursos próprios do candidato'
    | 'Doação de pessoa física'
    | 'Doação de outro candidato/partido'
    | 'Fundo Partidário'
    | 'Fundo Especial (FEFC)'
    | 'Financiamento coletivo (internet)'
    | 'Comercialização de bens/eventos'
    | 'Rendimentos de aplicação financeira'
    | 'Outros recursos';
export type IncomeContaReceptora = 'Doações' | 'Fundo Partidário' | 'Fundo Especial (FEFC)' | 'Outros Recursos';

export interface Income {
    id: string | number;
    campaignId?: string;
    data: string;
    origem: IncomeSource;
    doador?: string;
    documentoDoador?: string; // CPF ou CNPJ
    descricao: string;
    valor: number;
    tipoDocumento?: 'Recibo' | 'Transferência' | 'Depósito' | 'Outro';
    // Prestação de contas (TSE/SPCE)
    especie?: IncomeEspecie;
    fonteRecurso?: IncomeFonteRecurso;
    contaReceptora?: IncomeContaReceptora;
    reciboEleitoral?: string; // nº do recibo eleitoral emitido
    createdBy?: string;
    createdAt?: string;
}

export type ExpenseCategory = 'Alimentação' | 'Combustível' | 'Aluguel de Carro' | 'Aluguel de Espaço' | 'Material Gráfico' | 'Pessoal (Ajuda de Custo)' | 'Pessoal (Salário)' | 'Advogado' | 'Contador' | 'Eventos' | 'Marketing Digital' | 'Outra';

// Forma de pagamento e classificação de gasto exigidas pelo TSE.
export type FormaPagamento =
    | 'Dinheiro'
    | 'Cheque'
    | 'Transferência bancária'
    | 'Cartão de débito'
    | 'Cartão de crédito'
    | 'PIX'
    | 'Boleto'
    | 'Outro';
export type TipoGastoTSE =
    | 'Pessoal'
    | 'Material de campanha (gráfico)'
    | 'Comícios/eventos'
    | 'Propaganda (rádio/TV/internet)'
    | 'Impulsionamento de conteúdo na internet'
    | 'Combustível e lubrificantes'
    | 'Locação/aquisição de veículos'
    | 'Locação de bens móveis/imóveis'
    | 'Serviços advocatícios/contábeis'
    | 'Alimentação'
    | 'Diárias/hospedagem/viagens'
    | 'Tributos e encargos'
    | 'Outras despesas';

export interface Expense {
    id: string | number;
    campaignId?: string;
    data: string;
    categoria: ExpenseCategory;
    fornecedor?: string;
    documentoFornecedor?: string; // CPF ou CNPJ
    descricao: string;
    valor: number;
    notaFiscalUrl?: string;
    statusDocumento?: 'Pendente' | 'Validado' | 'Recusado';
    tipoDocumento?: 'Nota Fiscal' | 'Cupom Fiscal' | 'Recibo' | 'Contrato' | 'Outro';
    canal?: string;   // atribuição p/ ROI: visita|evento|whatsapp|redes_sociais|marketing_digital|...
    regiao?: string;  // bairro/região do gasto
    // Prestação de contas (TSE/SPCE)
    formaPagamento?: FormaPagamento;
    tipoGasto?: TipoGastoTSE;
    dataPagamento?: string; // data do efetivo pagamento (data = fato gerador)
    createdBy?: string;
    createdAt?: string;
}
