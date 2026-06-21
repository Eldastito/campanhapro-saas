/**
 * Card "Verificação em duas etapas (2FA)" — Configurações > Segurança.
 * Cadastro/remoção de TOTP (app autenticador) via MFA nativo do Supabase.
 * Opt-in por usuário; remover é seguro (login por senha permanece). O desafio
 * no login é tratado na LoginPage/AuthContext.
 */
import * as React from 'react';
import { ShieldCheck, Loader2, Trash2, Smartphone, Copy, Check } from 'lucide-react';
import Card from '../ui/Card';
import {
  listTotpFactors, enrollTotp, verifyTotpEnroll, unenrollTotp,
  type TotpFactor, type EnrollResult,
} from '../../lib/mfa';

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}

const MfaCard: React.FC = () => {
  const [factors, setFactors] = React.useState<TotpFactor[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [enroll, setEnroll] = React.useState<EnrollResult | null>(null);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [msg, setMsg] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const load = React.useCallback(async () => {
    try { setFactors(await listTotpFactors()); } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const verified = factors.filter((f) => f.status === 'verified');

  const startEnroll = async () => {
    setMsg(null); setBusy(true);
    try {
      setEnroll(await enrollTotp(name.trim() || 'App autenticador'));
      setCode('');
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Falha ao iniciar o cadastro.' });
    } finally { setBusy(false); }
  };

  const confirmEnroll = async () => {
    if (!enroll) return;
    setMsg(null); setBusy(true);
    try {
      await verifyTotpEnroll(enroll.factorId, code.trim());
      setEnroll(null); setName(''); setCode('');
      setMsg({ kind: 'ok', text: '2FA ativado. No próximo login vamos pedir o código.' });
      await load();
    } catch {
      setMsg({ kind: 'err', text: 'Código inválido. Confira no app e tente de novo.' });
    } finally { setBusy(false); }
  };

  const cancelEnroll = async () => {
    // Remove o fator não-confirmado pra não deixar 'unverified' órfão.
    if (enroll) { try { await unenrollTotp(enroll.factorId); } catch { /* */ } }
    setEnroll(null); setCode(''); setName(''); setMsg(null);
  };

  const remove = async (id: string) => {
    setBusy(true); setConfirmId(null);
    try {
      await unenrollTotp(id);
      setMsg({ kind: 'ok', text: '2FA removido. O login volta a ser só com senha.' });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Falha ao remover.' });
    } finally { setBusy(false); }
  };

  const copySecret = () => {
    if (!enroll) return;
    navigator.clipboard?.writeText(enroll.secret).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {},
    );
  };

  return (
    <Card className="border-t-4 border-t-emerald-500">
      <div className="flex items-center gap-3 mb-2">
        <ShieldCheck className="w-6 h-6 text-emerald-400" />
        <h3 className="text-lg font-bold text-slate-300">Verificação em duas etapas (2FA)</h3>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Além da senha, peça um código de 6 dígitos de um app autenticador
        (Google Authenticator, Authy, 1Password…) a cada login. Camada extra
        mesmo que a senha vaze.
      </p>

      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
      ) : enroll ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">1. Escaneie o QR no seu app autenticador (ou use a chave manual):</p>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <img src={enroll.qrCode} alt="QR Code 2FA" className="w-40 h-40 rounded-lg bg-white p-2" />
            <div className="flex-1 text-xs min-w-0">
              <p className="text-slate-400 mb-1">Chave manual:</p>
              <div className="flex items-center gap-2">
                <code className="break-all rounded bg-slate-800 px-2 py-1 text-slate-200">{enroll.secret}</code>
                <button onClick={copySecret} className="text-slate-400 hover:text-white flex-shrink-0" aria-label="Copiar chave">
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-400">2. Digite o código de 6 dígitos que aparece no app:</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              inputMode="numeric" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="flex-1 rounded-xl border border-white/15 bg-slate-950 px-3 py-2.5 text-sm tracking-[0.4em] text-white outline-none focus:border-emerald-400"
            />
            <button onClick={confirmEnroll} disabled={busy || code.length !== 6}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Confirmar
            </button>
            <button onClick={cancelEnroll} disabled={busy}
              className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700">Cancelar</button>
          </div>
        </div>
      ) : (
        <>
          {verified.length > 0 && (
            <ul className="space-y-2 mb-4">
              {verified.map((f) => (
                <li key={f.id} className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm text-slate-200">{f.friendlyName || 'App autenticador'}</span>
                    <span className="text-[11px] text-slate-500">ativo{f.createdAt ? ` · ${fmtDate(f.createdAt)}` : ''}</span>
                  </div>
                  {confirmId === f.id ? (
                    <span className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-400">Remover?</span>
                      <button onClick={() => remove(f.id)} disabled={busy} className="text-red-400 font-semibold hover:underline">Sim</button>
                      <button onClick={() => setConfirmId(null)} className="text-slate-400 hover:underline">Não</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmId(f.id)} disabled={busy} className="text-slate-400 hover:text-red-400" aria-label="Remover 2FA"><Trash2 className="w-4 h-4" /></button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text" value={name} maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="Apelido (ex.: meu celular)"
              className="flex-1 rounded-xl border border-white/15 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-emerald-400"
            />
            <button onClick={startEnroll} disabled={busy}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {verified.length > 0 ? 'Adicionar outro app' : 'Ativar 2FA'}
            </button>
          </div>
        </>
      )}

      {msg && <p className={`mt-3 text-xs ${msg.kind === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    </Card>
  );
};

export default MfaCard;
