/**
 * Wrapper fino sobre a API EXPERIMENTAL de Passkeys do Supabase Auth — Fase 1.
 *
 * API real (confirmada em @supabase/auth-js): `supabase.auth.mfa.webauthn`
 *   .register({ friendlyName })  → cadastra (enroll+challenge+verify)
 *   .authenticate(...)           → login
 * Gerenciamento: `auth.mfa.listFactors()` / `auth.mfa.unenroll()`.
 *
 * Boundary com cast controlado: a superfície `.webauthn` ainda não é tipada na
 * versão instalada (2.104), então isolamos o `as any` AQUI, num só lugar.
 * Tudo protegido por feature flag — NÃO está ligado a nenhuma UI nesta fase.
 */
import { supabase } from '../supabaseClient';
import { passkeyFlags } from './flags';

interface WebAuthnExperimental {
  register: (params: { friendlyName: string }) => Promise<unknown>;
  authenticate: (params?: unknown) => Promise<unknown>;
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
  return webauthnApi().register({ friendlyName: friendlyName.slice(0, 120) });
}

/** Login via passkey (tela de entrada). */
export async function authenticateWithPasskey(): Promise<unknown> {
  if (!passkeyFlags.login) throw new Error('PASSKEY_DISABLED');
  return webauthnApi().authenticate();
}

/** Lista as passkeys (fatores WebAuthn) do usuário. */
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

/** Remove (revoga) uma passkey. */
export async function removePasskey(factorId: string): Promise<void> {
  if (!passkeyFlags.management) throw new Error('PASSKEY_DISABLED');
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}
