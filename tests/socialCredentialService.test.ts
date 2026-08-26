/**
 * Testes do PR 2 do PRD Social Intelligence — SocialCredentialService.
 *
 * Cobre:
 *   - saveCredentials cifra tokens antes de gravar
 *   - describeConnection não vaza tokens (nem cifrados nem plaintext)
 *   - revealTokens devolve plaintext (server-side only)
 *   - migração suave: linha legada em plaintext ainda é lida corretamente
 *   - idempotência da cripto (não recifra token já cifrado)
 *   - updateTokensAfterRefresh preserva metadata + limpa error state
 *   - markRevoked/markError/markRequiresReauth persistem estado
 *   - tenant isolation entre 2 campanhas (mesmo provider)
 *
 * FIELD_ENCRYPTION_KEY é setada ANTES do import — fieldCrypto resolve chave lazy.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase';

process.env.FIELD_ENCRYPTION_KEY = 'b'.repeat(64);

import {
  saveCredentials,
  describeConnection,
  listConnections,
  revealTokens,
  updateTokensAfterRefresh,
  markRevoked,
  markError,
  markRequiresReauth,
} from '../src/server/modules/social/socialCredentialService';
import { isEncrypted, encryptField, _resetKeyCache } from '../src/server/lib/fieldCrypto';

const CAMP_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMP_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function freshSupabase() {
  return createMockSupabase({ social_tokens: [] });
}

describe('SocialCredentialService — cripto em repouso', () => {
  test('saveCredentials cifra access_token e refresh_token antes de persistir', async () => {
    _resetKeyCache();
    const supabase = freshSupabase();
    const desc = await saveCredentials(supabase, {
      campaignId: CAMP_A,
      provider: 'x',
      accessToken: 'PLAIN-ACCESS-TOKEN-XYZ',
      refreshToken: 'PLAIN-REFRESH-123',
      expiresAt: new Date(Date.now() + 3600_000),
      providerAccountId: 'user-1',
      handle: 'candidato_x',
      scopes: ['tweet.read', 'users.read'],
    });

    // Descriptor NÃO tem tokens
    assert.equal((desc as any).accessToken, undefined);
    assert.equal((desc as any).refreshToken, undefined);
    assert.equal(desc.handle, 'candidato_x');
    assert.equal(desc.provider, 'x');
    assert.equal(desc.status, 'active');
    assert.equal(desc.hasRefreshToken, true);
    assert.deepEqual(desc.scopes, ['tweet.read', 'users.read']);

    // No storage bruto, os tokens estão cifrados
    const stored = (supabase as any)._store.get('social_tokens')[0];
    assert.ok(isEncrypted(stored.access_token), 'access_token cifrado');
    assert.ok(isEncrypted(stored.refresh_token), 'refresh_token cifrado');
    assert.notEqual(stored.access_token, 'PLAIN-ACCESS-TOKEN-XYZ');
  });

  test('revealTokens devolve plaintext (server-side only)', async () => {
    _resetKeyCache();
    const supabase = freshSupabase();
    await saveCredentials(supabase, {
      campaignId: CAMP_A,
      provider: 'linkedin',
      accessToken: 'linkedin-plain-token',
      refreshToken: 'linkedin-refresh',
    });

    const t = await revealTokens(supabase, CAMP_A, 'linkedin');
    assert.ok(t, 'tokens revelados');
    assert.equal(t!.accessToken, 'linkedin-plain-token');
    assert.equal(t!.refreshToken, 'linkedin-refresh');
  });

  test('describeConnection e listConnections nunca expõem tokens', async () => {
    _resetKeyCache();
    const supabase = freshSupabase();
    await saveCredentials(supabase, {
      campaignId: CAMP_A, provider: 'x',
      accessToken: 'a1', refreshToken: 'r1', handle: 'x_handle',
    });
    await saveCredentials(supabase, {
      campaignId: CAMP_A, provider: 'linkedin',
      accessToken: 'a2', refreshToken: null, handle: 'li_handle',
    });

    const one = await describeConnection(supabase, CAMP_A, 'x');
    assert.ok(one);
    assert.equal((one as any).accessToken, undefined);
    assert.equal((one as any).refreshToken, undefined);
    assert.equal((one as any).access_token, undefined);
    assert.equal(one!.handle, 'x_handle');
    assert.equal(one!.hasRefreshToken, true);

    const many = await listConnections(supabase, CAMP_A);
    assert.equal(many.length, 2);
    for (const c of many) {
      assert.equal((c as any).accessToken, undefined);
      assert.equal((c as any).access_token, undefined);
    }
    // Um sem refresh
    const li = many.find(m => m.provider === 'linkedin')!;
    assert.equal(li.hasRefreshToken, false);
  });

  test('describeConnection devolve null quando não existe', async () => {
    _resetKeyCache();
    const supabase = freshSupabase();
    const r = await describeConnection(supabase, CAMP_A, 'x');
    assert.equal(r, null);
  });

  test('migração suave: linha legada em plaintext é lida corretamente', async () => {
    // Simula o estado atual em produção: linha antiga inserida direto pelos
    // callbacks OAuth existentes (socialRouter.ts:130) sem cripto.
    _resetKeyCache();
    const supabase = createMockSupabase({
      social_tokens: [{
        id: 'legacy-1', campaignId: CAMP_A, provider: 'x',
        access_token: 'legacy-plain-access',
        refresh_token: 'legacy-plain-refresh',
        expires_at: null,
        settings: { handle: 'legacy_user' },
        status: 'active',
      }],
    });

    const t = await revealTokens(supabase, CAMP_A, 'x');
    assert.ok(t);
    assert.equal(t!.accessToken, 'legacy-plain-access');
    assert.equal(t!.refreshToken, 'legacy-plain-refresh');
  });

  test('cripto é idempotente — reupsertar não recifra o token', async () => {
    _resetKeyCache();
    const supabase = freshSupabase();
    await saveCredentials(supabase, {
      campaignId: CAMP_A, provider: 'x', accessToken: 'ORIGINAL',
    });
    const cipher1 = (supabase as any)._store.get('social_tokens')[0].access_token;
    assert.ok(isEncrypted(cipher1));

    // Reupserting com o valor JÁ CIFRADO (simula uma chamada que passou o
    // token direto pelo pipe sem descriptografar antes).
    await saveCredentials(supabase, {
      campaignId: CAMP_A, provider: 'x', accessToken: cipher1,
    });
    const cipher2 = (supabase as any)._store.get('social_tokens')[0].access_token;
    // encryptField é idempotente — não vira double-encrypted.
    assert.equal(cipher2, cipher1, 'cifrado não é recifrado');
    // E ainda decifra corretamente.
    const t = await revealTokens(supabase, CAMP_A, 'x');
    assert.equal(t!.accessToken, 'ORIGINAL');
  });
});

describe('SocialCredentialService — ciclo de vida', () => {
  test('updateTokensAfterRefresh troca tokens, limpa error, preserva metadata', async () => {
    _resetKeyCache();
    const supabase = freshSupabase();
    await saveCredentials(supabase, {
      campaignId: CAMP_A, provider: 'x',
      accessToken: 'v1', refreshToken: 'r1',
      providerAccountId: 'user-1', handle: '@x_user', scopes: ['tweet.read'],
    });
    // Simula erro anterior
    await markError(supabase, CAMP_A, 'x', 'auth_expired', { escalate: true });

    await updateTokensAfterRefresh(supabase, CAMP_A, 'x', {
      accessToken: 'v2',
      refreshToken: 'r2',
      expiresAt: new Date(Date.now() + 7200_000),
    });

    const desc = await describeConnection(supabase, CAMP_A, 'x');
    assert.equal(desc!.status, 'active', 'status foi restaurado a active');
    assert.equal(desc!.lastErrorCode, null, 'last_error_code limpo');
    assert.equal(desc!.handle, '@x_user', 'metadata preservada');
    assert.equal(desc!.providerAccountId, 'user-1', 'account id preservado');
    assert.deepEqual(desc!.scopes, ['tweet.read']);

    const t = await revealTokens(supabase, CAMP_A, 'x');
    assert.equal(t!.accessToken, 'v2');
    assert.equal(t!.refreshToken, 'r2');
  });

  test('updateTokensAfterRefresh sem refreshToken (undefined) preserva o antigo', async () => {
    _resetKeyCache();
    const supabase = freshSupabase();
    await saveCredentials(supabase, {
      campaignId: CAMP_A, provider: 'linkedin',
      accessToken: 'a1', refreshToken: 'KEEP-ME',
    });

    // Provider devolveu só novo access_token (comum no LinkedIn).
    await updateTokensAfterRefresh(supabase, CAMP_A, 'linkedin', {
      accessToken: 'a2',
      // refreshToken omitido — não deve alterar
    });

    const t = await revealTokens(supabase, CAMP_A, 'linkedin');
    assert.equal(t!.accessToken, 'a2');
    assert.equal(t!.refreshToken, 'KEEP-ME');
  });

  test('markRevoked seta revoked_at + status, mas mantém a linha (histórico)', async () => {
    _resetKeyCache();
    const supabase = freshSupabase();
    await saveCredentials(supabase, {
      campaignId: CAMP_A, provider: 'x', accessToken: 'a',
    });
    await markRevoked(supabase, CAMP_A, 'x');

    const desc = await describeConnection(supabase, CAMP_A, 'x');
    assert.ok(desc, 'linha ainda existe');
    assert.equal(desc!.status, 'revoked');
    assert.ok(desc!.revokedAt, 'revokedAt setado');
  });

  test('markError sem escalate NÃO muda status; com escalate=true muda para error', async () => {
    _resetKeyCache();
    const supabase = freshSupabase();
    await saveCredentials(supabase, {
      campaignId: CAMP_A, provider: 'x', accessToken: 'a',
    });

    await markError(supabase, CAMP_A, 'x', 'rate_limited');
    let desc = await describeConnection(supabase, CAMP_A, 'x');
    assert.equal(desc!.status, 'active', 'sem escalate → status intacto');
    assert.equal(desc!.lastErrorCode, 'rate_limited');

    await markError(supabase, CAMP_A, 'x', 'auth_expired', { escalate: true });
    desc = await describeConnection(supabase, CAMP_A, 'x');
    assert.equal(desc!.status, 'error');
    assert.equal(desc!.lastErrorCode, 'auth_expired');
  });

  test('markRequiresReauth seta status=requires_reauth', async () => {
    _resetKeyCache();
    const supabase = freshSupabase();
    await saveCredentials(supabase, {
      campaignId: CAMP_A, provider: 'linkedin', accessToken: 'a', refreshToken: 'r',
    });
    await markRequiresReauth(supabase, CAMP_A, 'linkedin', 'refresh_token_invalid');
    const desc = await describeConnection(supabase, CAMP_A, 'linkedin');
    assert.equal(desc!.status, 'requires_reauth');
    assert.equal(desc!.lastErrorCode, 'refresh_token_invalid');
  });

  test('errorCode é truncado em 120 chars para evitar payload gigante', async () => {
    _resetKeyCache();
    const supabase = freshSupabase();
    await saveCredentials(supabase, { campaignId: CAMP_A, provider: 'x', accessToken: 'a' });
    const huge = 'x'.repeat(500);
    await markError(supabase, CAMP_A, 'x', huge);
    const desc = await describeConnection(supabase, CAMP_A, 'x');
    assert.equal(desc!.lastErrorCode!.length, 120);
  });
});

describe('SocialCredentialService — tenant isolation', () => {
  test('duas campanhas com mesmo provider não se enxergam', async () => {
    _resetKeyCache();
    const supabase = freshSupabase();
    await saveCredentials(supabase, {
      campaignId: CAMP_A, provider: 'x',
      accessToken: 'A-SECRET', handle: 'A_handle',
    });
    await saveCredentials(supabase, {
      campaignId: CAMP_B, provider: 'x',
      accessToken: 'B-SECRET', handle: 'B_handle',
    });

    const listA = await listConnections(supabase, CAMP_A);
    assert.equal(listA.length, 1);
    assert.equal(listA[0].handle, 'A_handle');

    const listB = await listConnections(supabase, CAMP_B);
    assert.equal(listB.length, 1);
    assert.equal(listB[0].handle, 'B_handle');

    // revealTokens da B não devolve A
    const tokensB = await revealTokens(supabase, CAMP_B, 'x');
    assert.equal(tokensB!.accessToken, 'B-SECRET');

    // Descrição cruzada devolve null
    const cross = await describeConnection(supabase, CAMP_A, 'youtube');
    assert.equal(cross, null);
  });

  test('saveCredentials rejeita input inválido', async () => {
    const supabase = freshSupabase();
    await assert.rejects(
      () => saveCredentials(supabase, { campaignId: '', provider: 'x', accessToken: 'a' }),
      /campaignId/,
    );
    await assert.rejects(
      () => saveCredentials(supabase, { campaignId: CAMP_A, provider: '', accessToken: 'a' }),
      /provider/,
    );
    await assert.rejects(
      () => saveCredentials(supabase, { campaignId: CAMP_A, provider: 'x', accessToken: '' }),
      /accessToken/,
    );
  });
});

describe('SocialCredentialService — smoke com valor conhecido cifrado direto', () => {
  test('linha pré-cifrada (fora do fluxo save) é decifrada por revealTokens', async () => {
    _resetKeyCache();
    const cipher = encryptField('MANUAL-CIPHERED-TOKEN')!;
    assert.ok(isEncrypted(cipher));
    const supabase = createMockSupabase({
      social_tokens: [{
        id: 'x1', campaignId: CAMP_A, provider: 'x',
        access_token: cipher, refresh_token: null, expires_at: null,
        status: 'active', settings: null,
      }],
    });

    const t = await revealTokens(supabase, CAMP_A, 'x');
    assert.equal(t!.accessToken, 'MANUAL-CIPHERED-TOKEN');
  });
});
