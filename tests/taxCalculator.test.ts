import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcSimplesNacional } from '../src/server/modules/supremeAdmin/taxCalculator';

test('Anexo V quando Fator R < 28% (sem folha)', () => {
  // MRR 40k → RBT12 480k, sem folha → Fator R 0% → Anexo V faixa 3
  const r = calcSimplesNacional({ rbt12: 480_000, receitaMes: 40_000, folha12: 0 });
  assert.equal(r.anexo, 'V');
  assert.equal(r.faixa, 3);
  // efetiva = (480000*0.195 - 9900)/480000 = 0.174375
  assert.ok(Math.abs(r.aliquotaEfetiva - 0.174375) < 1e-6, `efetiva=${r.aliquotaEfetiva}`);
  // DAS = 40000 * 0.174375 = 6975.00 → 697500 cents
  assert.equal(r.dasMesCents, 697_500);
});

test('Anexo III quando Fator R >= 28% (com folha alta)', () => {
  // folha 12 = 150k sobre RBT12 480k → Fator R 31,25% → Anexo III
  const r = calcSimplesNacional({ rbt12: 480_000, receitaMes: 40_000, folha12: 150_000 });
  assert.equal(r.anexo, 'III');
  assert.equal(r.faixa, 3);
  // efetiva = (480000*0.135 - 17640)/480000 = 0.09825
  assert.ok(Math.abs(r.aliquotaEfetiva - 0.09825) < 1e-6, `efetiva=${r.aliquotaEfetiva}`);
  // DAS = 40000 * 0.09825 = 3930.00
  assert.equal(r.dasMesCents, 393_000);
});

test('1a faixa Anexo III usa alíquota nominal (sem deduzir)', () => {
  const r = calcSimplesNacional({ rbt12: 120_000, receitaMes: 10_000, folha12: 40_000 });
  assert.equal(r.anexo, 'III');
  assert.equal(r.faixa, 1);
  assert.ok(Math.abs(r.aliquotaEfetiva - 0.06) < 1e-9);
  assert.equal(r.dasMesCents, 60_000); // 10000 * 6% = 600.00
});

test('acima do teto do Simples (4,8 mi) sinaliza', () => {
  const r = calcSimplesNacional({ rbt12: 5_000_000, receitaMes: 420_000, folha12: 2_000_000 });
  assert.equal(r.acimaDoTeto, true);
});

test('RBT12 zero cai pra projeção pela receita do mês anualizada', () => {
  const r = calcSimplesNacional({ rbt12: 0, receitaMes: 5_000, folha12: 0 });
  // 5000*12 = 60k → faixa 1 Anexo V (15,5%)
  assert.equal(r.anexo, 'V');
  assert.equal(r.faixa, 1);
  assert.equal(r.dasMesCents, 77_500); // 5000 * 15,5% = 775.00
});
