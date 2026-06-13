/**
 * Verificação criptográfica da assinatura digital do Boletim de Urna (TSE).
 *
 * Conforme o manual "QR Code no Boletim de Urna" (TSE, 2024):
 * - O algoritmo é **Ed25519** (curva elíptica, chave 256 bits, assinatura 512 bits).
 * - O que é assinado é o **HASH** do último QR Code (hash acumulado dos QRs),
 *   codificado em hexadecimal — não é o conteúdo cru.
 * - A chave pública é **publicada por UF** pelo TSE, após a Cerimônia de
 *   Lacração e Assinatura Digital.
 *
 * Como em junho/2026 a cerimônia ainda não aconteceu, este módulo opera
 * fail-safe: se não houver chave cadastrada no banco para a UF do BU, devolve
 * status `no_key` (não bloqueia, mas avisa o fiscal claramente).
 */
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js'; // v2.x do @noble/hashes: subpath exige .js explícito

// @noble/ed25519 v3 exige que a impl de SHA-512 seja registrada explicitamente
// (não vem embutida). Sem isto, verifyAsync lança "hashes.sha512 is not a
// function" silenciosamente em produção. Roda uma vez, no import.
if (!ed.hashes.sha512) {
  ed.hashes.sha512 = sha512;
}

export type BUSignatureStatus = 'valid' | 'invalid' | 'no_signature' | 'no_key' | 'error';

export interface BUSignatureResult {
  status: BUSignatureStatus;
  /** Mensagem curta pra exibir no UI. */
  message: string;
  /** Dica/explicação maior. */
  detail?: string;
}

/** Converte string hexadecimal → Uint8Array. Tolera caracteres minúsculos/maiúsculos. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error('hex_invalid_odd_length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Verifica a assinatura Ed25519 do BU.
 *
 * @param hashHex   HASH do último QR (hex, ~128 chars pra SHA-512)
 * @param assiHex   Assinatura Ed25519 (hex, 128 chars / 64 bytes)
 * @param pubKeyHex Chave pública Ed25519 (hex, 64 chars / 32 bytes)
 */
export async function verifyEd25519BU(hashHex: string, assiHex: string, pubKeyHex: string): Promise<boolean> {
  try {
    const sig = hexToBytes(assiHex);
    const msg = hexToBytes(hashHex);
    const pub = hexToBytes(pubKeyHex);
    if (sig.length !== 64) throw new Error(`signature_size_${sig.length}`);
    if (pub.length !== 32) throw new Error(`pubkey_size_${pub.length}`);
    return await ed.verifyAsync(sig, msg, pub);
  } catch (e: any) {
    console.warn('[BUSignature] verify falhou:', e?.message ?? e);
    return false;
  }
}

/**
 * Resolve a chave pública da UF/ano, busca o status humano-legível.
 * `pubKeysByUF` é o mapa carregado do endpoint /election/tse-keys.
 */
export async function checkBUSignature(
  bu: { hash?: string; assinatura?: string; header: { uf?: string } },
  pubKeysByUF: Record<string, string>,
): Promise<BUSignatureResult> {
  if (!bu.assinatura) {
    return {
      status: 'no_signature',
      message: 'Sem assinatura no BU',
      detail: 'Provável BU incompleto — leia todos os QRs.',
    };
  }
  if (!bu.hash) {
    return {
      status: 'error',
      message: 'BU sem HASH',
      detail: 'O HASH é necessário pra verificar a assinatura. Releia os QRs.',
    };
  }
  const uf = (bu.header.uf || '').toUpperCase();
  const pubKey = uf ? pubKeysByUF[uf] : undefined;
  if (!pubKey) {
    return {
      status: 'no_key',
      message: `Chave pública TSE não configurada${uf ? ` para ${uf}` : ''}`,
      detail: 'O TSE publica as chaves Ed25519 após a Cerimônia de Lacração (poucos meses antes da eleição). Peça ao admin pra cadastrá-las no Supreme assim que divulgadas.',
    };
  }
  const ok = await verifyEd25519BU(bu.hash, bu.assinatura, pubKey);
  return ok
    ? { status: 'valid', message: '✅ Assinatura válida (TSE)', detail: 'BU autêntico — origem confirmada pela chave pública oficial.' }
    : { status: 'invalid', message: '❌ Assinatura INVÁLIDA — não confie neste BU', detail: 'O HASH/ASSI não bate com a chave pública. Possível BU adulterado ou QR lido errado. Comunique o coordenador.' };
}
