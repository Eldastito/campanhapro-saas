/**
 * Modo Campanha Pausada (#137).
 *
 * Toggle global que desliga TODA IA da plataforma: Aurora WhatsApp,
 * Monitor Proativo, Briefing Diário, Secretary IA, gatilhos do
 * orquestrador. Útil em momentos críticos (debate ao vivo, período
 * de silêncio TSE, crise).
 */
import React, { useEffect, useState } from 'react';
import { Pause, Play, AlertTriangle, RefreshCw } from 'lucide-react';
import Card from '../ui/Card';
import { supabase } from '../../lib/supabaseClient';

interface Status {
  paused: boolean;
  pausedAt: string | null;
  pausedBy: string | null;
  pausedReason: string | null;
}

async function authFetch(url: string, init: RequestInit = {}): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const r = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

const CampaignPauseCard: React.FC = () => {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [reason, setReason] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await authFetch('/api/v1/control-panel/status');
      setStatus(r);
    } catch (err) {
      console.error('[pause] load:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = async () => {
    if (!status) return;
    const willPause = !status.paused;
    if (willPause && !confirm(
      'Atenção: ATIVAR modo pausado vai desligar TODA IA da plataforma:\n\n' +
      '• Aurora não responde no WhatsApp\n' +
      '• Monitor Proativo não roda\n' +
      '• Briefing Diário noturno é pulado\n' +
      '• Secretary IA não processa áudios do candidato\n' +
      '• Análises sob demanda são bloqueadas\n\n' +
      'Útil em debates ao vivo, período de silêncio TSE ou crise.\n\nContinuar?'
    )) return;

    setActing(true);
    try {
      await authFetch('/api/v1/control-panel/pause', {
        method: 'POST',
        body: JSON.stringify({ paused: willPause, reason: willPause ? reason.trim() : null }),
      });
      setReason('');
      load();
    } catch (err: any) {
      alert('Falha: ' + (err?.message || 'erro'));
    } finally {
      setActing(false);
    }
  };

  if (loading || !status) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-xs text-slate-500 py-3">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Carregando status...
        </div>
      </Card>
    );
  }

  if (status.paused) {
    return (
      <Card className="border-l-4 border-l-red-500 bg-red-500/5">
        <div className="flex items-start gap-3 mb-3">
          <AlertTriangle className="w-6 h-6 text-red-400 shrink-0" />
          <div className="flex-1">
            <h3 className="text-base font-bold text-red-300 uppercase tracking-wider mb-1">
              ⚠️ Modo Campanha Pausada ATIVO
            </h3>
            <p className="text-sm text-red-200/90">
              Nenhuma IA está respondendo. Aurora, Monitor, Briefing, Secretary — tudo desligado.
            </p>
            {status.pausedReason && (
              <p className="text-xs text-red-200/70 mt-2 italic">
                Motivo: "{status.pausedReason}"
              </p>
            )}
            {status.pausedAt && (
              <p className="text-[10px] text-red-200/60 mt-1">
                Pausada em {new Date(status.pausedAt).toLocaleString('pt-BR')}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={acting}
          className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all"
        >
          <Play className="w-4 h-4" />
          {acting ? 'Retomando...' : 'Retomar IA da Campanha'}
        </button>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Pause className="w-5 h-5 text-amber-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Modo Campanha Pausada</h3>
        </div>
        <span className="text-[10px] text-emerald-400 font-bold">🟢 IA ATIVA</span>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Botão de pânico que desliga TODA a IA com 1 clique. Use em:
        debate ao vivo, período de silêncio TSE, crise de comunicação.
      </p>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo (opcional, ex: 'debate ao vivo')"
        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm mb-3 placeholder:text-slate-600"
      />
      <button
        onClick={toggle}
        disabled={acting}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all"
      >
        <Pause className="w-4 h-4" />
        {acting ? 'Pausando...' : 'Pausar IA da Campanha'}
      </button>
    </Card>
  );
};

export default CampaignPauseCard;
