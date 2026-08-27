/**
 * Testes do contrato Social (F1). Não testam adapters — só o contrato,
 * o registry e helpers puros. Cobertura de adapters entra em PR 3+.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SOCIAL_PROVIDERS,
  SOCIAL_PROVIDER_LABEL,
  isSocialProvider,
  CAPABILITY_KEYS,
  isCapabilityAvailable,
  type SocialCapabilities,
} from '../src/server/modules/social/contracts/index.js';
import {
  SOCIAL_CAPABILITY_REGISTRY,
  getCapabilities,
  providersByMaturity,
} from '../src/server/modules/social/capabilityRegistry.js';

test('SOCIAL_PROVIDERS cobre exatamente as 7 redes do PRD', () => {
  assert.equal(SOCIAL_PROVIDERS.length, 7);
  const expected = ['instagram', 'facebook', 'youtube', 'tiktok', 'x', 'linkedin', 'kwai'];
  for (const p of expected) assert.ok(SOCIAL_PROVIDERS.includes(p as any), `provider ausente: ${p}`);
});

test('SOCIAL_PROVIDER_LABEL tem uma entrada por provider', () => {
  for (const p of SOCIAL_PROVIDERS) {
    assert.ok(SOCIAL_PROVIDER_LABEL[p], `label ausente pra ${p}`);
    assert.equal(typeof SOCIAL_PROVIDER_LABEL[p], 'string');
  }
});

test('isSocialProvider rejeita inputs inválidos sem lançar', () => {
  assert.equal(isSocialProvider('instagram'), true);
  assert.equal(isSocialProvider('twitter'), false); // provider é 'x'
  assert.equal(isSocialProvider(null), false);
  assert.equal(isSocialProvider(undefined), false);
  assert.equal(isSocialProvider(123), false);
  assert.equal(isSocialProvider({}), false);
});

test('registry tem entrada pra cada provider da union — bloqueia drift', () => {
  for (const p of SOCIAL_PROVIDERS) {
    const snapshot = SOCIAL_CAPABILITY_REGISTRY[p];
    assert.ok(snapshot, `snapshot ausente pra ${p}`);
    assert.ok(snapshot.adapterMaturity, `maturity ausente pra ${p}`);
    assert.ok(snapshot.capabilities, `capabilities ausente pra ${p}`);
  }
});

test('registry: toda capability declarada tem um CapabilityLevel válido', () => {
  const validLevels = new Set([
    'supported',
    'unsupported',
    'permission_required',
    'provider_restricted',
    'not_configured',
    'temporarily_unavailable',
    'unknown',
  ]);
  for (const p of SOCIAL_PROVIDERS) {
    const caps = SOCIAL_CAPABILITY_REGISTRY[p].capabilities;
    for (const key of CAPABILITY_KEYS) {
      const level = caps[key];
      assert.ok(
        validLevels.has(level),
        `capability inválida: ${p}.${key} = ${JSON.stringify(level)}`,
      );
    }
  }
});

test('registry: nenhuma capability crítica está em "unknown" — bloqueia laziness', () => {
  // "unknown" só é aceitável em transições. Nesta baseline (F1), toda capability
  // já foi observada no F0 audit — se algo virar "unknown", é sinal de auditoria pendente.
  for (const p of SOCIAL_PROVIDERS) {
    const caps = SOCIAL_CAPABILITY_REGISTRY[p].capabilities;
    for (const key of CAPABILITY_KEYS) {
      assert.notEqual(caps[key], 'unknown', `capability sem observação: ${p}.${key}`);
    }
  }
});

test('registry: X é production; Kwai fica em limited; demais são beta', () => {
  // Ancora nas descobertas do F0 — se alguém regredir X para beta sem migração,
  // ou reintroduzir bug de scraping em Kwai, o teste avisa. TikTok subiu para
  // beta em PR 7 (Display API), completando os 7 providers do P0 (§5 do PRD).
  assert.equal(SOCIAL_CAPABILITY_REGISTRY.x.adapterMaturity, 'production');
  assert.equal(SOCIAL_CAPABILITY_REGISTRY.kwai.adapterMaturity, 'limited');
  assert.equal(SOCIAL_CAPABILITY_REGISTRY.youtube.adapterMaturity, 'beta');
  assert.equal(SOCIAL_CAPABILITY_REGISTRY.tiktok.adapterMaturity, 'beta');
});

test('providersByMaturity ordena production → beta → limited → not_implemented', () => {
  const ordered = providersByMaturity();
  assert.equal(ordered.length, SOCIAL_PROVIDERS.length);
  const order = { production: 0, beta: 1, limited: 2, not_implemented: 3 } as const;
  for (let i = 1; i < ordered.length; i++) {
    const prev = SOCIAL_CAPABILITY_REGISTRY[ordered[i - 1]].adapterMaturity;
    const curr = SOCIAL_CAPABILITY_REGISTRY[ordered[i]].adapterMaturity;
    assert.ok(order[prev] <= order[curr], `ordem quebrou entre ${ordered[i - 1]}(${prev}) e ${ordered[i]}(${curr})`);
  }
});

test('getCapabilities devolve o mesmo objeto do registry (sem cópia)', () => {
  const snap = getCapabilities('x');
  assert.strictEqual(snap, SOCIAL_CAPABILITY_REGISTRY.x);
});

test('isCapabilityAvailable: só "supported" é chamável agora', () => {
  const caps: SocialCapabilities = {
    profileRead: 'supported',
    postsRead: 'permission_required',
    ownCommentsRead: 'not_configured',
    thirdPartyCommentsRead: 'unsupported',
    metricsRead: 'temporarily_unavailable',
    audienceInsights: 'provider_restricted',
    mentionsRead: 'unknown',
    competitorDiscovery: 'supported',
    publishText: 'unsupported',
    publishImage: 'unsupported',
    publishVideo: 'unsupported',
    schedule: 'unsupported',
    webhook: 'unsupported',
  };
  assert.equal(isCapabilityAvailable(caps, 'profileRead'), true);
  assert.equal(isCapabilityAvailable(caps, 'competitorDiscovery'), true);
  // Tudo que não é "supported" → false, mesmo os recuperáveis.
  assert.equal(isCapabilityAvailable(caps, 'postsRead'), false);
  assert.equal(isCapabilityAvailable(caps, 'ownCommentsRead'), false);
  assert.equal(isCapabilityAvailable(caps, 'metricsRead'), false);
  assert.equal(isCapabilityAvailable(caps, 'mentionsRead'), false);
});

test('registry: providers "not_implemented" não anunciam nenhuma capability como "supported"', () => {
  // Regra defensiva — não podemos deixar YT/TT com capability supported enquanto
  // o adapter não existir. Se algum PR quebrar isso, teste falha.
  for (const p of SOCIAL_PROVIDERS) {
    if (SOCIAL_CAPABILITY_REGISTRY[p].adapterMaturity !== 'not_implemented') continue;
    const caps = SOCIAL_CAPABILITY_REGISTRY[p].capabilities;
    for (const key of CAPABILITY_KEYS) {
      assert.notEqual(caps[key], 'supported', `${p}.${key} não pode ser 'supported' sem adapter`);
    }
  }
});
