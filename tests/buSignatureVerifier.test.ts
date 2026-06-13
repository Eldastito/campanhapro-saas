/**
 * Testa a verificação Ed25519 da assinatura do BU.
 *
 * Gera um par de chaves Ed25519 com a própria biblioteca, assina uma mensagem
 * conhecida e confirma que o verifier devolve 'valid' / 'invalid' / 'no_key'
 * nos cenários certos.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js'; // v2.x: subpath exige .js
import { verifyEd25519BU, checkBUSignature } from '../src/lib/buSignatureVerifier';

// @noble/ed25519 v3 precisa que a gente registre uma impl de SHA-512.
ed.hashes.sha512 = sha512;

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
}

describe('buSignatureVerifier', () => {
  test('verifyEd25519BU aceita assinatura válida e rejeita adulteração', async () => {
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const msgHex = 'deadbeef' + '00'.repeat(60); // 128 chars hex (simula HASH SHA-512)
    const msgBytes = Buffer.from(msgHex, 'hex');
    const sigBytes = await ed.signAsync(msgBytes, priv);
    const sigHex = bytesToHex(sigBytes);
    const pubHex = bytesToHex(pub);

    assert.equal(await verifyEd25519BU(msgHex, sigHex, pubHex), true);

    // adultera 1 byte da assinatura → tem que falhar
    const tamperedSig = sigHex.slice(0, -2) + (sigHex.endsWith('00') ? 'ff' : '00');
    assert.equal(await verifyEd25519BU(msgHex, tamperedSig, pubHex), false);

    // adultera o hash → também tem que falhar
    const tamperedHash = 'cafebabe' + msgHex.slice(8);
    assert.equal(await verifyEd25519BU(tamperedHash, sigHex, pubHex), false);
  });

  test('checkBUSignature classifica corretamente os 4 estados', async () => {
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const hash = 'aa'.repeat(64);
    const sig = bytesToHex(await ed.signAsync(Buffer.from(hash, 'hex'), priv));
    const pubHex = bytesToHex(pub);

    // 1) válido
    const ok = await checkBUSignature(
      { hash, assinatura: sig, header: { uf: 'RJ' } }, { RJ: pubHex },
    );
    assert.equal(ok.status, 'valid');

    // 2) inválido (chave diferente)
    const otherPub = bytesToHex(await ed.getPublicKeyAsync(ed.utils.randomSecretKey()));
    const bad = await checkBUSignature(
      { hash, assinatura: sig, header: { uf: 'RJ' } }, { RJ: otherPub },
    );
    assert.equal(bad.status, 'invalid');

    // 3) sem chave para a UF — não bloqueia, mas avisa
    const noKey = await checkBUSignature(
      { hash, assinatura: sig, header: { uf: 'SP' } }, { RJ: pubHex },
    );
    assert.equal(noKey.status, 'no_key');

    // 4) BU sem assinatura
    const noSig = await checkBUSignature(
      { hash, header: { uf: 'RJ' } }, { RJ: pubHex },
    );
    assert.equal(noSig.status, 'no_signature');
  });
});
