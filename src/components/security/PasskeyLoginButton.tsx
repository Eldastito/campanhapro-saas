/**
 * "Entrar com biometria" na tela de login — DESATIVADO.
 *
 * A SDK do Supabase (auth-js 2.104) NÃO oferece login passwordless por passkey:
 * o WebAuthn existe só como MFA/step-up (exige sessão + factorId). Logar do zero
 * só com biometria exigiria a Estratégia B (SimpleWebAuthn + backend próprio).
 * Por isso este componente renderiza null — passkey é usado para STEP-UP em ações
 * críticas (ex.: "Apagar tudo") e cadastro/gestão em Configurações.
 *
 * Mantido como stub para não alterar o LoginPage; reativar só quando houver um
 * caminho real de primeiro fator.
 */
import * as React from 'react';

interface Props {
  onAuthenticated?: () => void;
}

const PasskeyLoginButton: React.FC<Props> = () => null;

export default PasskeyLoginButton;
