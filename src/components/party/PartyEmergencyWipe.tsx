/**
 * Botão de Emergência — zera dados operacionais do partido (#141).
 *
 * Segurança em camadas:
 *   1. Visível só na aba Segurança (não ao lado de botões comuns)
 *   2. Modal explica o que será apagado
 *   3. Usuário digita exatamente "APAGAR TUDO"
 *   4. Reautenticação de SENHA via signInWithPassword (a senha NUNCA vai pro
 *      nosso backend — o Supabase valida e o cliente só prossegue se conferir)
 *   5. Countdown de 5s antes de liberar o botão final
 *   6. Backend revalida role 'Presidente de Partido' + ownership + confirmationText
 */
import React, { useEffect, useState } from 'react';
import { ShieldAlert, AlertTriangle, Loader2, Lock, X, ShieldCheck } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';
import { createReauthClient } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

const CONFIRM_PHRASE = 'APAGAR TUDO';
const COUNTDOWN_SECONDS = 5;

const PartyEmergencyWipe: React.FC<{ partyName: string; hasData: boolean; onWiped: () => void }> = ({ partyName, hasData, onWiped }) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const phraseOk = phrase.trim() === CONFIRM_PHRASE;
  const passwordOk = password.length >= 4;
  const ready = phraseOk && passwordOk;

  // Countdown só roda quando frase + senha estão preenchidas corretamente.
  useEffect(() => {
    if (!open || !ready) { setCountdown(COUNTDOWN_SECONDS); return; }
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [open, ready, countdown]);

  const reset = () => {
    setPhrase(''); setPassword(''); setCountdown(COUNTDOWN_SECONDS);
    setError(null); setDone(null);
  };

  const close = () => { if (!busy) { setOpen(false); reset(); } };

  const execute = async () => {
    setError(null);
    setBusy(true);
    try {
      // 1. Reautenticação da senha NO CLIENTE (senha não vai pro nosso backend).
      //    Usa cliente EFÊMERO: valida a senha sem tocar na sessão ativa nem
      //    disparar o onAuthStateChange global — senão re-logava o app e loopava.
      const email = user?.email;
      if (!email) { setError('Sessão sem e-mail. Faça login de novo.'); setBusy(false); return; }
      const reauth = createReauthClient();
      const { error: authErr } = await reauth.auth.signInWithPassword({ email, password });
      try { await reauth.auth.signOut(); } catch { /* efêmero, ignora */ }
      if (authErr) {
        setError('Senha incorreta. Tente novamente.');
        setBusy(false);
        return;
      }

      // 2. Chama o wipe (backend revalida role + ownership + frase)
      const r = await authedFetch('/api/v1/party/emergency-wipe', {
        method: 'POST',
        body: JSON.stringify({ confirmationText: CONFIRM_PHRASE }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.detail || j?.error || `Falha (HTTP ${r.status})`);
        setBusy(false);
        return;
      }
      const s = j.deletedSummary || {};
      setDone(`Apagados: ${s.candidatesDeleted ?? 0} candidato(s), ${s.repasses ?? 0} repasse(s), ${s.checkins ?? 0} check-in(s), ${s.storageFiles ?? 0} arquivo(s).`);
      setTimeout(() => { setOpen(false); reset(); onWiped(); }, 3500);
    } catch (err: any) {
      setError(err?.message || 'Erro inesperado.');
      setBusy(false);
    }
  };

  // Sem dados operacionais → esconde a Zona de Perigo. Não há o que apagar
  // (estado pós-wipe ou partido recém-criado). Reaparece quando houver dados.
  if (!hasData) {
    return (
      <div className="bg-gradient-to-br from-emerald-600/10 to-teal-600/5 border border-emerald-500/20 rounded-3xl p-6 text-center">
        <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-emerald-300">Nenhum dado operacional</h3>
        <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
          Este partido ainda não tem candidatos, repasses ou registros pra proteger.
          A <b>Zona de Perigo</b> (apagar dados) aparece automaticamente assim que houver dados cadastrados.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-red-600/10 to-rose-600/5 border border-red-500/20 rounded-3xl p-5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-7 h-7 text-red-400 shrink-0" />
          <div className="flex-1">
            <h3 className="text-lg font-bold text-red-300">Zona de Perigo</h3>
            <p className="text-sm text-slate-400 mt-1">
              O botão abaixo apaga <b>todos os dados operacionais</b> do partido <b>{partyName}</b>:
              candidatos, repasses, comitês, check-ins, comprovantes e telão.
              A conta de acesso (login, plano) <b>continua existindo</b> — só os dados de operação são zerados.
            </p>
            <p className="text-xs text-red-300/80 mt-2 font-bold">⚠️ Esta ação é definitiva e não pode ser desfeita.</p>
            <button
              onClick={() => { reset(); setOpen(true); }}
              className="mt-4 flex items-center gap-2 px-4 py-2.5 bg-red-600/80 hover:bg-red-600 text-white font-bold rounded-xl transition-all"
            >
              <AlertTriangle className="w-4 h-4" /> Apagar dados do partido
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4" onClick={close}>
          <div className="bg-slate-900 border border-red-500/30 rounded-2xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-6 h-6 text-red-400" />
                <h4 className="text-lg font-bold text-white">Apagar todos os dados do partido?</h4>
              </div>
              {!busy && <button onClick={close} className="text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>}
            </div>

            {done ? (
              <div className="text-center py-6">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-emerald-300 font-bold">Dados apagados com sucesso.</p>
                <p className="text-xs text-slate-400 mt-2">{done}</p>
              </div>
            ) : (
              <>
                <div className="bg-slate-950/60 border border-white/5 rounded-xl p-3 mb-4 text-[11px] text-slate-400 leading-relaxed">
                  Serão apagados: repasses, valores, comprovantes, imagens, candidatos, comitês,
                  check-ins, metas, rankings e dados do telão. <b className="text-slate-300">A conta e o login permanecem.</b>
                </div>

                {/* Honeypots: absorvem o autofill do navegador (que tentava preencher
                    email+senha nos campos reais). Invisíveis e ignorados. */}
                <input type="text" name="username" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden="true" />
                <input type="password" name="password" autoComplete="current-password" className="hidden" tabIndex={-1} aria-hidden="true" />

                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                  Digite <span className="text-red-400">{CONFIRM_PHRASE}</span> para confirmar
                </label>
                <input
                  value={phrase} onChange={(e) => setPhrase(e.target.value.toUpperCase())}
                  placeholder={CONFIRM_PHRASE}
                  autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
                  name="cp_confirm_phrase" data-lpignore="true" data-form-type="other"
                  className={`w-full bg-slate-950 border rounded-xl px-3 py-2.5 text-white mb-3 ${phraseOk ? 'border-emerald-500/50' : 'border-white/10'}`}
                />

                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Sua senha (reautenticação)
                </label>
                <input
                  type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Senha da sua conta"
                  autoComplete="new-password" data-lpignore="true"
                  name="cp_reauth_password"
                  className={`w-full bg-slate-950 border rounded-xl px-3 py-2.5 text-white mb-4 ${passwordOk ? 'border-emerald-500/50' : 'border-white/10'}`}
                />

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 text-xs text-red-300 mb-3">{error}</div>
                )}

                <div className="flex gap-2">
                  <button onClick={close} disabled={busy} className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold">
                    Cancelar
                  </button>
                  <button
                    onClick={execute}
                    disabled={!ready || countdown > 0 || busy}
                    className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-bold flex items-center justify-center gap-2"
                  >
                    {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Apagando...</>
                      : !ready ? 'Preencha frase + senha'
                      : countdown > 0 ? `Aguarde ${countdown}s...`
                      : 'Confirmar exclusão definitiva'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PartyEmergencyWipe;
