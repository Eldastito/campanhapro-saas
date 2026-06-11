/**
 * Card do trial 24h de IA — só pro plano GRÁTIS.
 *
 * Tem 4 estados:
 *  1. PROGRESSO — leads < 300 → barra "X/300, faltam Y"
 *  2. ELEGÍVEL — leads ≥ 300, nunca ativou → "🎉 Liberamos 24h de IA · [Ativar agora]"
 *  3. ATIVO — trialUntil > now → contador regressivo + cota usada
 *  4. EXPIRADO — startedAt existe e venceu → CTA "Continuar com Plano Pro"
 *
 * Pagantes e não-grátis NÃO veem este card.
 */
import * as React from 'react';
import { Sparkles, Loader2, Clock, ArrowRight, PartyPopper } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePlanStatus, isFree, invalidatePlanStatus } from '../../hooks/usePlanStatus';
import { authedFetch } from '../../lib/authedFetch';

const TRIAL_COTA = 30; // cota dura do trial: 25 classificações + 5 dossiês

function fmtCountdown(untilIso: string): string {
  const ms = new Date(untilIso).getTime() - Date.now();
  if (ms <= 0) return 'expirado';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

const AiTrialCard: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { status, refresh } = usePlanStatus();
  const [activating, setActivating] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0); // força re-render do countdown

  // Countdown atualiza a cada 30s
  React.useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!status || !isFree(status)) return null;
  const { trial } = status;

  const activate = async () => {
    setActivating(true); setErrorMsg(null);
    try {
      const r = await authedFetch('/api/v1/plan/activate-ai-trial', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) { setErrorMsg(j.message || j.error || 'Não foi possível ativar.'); return; }
      invalidatePlanStatus();
      await refresh();
    } catch { setErrorMsg('Erro de conexão. Tente novamente.'); }
    finally { setActivating(false); }
  };

  // ESTADO 4: EXPIRADO (já usou)
  if (trial.startedAt && !trial.active) {
    return (
      <div className={`bg-gradient-to-br from-rose-600/15 to-fuchsia-600/10 border border-rose-500/30 rounded-3xl p-5 ${className}`}>
        <div className="flex items-center gap-2 mb-2">
          <Clock className="w-5 h-5 text-rose-300" />
          <p className="font-black text-rose-200">Seu trial de IA acabou</p>
        </div>
        <p className="text-sm text-slate-300 mb-3">
          Você usou {trial.used} de {TRIAL_COTA} chamadas. O trial expirou e a IA está travada de novo —
          mas a campanha não para. <b>Continue com IA ilimitada no Plano Pro.</b>
        </p>
        <Link to="/assinar"
          className="bg-gradient-to-r from-rose-600 to-fuchsia-600 hover:from-rose-500 hover:to-fuchsia-500 rounded-xl px-4 py-2.5 font-bold flex items-center justify-center gap-2 text-white text-sm">
          Continuar com Plano Pro <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  // ESTADO 3: ATIVO
  if (trial.active && trial.until) {
    const _ = tick; // toca a dep do countdown
    const used = trial.used || 0;
    const remaining = Math.max(0, TRIAL_COTA - used);
    const pct = Math.min(100, (used / TRIAL_COTA) * 100);
    return (
      <div className={`bg-gradient-to-br from-emerald-600/20 to-indigo-600/15 border border-emerald-500/40 rounded-3xl p-5 ${className}`}>
        <div className="flex items-center gap-2 mb-2">
          <span className="relative flex">
            <Sparkles className="w-5 h-5 text-emerald-300" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          </span>
          <p className="font-black text-emerald-200">🎯 Trial de IA ATIVO</p>
        </div>
        <p className="text-sm text-slate-300 mb-3">
          Aproveite! Você tem <b className="text-emerald-200">{fmtCountdown(trial.until)}</b> restantes
          e <b className="text-emerald-200">{remaining}/{TRIAL_COTA}</b> chamadas de IA disponíveis.
        </p>
        <div className="bg-black/30 rounded-xl h-2 mb-3 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-emerald-400 to-indigo-400" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px] text-slate-400">
          Use no <b>CRM → Classificar com IA</b> ou <b>IA CRM Insight</b>. Dossiês de adversários liberam no menu Inteligência.
        </p>
      </div>
    );
  }

  // ESTADO 2: ELEGÍVEL — atingiu 300 leads e nunca ativou
  if (trial.eligible) {
    return (
      <div className={`bg-gradient-to-br from-indigo-600/25 to-fuchsia-600/20 border-2 border-indigo-500/50 rounded-3xl p-5 ${className} relative overflow-hidden`}>
        <div className="absolute -top-4 -right-4 opacity-20"><PartyPopper className="w-24 h-24 text-indigo-300" /></div>
        <div className="flex items-center gap-2 mb-2 relative">
          <PartyPopper className="w-6 h-6 text-fuchsia-300" />
          <p className="font-black text-white text-lg">Parabéns! Você liberou 24h de IA grátis</p>
        </div>
        <p className="text-sm text-slate-200 mb-4 relative">
          Você passou de <b>{trial.leadsThreshold} eleitores</b> cadastrados. Como recompensa,
          a gente libera <b className="text-fuchsia-200">24 horas de IA</b> pra você testar:
          {' '}25 classificações + 5 dossiês de adversários. <b>Vale a pena começar agora — o relógio começa quando você ativa.</b>
        </p>
        <button onClick={activate} disabled={activating}
          className="w-full bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 disabled:opacity-50 rounded-xl px-4 py-3 font-bold flex items-center justify-center gap-2 text-white shadow-lg shadow-indigo-600/30 relative">
          {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {activating ? 'Ativando…' : 'Ativar minhas 24h de IA agora'}
        </button>
        {errorMsg && <p className="text-xs text-rose-300 mt-2 relative">{errorMsg}</p>}
      </div>
    );
  }

  // ESTADO 1: PROGRESSO — leads < 300
  const pct = Math.min(100, (trial.leadsCount / trial.leadsThreshold) * 100);
  const faltam = Math.max(0, trial.leadsThreshold - trial.leadsCount);
  return (
    <div className={`bg-[#161b22] border border-white/10 rounded-3xl p-5 ${className}`}>
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-5 h-5 text-indigo-300" />
        <p className="font-bold text-white">Desbloqueie 24h de IA grátis</p>
      </div>
      <p className="text-sm text-slate-400 mb-3">
        Cadastre <b className="text-white">{trial.leadsThreshold} eleitores</b> e a gente libera <b>24 horas de IA</b> pra você testar
        — 25 classificações + 5 dossiês de adversários. Sem cartão.
      </p>
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-1 bg-black/30 rounded-xl h-2 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[11px] font-bold text-slate-300 tabular-nums">{trial.leadsCount}/{trial.leadsThreshold}</span>
      </div>
      <p className="text-[11px] text-slate-500">
        {faltam > 0 ? `Faltam ${faltam} eleitores. Importe um CSV ou cadastre via formulário público.` : 'Pronto! Recarregue a página.'}
      </p>
    </div>
  );
};

export default AiTrialCard;
