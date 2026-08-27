/**
 * Testes do PR 42 — presets de filtro do Pulso Digital.
 * Só função pura; componente React só renderiza.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PULSO_PRESETS,
  findMatchingPreset,
} from '../src/components/social/pulsoPresets';

const NOW = new Date('2026-08-27T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('PULSO_PRESETS — shape', () => {
  test('todos têm id, label, scope, computeFilters', () => {
    for (const p of PULSO_PRESETS) {
      assert.ok(p.id);
      assert.ok(p.label);
      assert.ok(p.scope);
      assert.equal(typeof p.computeFilters, 'function');
    }
  });

  test('ids únicos', () => {
    const ids = PULSO_PRESETS.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('preset computeFilters', () => {
  test('crises-24h → minSeverity=crisis, since = now - 24h', () => {
    const p = PULSO_PRESETS.find(x => x.id === 'crises-24h')!;
    const r = p.computeFilters(NOW);
    assert.equal(r.minSeverity, 'crisis');
    const since = new Date(r.since).getTime();
    assert.equal(NOW.getTime() - since, DAY);
  });

  test('risk-plus-24h → minSeverity=risk, since = 24h', () => {
    const p = PULSO_PRESETS.find(x => x.id === 'risk-plus-24h')!;
    const r = p.computeFilters(NOW);
    assert.equal(r.minSeverity, 'risk');
    assert.equal(NOW.getTime() - new Date(r.since).getTime(), DAY);
  });

  test('attention-plus-7d → minSeverity=attention, since = 7d', () => {
    const p = PULSO_PRESETS.find(x => x.id === 'attention-plus-7d')!;
    const r = p.computeFilters(NOW);
    assert.equal(r.minSeverity, 'attention');
    assert.equal(NOW.getTime() - new Date(r.since).getTime(), 7 * DAY);
  });

  test('all-recent-7d → minSeverity vazio, since = 7d', () => {
    const p = PULSO_PRESETS.find(x => x.id === 'all-recent-7d')!;
    const r = p.computeFilters(NOW);
    assert.equal(r.minSeverity, '');
    assert.equal(NOW.getTime() - new Date(r.since).getTime(), 7 * DAY);
  });
});

describe('findMatchingPreset', () => {
  test('estado default (tudo vazio) → nenhuma preset ativa', () => {
    const r = findMatchingPreset({ minSeverity: '', since: '' }, NOW);
    // Nenhuma preset tem since vazio + minSeverity vazio
    assert.equal(r, null);
  });

  test('estado idêntico ao crises-24h → preset ativa', () => {
    const target = PULSO_PRESETS.find(x => x.id === 'crises-24h')!.computeFilters(NOW);
    const r = findMatchingPreset(target, NOW);
    assert.equal(r?.id, 'crises-24h');
  });

  test('drift de 5s no since → tolera (default 60s)', () => {
    const target = PULSO_PRESETS.find(x => x.id === 'risk-plus-24h')!.computeFilters(NOW);
    // simula since 5s adiantado
    const shifted = new Date(new Date(target.since).getTime() + 5000).toISOString();
    const r = findMatchingPreset({ minSeverity: target.minSeverity, since: shifted }, NOW);
    assert.equal(r?.id, 'risk-plus-24h');
  });

  test('drift maior que tolerance (120s com tolerance=60s) → null', () => {
    const target = PULSO_PRESETS.find(x => x.id === 'risk-plus-24h')!.computeFilters(NOW);
    const shifted = new Date(new Date(target.since).getTime() + 120_000).toISOString();
    const r = findMatchingPreset({ minSeverity: target.minSeverity, since: shifted }, NOW, 60_000);
    assert.equal(r, null);
  });

  test('minSeverity diferente de todas as presets → null', () => {
    // since=24h + minSeverity=attention não bate com nenhuma preset
    // (crises-24h=crisis, risk-plus-24h=risk, attention-plus-7d usa 7d).
    const target = PULSO_PRESETS.find(x => x.id === 'crises-24h')!.computeFilters(NOW);
    const r = findMatchingPreset({ minSeverity: 'attention', since: target.since }, NOW);
    assert.equal(r, null);
  });

  test('since inválido → null (não crasha)', () => {
    const target = PULSO_PRESETS.find(x => x.id === 'crises-24h')!.computeFilters(NOW);
    const r = findMatchingPreset({ minSeverity: target.minSeverity, since: 'not-a-date' }, NOW);
    assert.equal(r, null);
  });
});
