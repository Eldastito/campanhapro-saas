/**
 * Helper de WebAuthn (Estratégia B — login passwordless com backend próprio).
 *
 * Encapsula a biblioteca @simplewebauthn/server (v13) numa superfície fina e
 * tipada. NÃO toca no banco nem em rota: só monta opções e verifica respostas.
 * A persistência de credenciais/desafios e a emissão de sessão Supabase ficam
 * nas fases seguintes (B2 — endpoints; B3 — frontend).
 *
 * Config do RP vem do ambiente (sem default de produção embutido):
 *   WEBAUTHN_RP_ID    ex.: campanhapro2.tesseractauto.com.br  (domínio, sem https)
 *   WEBAUTHN_RP_NAME  ex.: CampanhaPro
 *   WEBAUTHN_ORIGIN   ex.: https://campanhapro2.tesseractauto.com.br
 * O flag PASSKEY_B_ENABLED (lido nos endpoints, não aqui) controla o rollout.
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
  type WebAuthnCredential,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';

export interface RpConfig {
  rpID: string;
  rpName: string;
  origin: string;
}

/** Lê e valida a config do RP a partir do ambiente. Lança se faltar algo. */
export function getRpConfig(): RpConfig {
  const rpID = process.env.WEBAUTHN_RP_ID;
  const rpName = process.env.WEBAUTHN_RP_NAME || 'CampanhaPro';
  const origin = process.env.WEBAUTHN_ORIGIN || (rpID ? `https://${rpID}` : undefined);
  if (!rpID || !origin) {
    throw new Error('WEBAUTHN_NOT_CONFIGURED');
  }
  return { rpID, rpName, origin };
}

/** base64url ⇄ Uint8Array (a publicKey vem como Uint8Array da lib). */
export function toBase64url(buf: Uint8Array): string {
  return Buffer.from(buf).toString('base64url');
}
export function fromBase64url(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64url'));
}

/** Credencial já existente do usuário (para excludeCredentials / allowCredentials). */
export interface StoredCredential {
  credentialId: string; // base64url
  transports?: AuthenticatorTransportFuture[];
}

/** Opções de REGISTRO (cadastro de uma nova passkey para um usuário). */
export async function buildRegistrationOptions(params: {
  userId: string;
  userName: string;
  userDisplayName?: string;
  existing?: StoredCredential[];
}) {
  const { rpID, rpName } = getRpConfig();
  return generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(params.userId),
    userName: params.userName,
    userDisplayName: params.userDisplayName ?? params.userName,
    attestationType: 'none',
    excludeCredentials: (params.existing ?? []).map((c) => ({
      id: c.credentialId,
      transports: c.transports,
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
  });
}

/** Verifica a resposta de REGISTRO contra o desafio emitido. */
export async function checkRegistration(params: {
  response: Parameters<typeof verifyRegistrationResponse>[0]['response'];
  expectedChallenge: string;
}): Promise<VerifiedRegistrationResponse> {
  const { rpID, origin } = getRpConfig();
  return verifyRegistrationResponse({
    response: params.response,
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
}

/** Opções de AUTENTICAÇÃO (login). Sem allowCredentials → discoverable/resident. */
export async function buildAuthenticationOptions(params?: {
  allow?: StoredCredential[];
}) {
  const { rpID } = getRpConfig();
  return generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: params?.allow?.map((c) => ({
      id: c.credentialId,
      transports: c.transports,
    })),
  });
}

/** Verifica a resposta de AUTENTICAÇÃO contra o desafio + credencial guardada. */
export async function checkAuthentication(params: {
  response: Parameters<typeof verifyAuthenticationResponse>[0]['response'];
  expectedChallenge: string;
  credential: WebAuthnCredential;
}): Promise<VerifiedAuthenticationResponse> {
  const { rpID, origin } = getRpConfig();
  return verifyAuthenticationResponse({
    response: params.response,
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: params.credential,
    requireUserVerification: false,
  });
}
