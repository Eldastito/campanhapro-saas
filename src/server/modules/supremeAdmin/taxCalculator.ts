/**
 * Calculadora do Simples Nacional para o SaaS (sede no Rio de Janeiro).
 *
 * SaaS = prestação de serviço. No Simples Nacional o enquadramento entre
 * Anexo III e Anexo V depende do FATOR R:
 *   Fator R = folha de pagamento (12 meses) / receita bruta (12 meses, RBT12)
 *   - Fator R >= 28%  → Anexo III (alíquotas menores)
 *   - Fator R <  28%  → Anexo V  (alíquotas maiores)
 *
 * A DAS é UNIFICADA e já inclui o ISS (imposto municipal). Para SaaS não há
 * ICMS (estadual), pois é serviço, não mercadoria. Ou seja: paga-se uma única
 * guia (DAS) por mês que engloba IRPJ, CSLL, PIS, COFINS, CPP e ISS.
 *
 * Alíquota efetiva = (RBT12 × alíquota_nominal − parcela_a_deduzir) / RBT12
 * DAS do mês       = receita_do_mês × alíquota_efetiva
 *
 * Tabelas vigentes (LC 123/2006, valores em R$).
 */

export type Anexo = 'III' | 'V';

interface Faixa {
  ate: number;        // teto da faixa de RBT12 (R$)
  aliquota: number;   // alíquota nominal (fração, ex.: 0.06)
  deduzir: number;    // parcela a deduzir (R$)
}

// Anexo III — serviços (com Fator R >= 28%)
const ANEXO_III: Faixa[] = [
  { ate: 180_000,   aliquota: 0.060, deduzir: 0 },
  { ate: 360_000,   aliquota: 0.112, deduzir: 9_360 },
  { ate: 720_000,   aliquota: 0.135, deduzir: 17_640 },
  { ate: 1_800_000, aliquota: 0.160, deduzir: 35_640 },
  { ate: 3_600_000, aliquota: 0.210, deduzir: 125_640 },
  { ate: 4_800_000, aliquota: 0.330, deduzir: 648_000 },
];

// Anexo V — serviços (com Fator R < 28%)
const ANEXO_V: Faixa[] = [
  { ate: 180_000,   aliquota: 0.155, deduzir: 0 },
  { ate: 360_000,   aliquota: 0.180, deduzir: 4_500 },
  { ate: 720_000,   aliquota: 0.195, deduzir: 9_900 },
  { ate: 1_800_000, aliquota: 0.205, deduzir: 17_100 },
  { ate: 3_600_000, aliquota: 0.230, deduzir: 62_100 },
  { ate: 4_800_000, aliquota: 0.305, deduzir: 540_000 },
];

const FATOR_R_LIMIAR = 0.28;
const TETO_SIMPLES = 4_800_000;

export interface TaxInput {
  /** Receita bruta dos últimos 12 meses (R$). Para SaaS novo, use MRR×12. */
  rbt12: number;
  /** Receita do mês corrente (R$) — base de cálculo da DAS. */
  receitaMes: number;
  /** Folha de pagamento dos últimos 12 meses (R$) — para o Fator R. */
  folha12: number;
}

export interface TaxResult {
  rbt12: number;
  receitaMes: number;
  folha12: number;
  fatorR: number;            // fração (ex.: 0.31)
  anexo: Anexo;
  faixa: number;             // 1..6
  aliquotaNominal: number;   // fração
  aliquotaEfetiva: number;   // fração
  dasMesCents: number;       // imposto do mês em centavos (BRL)
  acimaDoTeto: boolean;      // RBT12 acima do limite do Simples (R$ 4,8mi)
  observacao: string;
}

function faixaPara(rbt12: number, tabela: Faixa[]): { faixa: Faixa; indice: number } {
  for (let i = 0; i < tabela.length; i++) {
    if (rbt12 <= tabela[i].ate) return { faixa: tabela[i], indice: i + 1 };
  }
  return { faixa: tabela[tabela.length - 1], indice: tabela.length };
}

/**
 * Calcula a DAS estimada do Simples Nacional para um prestador de serviço (SaaS).
 * Todos os valores monetários de entrada em R$ (reais), saída de imposto em centavos.
 */
export function calcSimplesNacional(input: TaxInput): TaxResult {
  const rbt12 = Math.max(0, input.rbt12);
  const receitaMes = Math.max(0, input.receitaMes);
  const folha12 = Math.max(0, input.folha12);

  const fatorR = rbt12 > 0 ? folha12 / rbt12 : 0;
  const anexo: Anexo = fatorR >= FATOR_R_LIMIAR ? 'III' : 'V';
  const tabela = anexo === 'III' ? ANEXO_III : ANEXO_V;

  // RBT12 = 0 (sem histórico): usa a 1ª faixa pela própria receita do mês anualizada
  const baseRbt = rbt12 > 0 ? rbt12 : receitaMes * 12;
  const { faixa, indice } = faixaPara(baseRbt, tabela);

  // Alíquota efetiva
  const aliquotaEfetiva = baseRbt > 0
    ? Math.max(0, (baseRbt * faixa.aliquota - faixa.deduzir) / baseRbt)
    : faixa.aliquota;

  const dasMes = receitaMes * aliquotaEfetiva;
  const acimaDoTeto = baseRbt > TETO_SIMPLES;

  const observacao = acimaDoTeto
    ? 'RBT12 acima de R$ 4,8 mi — fora do Simples Nacional. Migrar para Lucro Presumido/Real.'
    : anexo === 'III'
      ? `Anexo III (Fator R ${(fatorR * 100).toFixed(1)}% ≥ 28%). DAS unificada já inclui o ISS municipal (RJ).`
      : `Anexo V (Fator R ${(fatorR * 100).toFixed(1)}% < 28%). Aumentar a folha pode reduzir imposto (migra p/ Anexo III).`;

  return {
    rbt12: baseRbt,
    receitaMes,
    folha12,
    fatorR,
    anexo,
    faixa: indice,
    aliquotaNominal: faixa.aliquota,
    aliquotaEfetiva,
    dasMesCents: Math.round(dasMes * 100),
    acimaDoTeto,
    observacao,
  };
}
