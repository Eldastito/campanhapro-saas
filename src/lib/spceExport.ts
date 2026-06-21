/**
 * Export da Prestação de Contas (SPCE/TSE).
 *
 * Módulo PURO (sem React) — usável pelo frontend (FinancialDashboard) e, no
 * futuro, pelo backend (endpoint de export). É a ÚNICA fonte de verdade do
 * mapeamento Receita/Despesa → colunas da prestação de contas.
 *
 * Dois formatos, conforme decidido com o produto:
 *  - 'planilha': CSV estruturado para o contador (uma tabela de Receitas e uma
 *    de Despesas, com todos os campos TSE). Pronto para uso hoje.
 *  - 'oficial': arquivo no layout de importação em lote do software SPCE do
 *    TSE. Ponto de extensão — depende do spec/arquivo-modelo do ciclo vigente,
 *    que ainda não foi fornecido. Ver `buildOficialSpce`.
 */
import type { Income, Expense } from '../types/financial';

export type SpceFormat = 'planilha' | 'oficial';

// Separador `;`: padrão do Excel pt-BR (vírgula é separador decimal). Com `;`
// os valores "1.234,56" não quebram colunas.
const SEP = ';';
// BOM UTF-8 para o Excel abrir acentos corretamente.
const BOM = '﻿';

function escapeCsv(value: unknown): string {
  const s = value == null ? '' : String(value);
  // Aspas se contiver separador, aspas ou quebra de linha.
  if (s.includes(SEP) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Valor monetário no padrão pt-BR: 1234.5 → "1.234,50". */
function formatBrl(value: number): string {
  return (value ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Converte 'YYYY-MM-DD' (ou ISO) para 'DD/MM/AAAA' exigido pelo TSE. */
function formatDateBr(iso?: string): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return iso; // já em outro formato → mantém
}

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [
    headers.map(escapeCsv).join(SEP),
    ...rows.map((r) => r.map(escapeCsv).join(SEP)),
  ];
  return BOM + lines.join('\r\n');
}

// Ordem das colunas alinhada à ficha de Receitas da prestação de contas (TSE).
const RECEITA_HEADERS = [
  'Data', 'Espécie', 'Fonte de Recurso', 'Conta Receptora', 'Origem',
  'Doador', 'CPF/CNPJ', 'Recibo Eleitoral', 'Tipo de Documento', 'Descrição', 'Valor (R$)',
];

export function buildReceitasCsv(incomes: Income[]): string {
  const rows = incomes.map((i) => [
    formatDateBr(i.data),
    i.especie ?? '',
    i.fonteRecurso ?? '',
    i.contaReceptora ?? '',
    i.origem ?? '',
    i.doador ?? '',
    i.documentoDoador ?? '',
    i.reciboEleitoral ?? '',
    i.tipoDocumento ?? '',
    i.descricao ?? '',
    formatBrl(i.valor),
  ]);
  return toCsv(RECEITA_HEADERS, rows);
}

// Ordem das colunas alinhada à ficha de Despesas da prestação de contas (TSE).
const DESPESA_HEADERS = [
  'Data (Fato Gerador)', 'Data Pagamento', 'Tipo de Gasto (TSE)', 'Categoria',
  'Forma de Pagamento', 'Fornecedor', 'CPF/CNPJ', 'Tipo de Documento',
  'Nota Fiscal', 'Situação Documento', 'Descrição', 'Valor (R$)',
];

export function buildDespesasCsv(expenses: Expense[]): string {
  const rows = expenses.map((e) => [
    formatDateBr(e.data),
    formatDateBr(e.dataPagamento),
    e.tipoGasto ?? '',
    e.categoria ?? '',
    e.formaPagamento ?? '',
    e.fornecedor ?? '',
    e.documentoFornecedor ?? '',
    e.tipoDocumento ?? '',
    e.notaFiscalUrl ? 'Anexada' : 'Faltante',
    e.statusDocumento ?? '',
    e.descricao ?? '',
    formatBrl(e.valor),
  ]);
  return toCsv(DESPESA_HEADERS, rows);
}

export interface SpceFile {
  filename: string;
  content: string;
  mimeType: string;
}

/**
 * Monta os arquivos da planilha do contador: Receitas e Despesas separadas
 * (espelha a estrutura da prestação de contas — fichas distintas). Cada uma é
 * uma tabela limpa, pronta pra importar no SPCE manualmente ou conferir.
 */
export function buildSpcePlanilha(incomes: Income[], expenses: Expense[], dateTag?: string): SpceFile[] {
  const tag = dateTag ?? new Date().toISOString().split('T')[0];
  const mimeType = 'text/csv;charset=utf-8;';
  return [
    { filename: `SPCE_Receitas_${tag}.csv`, content: buildReceitasCsv(incomes), mimeType },
    { filename: `SPCE_Despesas_${tag}.csv`, content: buildDespesasCsv(expenses), mimeType },
  ];
}

/**
 * Layout oficial de importação em lote do SPCE (TSE). Ponto de extensão: o
 * formato exato (ordem dos campos, separador, encoding, posições fixas) muda a
 * cada ciclo eleitoral e precisa do spec/arquivo-modelo oficial. Enquanto o
 * spec não for fornecido, não geramos um arquivo que o SPCE rejeitaria.
 */
export function buildOficialSpce(_incomes: Income[], _expenses: Expense[]): SpceFile[] {
  throw new Error(
    'Layout oficial do SPCE ainda não configurado. Forneça o arquivo-modelo/spec ' +
    'de importação do TSE (ciclo vigente) para mapearmos campo a campo.'
  );
}

/** Dispatcher por formato. */
export function buildSpceExport(format: SpceFormat, incomes: Income[], expenses: Expense[]): SpceFile[] {
  return format === 'oficial'
    ? buildOficialSpce(incomes, expenses)
    : buildSpcePlanilha(incomes, expenses);
}
