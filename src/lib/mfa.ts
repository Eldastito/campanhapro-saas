/**
 * 2FA por TOTP (app autenticador) usando o MFA NATIVO do Supabase Auth.
 * Tudo client-side (supabase.auth.mfa.*) — sem backend próprio. O segredo TOTP é
 * gerado e verificado pelo Supabase; aqui só orquestramos a UI e o desafio.
 */
import { supabase } from './supabaseClient';

export interface TotpFactor {
  id: string;
  friendlyName: string | null;
  status: string; // 'verified' | 'unverified'
  createdAt?: string;
}

export async function listTotpFactors(): Promise<TotpFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return ((data as any)?.totp ?? []).map((f: any) => ({
    id: f.id,
    friendlyName: f.friendly_name ?? null,
    status: f.status,
    createdAt: f.created_at,
  }));
}

export interface EnrollResult { factorId: string; qrCode: string; secret: string; uri: string; }

export async function enrollTotp(friendlyName: string): Promise<EnrollResult> {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName });
  if (error) throw error;
  const totp = (data as any).totp;
  return { factorId: (data as any).id, qrCode: totp.qr_code, secret: totp.secret, uri: totp.uri };
}

/** Confirma o cadastro: desafia o fator recém-criado e valida o código de 6 dígitos. */
export async function verifyTotpEnroll(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw error;
}

export async function unenrollTotp(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

/** True se a sessão fez senha (aal1) mas há um 2º fator pendente (aal2). */
export async function mfaStepUpNeeded(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.currentLevel === 'aal1' && data.nextLevel === 'aal2';
}

/** Completa o 2º fator no login com o código do app autenticador. */
export async function completeMfaChallenge(code: string): Promise<void> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  const factor = ((data as any)?.totp ?? []).find((f: any) => f.status === 'verified');
  if (!factor) throw new Error('Nenhum fator de autenticação ativo.');
  const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (vErr) throw vErr;
}
