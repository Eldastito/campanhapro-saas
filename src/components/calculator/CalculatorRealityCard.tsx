/**
 * Card "Realidade" — mostra performance real (vinda de visits) vs o cenário
 * planejado pelo usuário. Cores 🟢🟡🔴 por gap (#134).
 */
import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, RefreshCw, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import Card from '../ui/Card';
import { supabase } from '../../lib/supabaseClient';

interface RealityData {
  total: number;
  realizadas: number;
  vpfReal: number | null;
  capacidadeDiaMedia: number | null;
  conversaoTaxa: number | null;
  apoiadoresCount: number;
  diasAtivos: number;
  bairros: {
    top5: Array<{ bairro: string; visitas: number; votos: number; vpf: number }>;
    bottom5: Array<{ bairro: string; visitas: number; votos: number; vpf: number }>;
    totalAnalisados: number;
  };
  elegivelParaAnalise: boolean;
  minVisitas: number;
  atualizadoEm: string;
}

interface CalcState {
  vpf: number;
  cap: number;
  meta: number;
}

async function authGet(url: string): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${session?.access_token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

function gapPct(real: number | null, planned: number): { delta: number; cls: string; icon: React.ReactNode } | null {
  if (real == null || !planned) return null;
  const delta = ((real - planned) / planned) * 100;
  const abs = Math.abs(delta);
  let cls = 'text-emerald-400';
  let icon: React.ReactNode = <Minus className="w-3 h-3" />;
  if (abs >= 30) { cls = 'text-red-400'; icon = delta < 0 ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />; }
  else if (abs >= 10) { cls = 'text-amber-400'; icon = delta < 0 ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />; }
  return { delta, cls, icon };
}

const CalculatorRealityCard: React.FC<{ planned: CalcState }> = ({ planned }) => {
  const [data, setData] = useState<RealityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await authGet('/api/v1/calculator/reality');
      setData(r);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000); // polling 1min
    return () => clearInterval(t);
  }, []);

  return (
    <Card className="border-l-4 border-l-blue-500/40">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Realidade (dados de campo)</h3>
        </div>
        <button onClick={load} className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {err ? (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          Erro ao carregar: {err}
        </div>
      ) : loading && !data ? (
        <p className="text-xs text-slate-500 py-4 italic">Carregando dados das visitas...</p>
      ) : !data || data.realizadas === 0 ? (
        <div className="text-xs text-slate-400 bg-slate-800/60 rounded-lg p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Nenhuma visita realizada registrada ainda. A IA precisa de pelo menos {data?.minVisitas ?? 20} visitas pra recomendar ajustes.</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <KPI
              label="Votos/família real"
              value={data.vpfReal != null ? data.vpfReal.toFixed(1) : '—'}
              gap={gapPct(data.vpfReal, planned.vpf)}
              suffix={`vs ${planned.vpf} plan.`}
            />
            <KPI
              label="Capacidade/dia"
              value={data.capacidadeDiaMedia != null ? String(data.capacidadeDiaMedia) : '—'}
              gap={gapPct(data.capacidadeDiaMedia, planned.cap)}
              suffix={`vs ${planned.cap} plan.`}
            />
            <KPI
              label="Conversão (apoiadores)"
              value={data.conversaoTaxa != null ? `${(data.conversaoTaxa * 100).toFixed(0)}%` : '—'}
              suffix={`${data.apoiadoresCount} apoiadores`}
            />
            <KPI
              label="Visitas realizadas"
              value={String(data.realizadas)}
              suffix={`em ${data.diasAtivos} dia(s)`}
            />
          </div>

          {data.bairros.totalAnalisados > 0 && (
            <div className="space-y-2 mb-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Bairros com melhor desempenho</p>
              {data.bairros.top5.slice(0, 3).map(b => (
                <div key={b.bairro} className="flex justify-between text-[11px] text-slate-300">
                  <span>🟢 {b.bairro}</span>
                  <span className="text-emerald-300 font-mono">{b.vpf} vpf · {b.visitas} visitas</span>
                </div>
              ))}
              {data.bairros.bottom5.length > 0 && data.bairros.bottom5[0].vpf < planned.vpf * 0.7 && (
                <>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-3">Atenção (vpf abaixo de 70% do plano)</p>
                  {data.bairros.bottom5.slice(0, 3).map(b => (
                    <div key={b.bairro} className="flex justify-between text-[11px] text-slate-300">
                      <span>🔴 {b.bairro}</span>
                      <span className="text-red-300 font-mono">{b.vpf} vpf · {b.visitas} visitas</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          <p className="text-[9px] text-slate-500 italic mt-2">
            Atualizado {new Date(data.atualizadoEm).toLocaleTimeString('pt-BR')} · auto-refresh 60s
          </p>
        </>
      )}
    </Card>
  );
};

const KPI: React.FC<{
  label: string;
  value: string;
  gap?: { delta: number; cls: string; icon: React.ReactNode } | null;
  suffix?: string;
}> = ({ label, value, gap, suffix }) => (
  <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800">
    <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">{label}</p>
    <div className="flex items-baseline gap-1.5">
      <span className="text-xl font-bold text-white">{value}</span>
      {gap && (
        <span className={`flex items-center gap-0.5 text-[10px] font-bold ${gap.cls}`}>
          {gap.icon}
          {gap.delta > 0 ? '+' : ''}{gap.delta.toFixed(0)}%
        </span>
      )}
    </div>
    {suffix && <p className="text-[10px] text-slate-500 mt-0.5">{suffix}</p>}
  </div>
);

export default CalculatorRealityCard;
