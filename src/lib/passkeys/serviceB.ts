/**
 * Cliente de Passkeys — Estratégia B (backend próprio + SimpleWebAuthn browser).
 *
 * Diferente de `service.ts` (que usa o WebAuthn do Supabase, restrito a MFA/step-up),
 * aqui falamos com os endpoints /api/v1/passkeys do nosso servidor:
 *   - login passwordless de verdade (sem sessão prévia) → emite sessão Supabase;
 *   - cadastro/gestão de credenciais guardadas na nossa tabela.
 *
 * O backend só responde quando PASSKEY_B_ENABLED=true (senão 404). O gate de UI
 * continua sendo `passkeyFlags` (VITE_PASSKEY_*).
 */
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { supabase } from '../supabaseClient';
import { authedFetch } from '../authedFetch';
import { passkeyFlags } from './flags';
import type { PasskeyDevice } from './service';

const BASE = '/api/v1/passkeys';

async function postJson(path: string, body?: unknown): Promise<any> {
  const res = await authedFetch(`${BASE}${path}`, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) throw new Error('PASSKEY_DISABLED');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || 'NETWORK_ERROR');
  return json;
}

/**
 * Login passwordless: pede o desafio, deixa o navegador assinar com a biometria,
 * verifica no backend e troca o token retornado por uma sessão Supabase real.
 */
export async function loginWithPasskey(): Promise<void> {
  if (!passkeyFlags.login) throw new Error('PASSKEY_DISABLED');
  const optionsJSON = await postJson('/login/options');
  const response = await startAuthentication({ optionsJSON });
  const result = await postJson('/login/verify', { response });
  if (!result?.token_hash) throw new Error('USER_VERIFICATION_FAILED');
  // Fecha o ciclo: token (magiclink hashed) → sessão Supabase no cliente.
  const { error } = await supabase.auth.verifyOtp({
    token_hash: result.token_hash,
    type: result.type ?? 'magiclink',
  });
  if (error) throw error;
}

/** Cadastra uma nova passkey para o usuário JÁ logado (Configurações). */
export async function registerPasskeyB(deviceName: string): Promise<void> {
  if (!passkeyFlags.enrollment) throw new Error('PASSKEY_DISABLED');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('SESSION_REQUIRED');
  const optionsJSON = await postJson('/register/options');
  const response = await startRegistration({ optionsJSON });
  await postJson('/register/verify', { response, deviceName: deviceName.slice(0, 120) });
}

/** Lista as passkeys (Estratégia B) do usuário logado. */
export async function listPasskeysB(): Promise<PasskeyDevice[]> {
  const res = await authedFetch(`${BASE}/list`);
  if (res.status === 404) return [];
  const json = await res.json().catch(() => ({ credentials: [] }));
  if (!res.ok) throw new Error(json?.error || 'NETWORK_ERROR');
  return (json.credentials ?? []).map((c: any) => ({
    id: String(c.id),
    friendlyName: c.device_name || 'Dispositivo',
    createdAt: c.created_at ? String(c.created_at) : undefined,
    status: 'verified',
  }));
}

/** Revoga uma passkey (Estratégia B). */
export async function removePasskeyB(id: string): Promise<void> {
  if (!passkeyFlags.management) throw new Error('PASSKEY_DISABLED');
  await postJson('/revoke', { id });
}
