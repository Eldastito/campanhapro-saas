export type IncomeSource = 'Doação Pessoal' | 'Recursos Próprios' | 'Partido' | 'Venda de Material' | 'Outra';

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
    createdBy?: string;
    createdAt?: string;
}

export type ExpenseCategory = 'Alimentação' | 'Combustível' | 'Aluguel de Carro' | 'Aluguel de Espaço' | 'Material Gráfico' | 'Pessoal (Ajuda de Custo)' | 'Pessoal (Salário)' | 'Advogado' | 'Contador' | 'Eventos' | 'Marketing Digital' | 'Outra';

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
    createdBy?: string;
    createdAt?: string;
}
