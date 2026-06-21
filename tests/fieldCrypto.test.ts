/**
 * Testes da criptografia de campo (AES-256-GCM). Cobrem roundtrip, idempotência,
 * passthrough de texto puro/null (migração suave), detecção de adulteração (GCM)
 * e falha com chave errada. Define a env ANTES de importar (chave é lazy+cached).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64); // hex64 → 32 bytes

import {
  encryptField, decryptField, isEncrypted,
  encryptFields, decryptFields, decryptRows, _resetKeyCache,
} from '../src/server/lib/fieldCrypto';

describe('fieldCrypto', () => {
  beforeEach(() => { _resetKeyCache(); });

  test('roundtrip preserva o valor', () => {
    const plain = '123.456.789-00';
    const enc = encryptField(plain) as string;
    assert.ok(isEncrypted(enc));
    assert.notEqual(enc, plain);
    assert.equal(decryptField(enc), plain);
  });

  test('IV aleatório → mesmo texto cifra diferente, mas decifra igual', () => {
    const a = encryptField('segredo') as string;
    const b = encryptField('segredo') as string;
    assert.notEqual(a, b);
    assert.equal(decryptField(a), 'segredo');
    assert.equal(decryptField(b), 'segredo');
  });

  test('null/undefined/vazio passam intactos', () => {
    assert.equal(encryptField(null), null);
    assert.equal(encryptField(undefined), undefined);
    assert.equal(encryptField(''), '');
    assert.equal(decryptField(null), null);
    assert.equal(decryptField(undefined), undefined);
  });

  test('texto puro legado passa pela decifra sem mexer (migração suave)', () => {
    assert.equal(decryptField('texto-puro-legado'), 'texto-puro-legado');
    assert.equal(isEncrypted('texto-puro-legado'), false);
  });

  test('encrypt é idempotente (não cifra duas vezes)', () => {
    const once = encryptField('x') as string;
    const twice = encryptField(once) as string;
    assert.equal(once, twice);
    assert.equal(decryptField(twice), 'x');
  });

  test('adulteração do ciphertext é detectada (GCM auth tag)', () => {
    const enc = encryptField('valor-bancario') as string;
    // troca o último caractere do ciphertext
    const tampered = enc.slice(0, -1) + (enc.slice(-1) === 'A' ? 'B' : 'A');
    assert.throws(() => decryptField(tampered));
  });

  test('chave errada não decifra', () => {
    const enc = encryptField('pix@banco.com') as string;
    _resetKeyCache();
    process.env.FIELD_ENCRYPTION_KEY = 'b'.repeat(64);
    assert.throws(() => decryptField(enc));
    _resetKeyCache();
    process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64); // restaura p/ próximos testes
  });

  test('encryptFields/decryptFields atuam só nos campos do registry', () => {
    const row = { id: 1, name: 'Fulano', cpf: '111', phone: '999' };
    const enc = encryptFields(row, ['cpf']);
    assert.ok(isEncrypted(enc.cpf));
    assert.equal(enc.name, 'Fulano'); // intacto
    assert.equal(enc.phone, '999');   // intacto
    const dec = decryptFields(enc, ['cpf']);
    assert.equal(dec.cpf, '111');
  });

  test('decryptFields fail-closed: valor corrompido vira null, não vaza ciphertext', () => {
    const dec = decryptFields({ cpf: 'enc:v1:aaa:bbb:ccc' }, ['cpf']);
    assert.equal(dec.cpf, null);
  });

  test('decryptRows mapeia a lista', () => {
    const rows = [{ doc: encryptField('A') }, { doc: encryptField('B') }];
    const out = decryptRows(rows, ['doc']);
    assert.deepEqual(out.map((r) => r.doc), ['A', 'B']);
  });
});
