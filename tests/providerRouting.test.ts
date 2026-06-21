import { test } from 'node:test';
import assert from 'node:assert/strict';

// Garante chaves de todos os providers ANTES de importar (keyForProvider lê env).
process.env.OPENAI_API_KEY ||= 'test-openai';
process.env.ANTHROPIC_API_KEY ||= 'test-anthropic';
process.env.GEMINI_API_KEY ||= 'test-gemini';

const { orderedProviders, AGENT_CONFIGS } = await import('../src/lib/aiCallAgent.ts');

const baseOpts = { campaignId: 'c1' } as any;

test('agente Jurídico/Contábil força ordem GPT → Claude → Gemini', () => {
  for (const id of ['accountant', 'legal']) {
    const cfg = AGENT_CONFIGS[id];
    assert.ok(cfg, `${id} deve existir em AGENT_CONFIGS`);
    assert.deepEqual(orderedProviders(cfg, baseOpts), ['openai', 'anthropic', 'gemini']);
  }
});

test('providerChain ignora o sort por custo do complexity', () => {
  // 'cheap' ordenaria gemini (mais barato) primeiro; providerChain mantém GPT primário.
  const out = orderedProviders(AGENT_CONFIGS.accountant, { ...baseOpts, complexity: 'cheap' });
  assert.deepEqual(out, ['openai', 'anthropic', 'gemini']);
});

test('providerChain filtra provider sem API key (mantém a ordem)', () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const out = orderedProviders(AGENT_CONFIGS.legal, baseOpts);
    assert.deepEqual(out, ['anthropic', 'gemini']);
  } finally {
    process.env.OPENAI_API_KEY = saved;
  }
});

test('agente sem providerChain segue a chain global (anthropic primeiro)', () => {
  // strategist não tem providerChain → 'balanced' usa PROVIDER_CHAIN curada.
  const out = orderedProviders(AGENT_CONFIGS.strategist, baseOpts);
  assert.equal(out[0], 'anthropic');
});
