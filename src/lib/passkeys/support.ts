/**
 * Detecção de suporte a Passkeys/WebAuthn no navegador/dispositivo — Fase 1.
 * Puro, sem efeitos colaterais. Usado para OCULTAR a UI quando não houver suporte
 * (critério de aceite: botão de biometria só aparece se o navegador suportar).
 */
export interface PasskeySupport {
  /** API WebAuthn presente (window.PublicKeyCredential). */
  webAuthnSupported: boolean;
  /** Há autenticador de plataforma (biometria/PIN do próprio aparelho). */
  platformAuthenticatorAvailable: boolean;
  /** Suporte a "Conditional UI" (autofill de passkey). */
  conditionalUiAvailable: boolean;
}

export async function detectPasskeySupport(): Promise<PasskeySupport> {
  const webAuthnSupported =
    typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';

  if (!webAuthnSupported) {
    return { webAuthnSupported: false, platformAuthenticatorAvailable: false, conditionalUiAvailable: false };
  }

  const PKC = window.PublicKeyCredential as unknown as {
    isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
    isConditionalMediationAvailable?: () => Promise<boolean>;
  };

  let platformAuthenticatorAvailable = false;
  let conditionalUiAvailable = false;
  try {
    if (typeof PKC.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      platformAuthenticatorAvailable = await PKC.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    if (typeof PKC.isConditionalMediationAvailable === 'function') {
      conditionalUiAvailable = await PKC.isConditionalMediationAvailable();
    }
  } catch {
    /* navegadores antigos podem lançar — tratamos como "sem suporte". */
  }

  return { webAuthnSupported, platformAuthenticatorAvailable, conditionalUiAvailable };
}
