/**
 * Card "Chaves de acesso" (Configurações > Segurança).
 * Cadastro + gerenciamento (listar + remover com confirmação, atrás da flag
 * `management`) usando a Estratégia B — backend próprio (/api/v1/passkeys) +
 * SimpleWebAuthn. Renomear NÃO é exposto (definido só no cadastro).
 *
 * Autocontido: renderiza NULL se a flag de cadastro estiver off ou o navegador
 * não suportar WebAuthn. Remover é seguro: o login por e-mail/senha permanece
 * como método de acesso (sem risco de lockout).
 */
import * as React from 'react';
import { KeyRound, ShieldCheck, Loader2, Trash2 } from 'lucide-react';
import Card from '../ui/Card';
import { passkeyFlags } from '../../lib/passkeys/flags';
import { detectPasskeySupport } from '../../lib/passkeys/support';
import type { PasskeyDevice } from '../../lib/passkeys/service';
import { registerPasskeyB, listPasskeysB, removePasskeyB } from '../../lib/passkeys/serviceB';
import { mapPasskeyError } from '../../lib/passkeys/errors';

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}
function statusLabel(s: string): string {
  return s === 'verified' ? 'ativa' : s === 'unverified' ? 'pendente' : s;
}

const PasskeyCard: React.FC = () => {
  const [supported, setSupported] = React.useState(false);
  const [deviceName, setDeviceName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [keys, setKeys] = React.useState<PasskeyDevice[]>([]);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);

  const loadKeys = React.useCallback(async () => {
    if (!passkeyFlags.management) return;
    try { setKeys(await listPasskeysB()); } catch { /* silencioso */ }
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
      await registerPasskeyB(deviceName.trim() || 'Meu dispositivo');
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
    setConfirmId(null);
    try {
      await removePasskeyB(id);
      setMsg({ kind: 'ok', text: 'Chave de acesso removida.' });
      loadKeys();
    } catch (e) {
      setMsg({ kind: 'err', text: mapPasskeyError(e).message });
    } finally {
      setBusy(false);
    }
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

      {passkeyFlags.management && (
        <div className="mb-4">
          {keys.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhuma chave cadastrada ainda neste perfil.</p>
          ) : (
            <ul className="space-y-2">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2">
                  <div>
                    <span className="text-sm text-slate-200">{k.friendlyName}</span>
                    <span className="ml-2 text-[11px] text-slate-500">
                      {statusLabel(k.status)}{k.createdAt ? ` · criada em ${fmtDate(k.createdAt)}` : ''}
                    </span>
                  </div>
                  {confirmId === k.id ? (
                    <span className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-400">Remover?</span>
                      <button onClick={() => remove(k.id)} disabled={busy} className="text-red-400 font-semibold hover:underline">Sim</button>
                      <button onClick={() => setConfirmId(null)} className="text-slate-400 hover:underline">Não</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmId(k.id)} disabled={busy} className="text-slate-400 hover:text-red-400" aria-label="Remover chave"><Trash2 className="w-4 h-4" /></button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
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
          {keys.length > 0 ? 'Cadastrar outro dispositivo' : 'Ativar acesso com biometria'}
        </button>
      </div>

      {msg && <p className={`mt-3 text-xs ${msg.kind === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    </Card>
  );
};

export default PasskeyCard;
