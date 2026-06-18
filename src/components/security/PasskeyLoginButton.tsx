/**
 * "Entrar com biometria" na tela de login — Estratégia B (login passwordless real).
 *
 * Usa o backend próprio (/api/v1/passkeys/login/*) + SimpleWebAuthn para verificar
 * a passkey SEM sessão prévia e, então, abrir uma sessão Supabase. Isto é o que o
 * WebAuthn do Supabase NÃO permite (lá é só MFA/step-up).
 *
 * Autocontido: renderiza null se a flag `login` estiver off ou o navegador não
 * suportar WebAuthn → a tela de login some o botão e o e-mail/senha segue intacto.
 */
import * as React from 'react';
import { Fingerprint, Loader2 } from 'lucide-react';
import { passkeyFlags } from '../../lib/passkeys/flags';
import { detectPasskeySupport } from '../../lib/passkeys/support';
import { loginWithPasskey } from '../../lib/passkeys/serviceB';
import { mapPasskeyError } from '../../lib/passkeys/errors';

interface Props {
  onAuthenticated?: () => void;
}

const PasskeyLoginButton: React.FC<Props> = ({ onAuthenticated }) => {
  const [supported, setSupported] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!passkeyFlags.login) return;
    let alive = true;
    detectPasskeySupport().then((s) => { if (alive) setSupported(s.webAuthnSupported); });
    return () => { alive = false; };
  }, []);

  if (!passkeyFlags.login || !supported) return null;

  const handle = async () => {
    setErr(null);
    setBusy(true);
    try {
      await loginWithPasskey();
      onAuthenticated?.();
    } catch (e) {
      setErr(mapPasskeyError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={handle}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-slate-900/60 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4 text-sky-400" />}
        Entrar com biometria
      </button>
      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
    </div>
  );
};

export default PasskeyLoginButton;
