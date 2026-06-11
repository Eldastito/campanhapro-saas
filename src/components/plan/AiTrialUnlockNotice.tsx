/**
 * Aviso (modal) que dispara UMA vez por sessão quando o coordenador atinge
 * 300 leads e fica elegível ao trial (#97). É a celebração que vira gatilho
 * de conversão — fica muito mais difícil ignorar o trial depois desse modal.
 */
import * as React from 'react';
import { Sparkles, X, PartyPopper, Loader2 } from 'lucide-react';
import { usePlanStatus, isFree, invalidatePlanStatus } from '../../hooks/usePlanStatus';
import { authedFetch } from '../../lib/authedFetch';

const SHOWN_KEY = 'aiTrialUnlockSeen';

const AiTrialUnlockNotice: React.FC = () => {
  const { status, refresh } = usePlanStatus();
  const [open, setOpen] = React.useState(false);
  const [activating, setActivating] = React.useState(false);

  React.useEffect(() => {
    if (!status || !isFree(status)) return;
    if (!status.trial.eligible) return;
    try {
      if (sessionStorage.getItem(SHOWN_KEY) === '1') return;
      sessionStorage.setItem(SHOWN_KEY, '1');
    } catch { /* */ }
    setOpen(true);
  }, [status]);

  if (!open) return null;
  const t = status?.trial;
  if (!t) return null;

  const activate = async () => {
    setActivating(true);
    try {
      const r = await authedFetch('/api/v1/plan/activate-ai-trial', { method: 'POST' });
      if (r.ok) { invalidatePlanStatus(); await refresh(); }
    } catch { /* */ }
    finally { setActivating(false); setOpen(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={() => setOpen(false)}>
      <div className="bg-gradient-to-br from-indigo-900 to-fuchsia-900 border border-fuchsia-500/40 rounded-3xl max-w-md w-full p-6 sm:p-8 relative overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="absolute -top-6 -right-6 opacity-20"><PartyPopper className="w-32 h-32 text-white" /></div>

        <button onClick={() => setOpen(false)} className="absolute top-4 right-4 text-white/60 hover:text-white"><X className="w-5 h-5" /></button>

        <div className="relative">
          <div className="inline-flex items-center gap-2 bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 text-xs font-bold px-3 py-1.5 rounded-full mb-3">
            <PartyPopper className="w-3.5 h-3.5" /> Conquista desbloqueada
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white leading-tight mb-2">
            Parabéns! Você passou de {t.leadsThreshold} eleitores 🎉
          </h2>
          <p className="text-sm text-indigo-100/80 mb-5">
            Como recompensa, a gente libera <b className="text-white">24 horas grátis de IA</b> pra você testar:
            <br />• 25 classificações automáticas de eleitores
            <br />• 5 dossiês de adversários
            <br /><br />
            <b>O relógio começa quando você ativar.</b> Use no melhor momento.
          </p>

          <div className="space-y-2">
            <button onClick={activate} disabled={activating}
              className="w-full bg-white text-indigo-900 hover:bg-fuchsia-100 disabled:opacity-50 rounded-xl px-4 py-3 font-black flex items-center justify-center gap-2 shadow-lg">
              {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {activating ? 'Ativando…' : 'Ativar minhas 24h de IA agora'}
            </button>
            <button onClick={() => setOpen(false)}
              className="w-full bg-transparent border border-white/20 hover:bg-white/10 rounded-xl px-4 py-2.5 font-bold text-white/70 text-sm">
              Ativo depois (vejo no painel)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiTrialUnlockNotice;
