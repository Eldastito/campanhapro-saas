/**
 * Card "Chaves de acesso" (Configurações > Segurança) — Fase 2.
 * Autocontido: renderiza NULL se a flag de cadastro estiver off ou o navegador
 * não suportar. Cadastro pede um nome amigável p/ o dispositivo. Listagem/remoção
 * só aparecem se a flag de gerenciamento estiver ligada (Fase 3).
 */
import * as React from 'react';
import { KeyRound, ShieldCheck, Loader2, Trash2 } from 'lucide-react';
import Card from '../ui/Card';
import { passkeyFlags } from '../../lib/passkeys/flags';
import { detectPasskeySupport } from '../../lib/passkeys/support';
import { registerPasskey, listPasskeys, removePasskey, type PasskeyDevice } from '../../lib/passkeys/service';
import { mapPasskeyError } from '../../lib/passkeys/errors';

const PasskeyCard: React.FC = () => {
  const [supported, setSupported] = React.useState(false);
  const [deviceName, setDeviceName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [keys, setKeys] = React.useState<PasskeyDevice[]>([]);

  const loadKeys = React.useCallback(async () => {
    if (!passkeyFlags.management) return;
    try { setKeys(await listPasskeys()); } catch { /* silencioso na Fase 2 */ }
  }, []);

  React.useEffect(() => {
    if (!passkeyFlags.enrollment) return;
    let alive = true;
    detectPasskeySupport().then((s) => { if (alive) { setSupported(s.webAuthnSupported); if (s.webAuthnSupported) loadKeys(); } });
    return () => { alive = false; };
  }, [loadKeys]);

  if (!passkeyFlags.enrollment || !supported) return null;

  const activate = async () => {
    setMsg(null);
    setBusy(true);
    try {
      await registerPasskey(deviceName.trim() || 'Meu dispositivo');
      setMsg({ kind: 'ok', text: 'Chave de acesso ativada neste dispositivo.' });
      setDeviceName('');
      loadKeys();
    } catch (e) {
      setMsg({ kind: 'err', text: mapPasskeyError(e).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try { await removePasskey(id); loadKeys(); } catch (e) { setMsg({ kind: 'err', text: mapPasskeyError(e).message }); } finally { setBusy(false); }
  };

  return (
    <Card className="border-t-4 border-t-sky-500">
      <div className="flex items-center gap-3 mb-2">
        <KeyRound className="w-6 h-6 text-sky-400" />
        <h3 className="text-lg font-bold text-slate-300">Chaves de acesso (biometria)</h3>
      </div>
      <p className="text-xs text-slate-400 mb-4 flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
        Entre no CampanhaPro com a biometria ou o bloqueio seguro do aparelho. Sua digital/rosto
        permanecem no dispositivo — o CampanhaPro nunca recebe nem armazena dados biométricos.
      </p>

      {passkeyFlags.management && keys.length > 0 && (
        <ul className="mb-4 space-y-2">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2">
              <span className="text-sm text-slate-200">{k.friendlyName} <span className="text-[11px] text-slate-500">· {k.status}</span></span>
              <button onClick={() => remove(k.id)} disabled={busy} className="text-slate-400 hover:text-red-400" aria-label="Remover chave"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={deviceName}
          maxLength={120}
          onChange={(e) => setDeviceName(e.target.value)}
          placeholder="Nome do dispositivo (ex.: meu iPhone)"
          className="flex-1 rounded-xl border border-white/15 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-sky-400"
        />
        <button
          onClick={activate}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Ativar acesso com biometria
        </button>
      </div>

      {msg && <p className={`mt-3 text-xs ${msg.kind === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    </Card>
  );
};

export default PasskeyCard;
