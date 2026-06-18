/**
 * Wrapper sobre a API de Passkeys/WebAuthn do Supabase Auth.
 *
 * DESCOBERTA IMPORTANTE (auth-js 2.104): o WebAuthn do Supabase é exposto APENAS
 * sob `auth.mfa.webauthn` — ou seja, é **MFA / step-up** (reautenticação de um
 * usuário JÁ logado), exigindo `factorId`. NÃO existe login passwordless de
 * primeiro fator por passkey nesta versão (os sign-in são password/OAuth/OTP/SSO).
 * Portanto: cadastro (register) + step-up (authenticate por factorId) funcionam;
 * "entrar só com biometria" na tela de login NÃO é suportado por aqui.
 *
 * Cast experimental isolado num único ponto (a superfície `.webauthn` ainda não
 * é tipada na versão instalada).
 */
import { supabase } from '../supabaseClient';
import { passkeyFlags } from './flags';

interface WebAuthnExperimental {
  register: (params: { friendlyName: string }) => Promise<{ error?: unknown }>;
  authenticate: (params: { factorId: string }) => Promise<{ error?: unknown }>;
}

function webauthnApi(): WebAuthnExperimental {
  const api = (supabase.auth.mfa as unknown as { webauthn?: WebAuthnExperimental }).webauthn;
  if (!api) throw new Error('NOT_SUPPORTED');
  return api;
}

export interface PasskeyDevice {
  id: string;
  friendlyName: string;
  createdAt?: string;
  status: string;
}

/** Cadastra uma nova passkey para o usuário logado. */
export async function registerPasskey(friendlyName: string): Promise<unknown> {
  if (!passkeyFlags.enrollment) throw new Error('PASSKEY_DISABLED');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('SESSION_REQUIRED');
  const res = await webauthnApi().register({ friendlyName: friendlyName.slice(0, 120) });
  if (res?.error) throw res.error;
  return res;
}

/** Lista as passkeys (fatores WebAuthn) do usuário logado. */
export async function listPasskeys(): Promise<PasskeyDevice[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  const all = ((data as unknown as { all?: unknown[] }).all ?? []) as Array<Record<string, unknown>>;
  return all
    .filter((f) => f.factor_type === 'webauthn')
    .map((f) => ({
      id: String(f.id),
      friendlyName: String(f.friendly_name ?? 'Dispositivo'),
      createdAt: f.created_at ? String(f.created_at) : undefined,
      status: String(f.status ?? 'unverified'),
    }));
}

/**
 * Step-up: reautentica por biometria um usuário JÁ logado (para ações críticas).
 * Requer sessão + um fator WebAuthn verificado (factorId).
 */
export async function stepUpWithPasskey(): Promise<void> {
  if (!passkeyFlags.stepUp) throw new Error('PASSKEY_DISABLED');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('SESSION_REQUIRED');
  const factors = await listPasskeys();
  const f = factors.find((x) => x.status === 'verified') ?? factors[0];
  if (!f) throw new Error('CREDENTIAL_NOT_FOUND');
  const res = await webauthnApi().authenticate({ factorId: f.id });
  if (res?.error) throw res.error;
}

/** Remove (revoga) uma passkey. */
export async function removePasskey(factorId: string): Promise<void> {
  if (!passkeyFlags.management) throw new Error('PASSKEY_DISABLED');
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}
