/**
 * Feature flags de Passkeys (WebAuthn) — controlam a UI (Estratégia B).
 *
 * Login/cadastro/gestão usam o backend próprio (/api/v1/passkeys + SimpleWebAuthn),
 * que só responde com PASSKEY_B_ENABLED=true no servidor. Estas flags VITE_PASSKEY_*
 * controlam só a aparência na interface — a do servidor precisa estar ligada também
 * pra valer. Tudo desligado por padrão: nada muda em produção até habilitarmos.
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
