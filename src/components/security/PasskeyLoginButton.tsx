/**
 * Botão "Entrar com biometria" (Passkey) — Fase 2.
 * Autocontido: renderiza NULL se a flag estiver off ou o navegador não suportar.
 * Não interfere no login por e-mail/senha (fallback permanece).
 */
import * as React from 'react';
import { Fingerprint, Loader2 } from 'lucide-react';
import { passkeyFlags } from '../../lib/passkeys/flags';
import { detectPasskeySupport } from '../../lib/passkeys/support';
import { authenticateWithPasskey } from '../../lib/passkeys/service';
import { mapPasskeyError } from '../../lib/passkeys/errors';
import { supabase } from '../../lib/supabaseClient';

interface Props {
  onAuthenticated: () => void;
}

const PasskeyLoginButton: React.FC<Props> = ({ onAuthenticated }) => {
  const [supported, setSupported] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!passkeyFlags.login) return;
    let alive = true;
    detectPasskeySupport().then((s) => { if (alive) setSupported(s.webAuthnSupported); });
    return () => { alive = false; };
  }, []);

  if (!passkeyFlags.login || !supported) return null;

  const handle = async () => {
    setError('');
    setBusy(true);
    try {
      await authenticateWithPasskey();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('USER_VERIFICATION_FAILED');
      onAuthenticated();
    } catch (e) {
      setError(mapPasskeyError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative flex items-center py-1">
        <div className="flex-grow border-t border-white/10" />
        <span className="mx-3 text-xs text-slate-400">ou entre com a chave de acesso</span>
        <div className="flex-grow border-t border-white/10" />
      </div>
      <button
        type="button"
        onClick={handle}
        disabled={busy}
        aria-label="Entrar usando biometria ou chave de acesso"
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:border-sky-400 hover:bg-white/10 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Fingerprint className="h-5 w-5 text-sky-400" />}
        Entrar com biometria
      </button>
      {error && <p className="text-center text-xs text-red-300">{error}</p>}
    </div>
  );
};

export default PasskeyLoginButton;
