/**
 * Mapeamento de erros de Passkey/WebAuthn → mensagens amigáveis (PT-BR) — Fase 1.
 * Nunca expor erro bruto do protocolo na UI. Não inclui dados sensíveis.
 */
export type PasskeyErrorCode =
  | 'USER_CANCELLED'
  | 'NOT_SUPPORTED'
  | 'CREDENTIAL_ALREADY_EXISTS'
  | 'CREDENTIAL_NOT_FOUND'
  | 'USER_VERIFICATION_FAILED'
  | 'NETWORK_ERROR'
  | 'SESSION_REQUIRED'
  | 'PASSKEY_DISABLED'
  | 'UNKNOWN_ERROR';

export interface MappedPasskeyError {
  code: PasskeyErrorCode;
  message: string;
}

const MESSAGES: Record<PasskeyErrorCode, string> = {
  USER_CANCELLED: 'A validação foi cancelada. Nenhuma alteração foi feita.',
  NOT_SUPPORTED: 'Este aparelho ou navegador não oferece suporte ao acesso por chave de acesso. Use e-mail e senha.',
  CREDENTIAL_ALREADY_EXISTS: 'Este dispositivo já está cadastrado para esta conta.',
  CREDENTIAL_NOT_FOUND: 'Não encontramos uma chave de acesso cadastrada neste aparelho.',
  USER_VERIFICATION_FAILED: 'Não foi possível confirmar sua identidade. Tente novamente ou use sua senha.',
  NETWORK_ERROR: 'Falha na comunicação segura com o servidor. Verifique sua conexão.',
  SESSION_REQUIRED: 'Entre na sua conta antes de ativar o acesso por biometria.',
  PASSKEY_DISABLED: 'O acesso por chave ainda não está habilitado nesta conta.',
  UNKNOWN_ERROR: 'Ocorreu um erro inesperado. Tente novamente.',
};

export function mapPasskeyError(err: unknown): MappedPasskeyError {
  // Erros internos já vêm como Error com code conhecido.
  if (err instanceof Error && err.message in MESSAGES) {
    const code = err.message as PasskeyErrorCode;
    return { code, message: MESSAGES[code] };
  }
  // DOMException do navegador (navigator.credentials).
  const name = (err as { name?: string })?.name;
  switch (name) {
    case 'NotAllowedError':
      return { code: 'USER_CANCELLED', message: MESSAGES.USER_CANCELLED };
    case 'InvalidStateError':
      return { code: 'CREDENTIAL_ALREADY_EXISTS', message: MESSAGES.CREDENTIAL_ALREADY_EXISTS };
    case 'NotSupportedError':
    case 'SecurityError':
      return { code: 'NOT_SUPPORTED', message: MESSAGES.NOT_SUPPORTED };
    default:
      return { code: 'UNKNOWN_ERROR', message: MESSAGES.UNKNOWN_ERROR };
  }
}
