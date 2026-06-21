import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildReceitasCsv, buildDespesasCsv, buildSpcePlanilha, buildOficialSpce } from '../src/lib/spceExport';
import type { Income, Expense } from '../src/types/financial';

const income: Income = {
  id: 1,
  data: '2026-03-15',
  origem: 'Doação Pessoal',
  doador: 'Maria; Silva',
  documentoDoador: '123.456.789-00',
  descricao: 'Doação financeira',
  valor: 1234.5,
  especie: 'Financeira',
  fonteRecurso: 'Doação de pessoa física',
  contaReceptora: 'Doações',
  reciboEleitoral: 'REC-001',
  tipoDocumento: 'Transferência',
};

const expense: Expense = {
  id: 2,
  data: '2026-03-20',
  categoria: 'Material Gráfico',
  fornecedor: 'Gráfica X',
  documentoFornecedor: '12.345.678/0001-99',
  descricao: 'Santinhos',
  valor: 5000,
  tipoGasto: 'Material de campanha (gráfico)',
  formaPagamento: 'PIX',
  dataPagamento: '2026-03-21',
  statusDocumento: 'Validado',
};

describe('spceExport — planilha do contador', () => {
  test('receitas: cabeçalho TSE + data BR + valor pt-BR + escaping de ;', () => {
    const csv = buildReceitasCsv([income]);
    const lines = csv.split('\r\n');
    // BOM no começo para o Excel ler acentos.
    assert.ok(lines[0].startsWith('﻿'));
    assert.ok(lines[0].includes('Fonte de Recurso'));
    assert.ok(lines[0].includes('Recibo Eleitoral'));
    // Data convertida para DD/MM/AAAA.
    assert.ok(lines[1].includes('15/03/2026'));
    // Valor no padrão pt-BR.
    assert.ok(lines[1].includes('1.234,50'));
    // Campo com `;` precisa vir entre aspas (não pode vazar coluna).
    assert.ok(lines[1].includes('"Maria; Silva"'));
  });

  test('despesas: marca Nota Fiscal faltante e usa data de pagamento', () => {
    const csv = buildDespesasCsv([expense]);
    const lines = csv.split('\r\n');
    assert.ok(lines[0].includes('Tipo de Gasto (TSE)'));
    assert.ok(lines[1].includes('21/03/2026')); // dataPagamento
    assert.ok(lines[1].includes('Faltante'));   // sem notaFiscalUrl
    assert.ok(lines[1].includes('5.000,00'));
  });

  test('buildSpcePlanilha gera dois arquivos nomeados', () => {
    const files = buildSpcePlanilha([income], [expense], '2026-06-21');
    assert.equal(files.length, 2);
    assert.equal(files[0].filename, 'SPCE_Receitas_2026-06-21.csv');
    assert.equal(files[1].filename, 'SPCE_Despesas_2026-06-21.csv');
  });
});

describe('spceExport — layout oficial (ponto de extensão)', () => {
  test('lança erro claro enquanto o spec do TSE não foi fornecido', () => {
    assert.throws(() => buildOficialSpce([income], [expense]), /Layout oficial do SPCE/);
  });
});
