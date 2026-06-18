/**
 * Feature flags de Passkeys (WebAuthn) — Fase 1.
 *
 * Recurso EXPERIMENTAL do Supabase Auth (auth.mfa.webauthn). Tudo desligado por
 * padrão: só liga quando as envs VITE_PASSKEY_* forem 'true'. Assim a fundação
 * pode entrar em produção sem afetar ninguém até decidirmos habilitar.
 *
 * IMPORTANTE (Fase 0): a passkey fica presa ao domínio (rp_id). Definido como
 * campanhapro2.tesseractauto.com.br. Trocar o domínio depois invalida todas as
 * passkeys cadastradas.
 */
const env = import.meta.env as Record<string, string | undefined>;

const on = (v: string | undefined) => v === 'true';

export const passkeyFlags = {
  /** Mostra "Entrar com biometria" na tela de login. */
  login: on(env.VITE_PASSKEY_LOGIN_ENABLED),
  /** Permite cadastrar passkey em Configurações > Segurança. */
  enrollment: on(env.VITE_PASSKEY_ENROLLMENT_ENABLED),
  /** Tela de gerenciamento (listar/renomear/remover). */
  management: on(env.VITE_PASSKEY_MANAGEMENT_ENABLED),
  /** Reautenticação por passkey em ações críticas (ex.: Apagar tudo). */
  stepUp: on(env.VITE_PASSKEY_STEP_UP_ENABLED),
} as const;

/** True se qualquer parte do recurso estiver habilitada. */
export const anyPasskeyFeature = Object.values(passkeyFlags).some(Boolean);
