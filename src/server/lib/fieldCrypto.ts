/**
 * Criptografia de campo (application-layer) para dados sensíveis — CPF, RG,
 * dados bancários/PIX, documento do doador, CPF/CNPJ do candidato.
 *
 * POR QUE no servidor: a chave (FIELD_ENCRYPTION_KEY) vive SÓ no backend e nunca
 * vai pro browser. Cripto no cliente seria teatro (a chave estaria no bundle).
 * Por isso os campos cobertos passam a ser gravados/lidos via endpoints próprios
 * que chamam encrypt/decrypt aqui antes de tocar o Postgres.
 *
 * Formato do token: `enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>` (AES-256-GCM —
 * autenticado, detecta adulteração). `decryptField` deixa texto puro passar sem
 * mexer → migração suave (linhas legadas continuam legíveis até serem re-gravadas).
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // recomendado para GCM

let cachedKey: Buffer | null = null;

/** Resolve a chave de 32 bytes a partir de FIELD_ENCRYPTION_KEY (hex64, base64 de
 *  32 bytes, ou passphrase derivada via scrypt). Só é chamada quando há trabalho
 *  cripto real — texto puro em leitura não exige chave. */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('FIELD_ENCRYPTION_KEY ausente — criptografia de campo indisponível.');
  }
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    const b = Buffer.from(raw, 'base64');
    // base64 de exatamente 32 bytes → usa direto; senão deriva da passphrase.
    key = b.length === 32 ? b : scryptSync(raw, 'campanhapro-field-enc-v1', 32);
  }
  if (key.length !== 32) {
    throw new Error('FIELD_ENCRYPTION_KEY inválida — não derivou 32 bytes.');
  }
  cachedKey = key;
  return key;
}

/** True se o valor já é um token cifrado deste módulo. */
export function isEncrypted(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(PREFIX);
}

/** Cifra um valor. null/undefined/'' passam intactos; já-cifrado é idempotente. */
export function encryptField(plain: string | null | undefined): string | null | undefined {
  if (plain === null || plain === undefined || plain === '') return plain;
  if (isEncrypted(plain)) return plain;
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** Decifra um token. Texto puro (legado) e null/undefined passam intactos. */
export function decryptField(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  if (!isEncrypted(value)) return value; // legado em texto puro → migração suave
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Token de criptografia malformado.');
  const [ivB, tagB, ctB] = parts;
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}

/** Cifra, num clone do objeto, apenas os campos listados que existirem nele. */
export function encryptFields<T extends Record<string, any>>(obj: T, fields: readonly string[]): T {
  if (!obj) return obj;
  const out: any = { ...obj };
  for (const f of fields) if (f in out) out[f] = encryptField(out[f]);
  return out;
}

/** Decifra, num clone, os campos listados. Falha de decifra → null (fail-closed:
 *  nunca devolve ciphertext bruto pra tela nem quebra a renderização). */
export function decryptFields<T extends Record<string, any>>(obj: T, fields: readonly string[]): T {
  if (!obj) return obj;
  const out: any = { ...obj };
  for (const f of fields) {
    if (f in out) {
      try {
        out[f] = decryptField(out[f]);
      } catch (e) {
        console.warn(`[fieldCrypto] falha ao decifrar campo "${f}":`, (e as Error)?.message);
        out[f] = null;
      }
    }
  }
  return out;
}

/** Aplica decryptFields a uma lista (helper pra respostas de listagem). */
export function decryptRows<T extends Record<string, any>>(rows: T[], fields: readonly string[]): T[] {
  return Array.isArray(rows) ? rows.map((r) => decryptFields(r, fields)) : rows;
}

/** Só pra testes: limpa a chave em cache (permite trocar a env entre casos). */
export function _resetKeyCache(): void {
  cachedKey = null;
}
