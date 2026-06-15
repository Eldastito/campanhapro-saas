/**
 * Ranking de Líderes de Campo (#135).
 *
 * Mostra os 10 melhores líderes por VOLUME, CONVERSÃO e VPF nos últimos
 * 7/30 dias. Visível pro Admin/Coordenador motivar equipe.
 */
import React, { useEffect, useState } from 'react';
import { Trophy, RefreshCw, TrendingUp, Users, Target } from 'lucide-react';
import Card from '../ui/Card';
import { supabase } from '../../lib/supabaseClient';

interface RankingEntry {
  lider: string;
  leaderId: string | null;
  visitas: number;
  apoiadores: number;
  conversao: number;
  vpf: number;
  votos: number;
}

async function authFetch(url: string): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${session?.access_token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

const VisitsLeaderRanking: React.FC = () => {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [tab, setTab] = useState<'volume' | 'conversao' | 'vpf'>('volume');
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    authFetch(`/api/v1/field-ops/leader-ranking?days=${days}`)
      .then(r => setRanking(r.ranking || []))
      .catch(() => setRanking([]))
      .finally(() => setLoading(false));
  }, [days]);

  const sorted = [...ranking].sort((a, b) => {
    if (tab === 'volume') return b.visitas - a.visitas;
    if (tab === 'conversao') return b.conversao - a.conversao;
    return b.vpf - a.vpf;
  }).slice(0, 10);

  const medalEmoji = (i: number) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`;

  return (
    <Card className="border-l-4 border-l-amber-500">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Ranking de Líderes</h3>
        </div>
        <div className="flex gap-1 text-[10px]">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d as any)}
              className={`px-2 py-1 rounded ${days === d ? 'bg-amber-500/20 text-amber-300' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Tab por métrica */}
      <div className="flex gap-1 mb-3 border-b border-slate-800">
        <TabBtn active={tab === 'volume'} onClick={() => setTab('volume')} icon={<Users className="w-3 h-3" />} label="Volume" />
        <TabBtn active={tab === 'conversao'} onClick={() => setTab('conversao')} icon={<TrendingUp className="w-3 h-3" />} label="Conversão" />
        <TabBtn active={tab === 'vpf'} onClick={() => setTab('vpf')} icon={<Target className="w-3 h-3" />} label="Votos/família" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-slate-500 italic py-6 text-center">
          Sem dados nos últimos {days} dias. Mínimo 3 visitas por líder pra entrar no ranking.
        </p>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((l, i) => {
            const value =
              tab === 'volume' ? `${l.visitas} visitas` :
              tab === 'conversao' ? `${l.conversao}%` :
              `${l.vpf} vpf`;
            return (
              <div key={`${l.leaderId}-${l.lider}`} className="flex items-center gap-3 bg-slate-900/60 rounded-lg p-2.5 border border-slate-800">
                <span className="text-lg w-8 text-center">{medalEmoji(i)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-bold truncate">{l.lider}</p>
                  <p className="text-[10px] text-slate-500">
                    {l.visitas} visitas · {l.apoiadores} apoiadores · {l.vpf} vpf
                  </p>
                </div>
                <span className="text-base font-bold text-amber-300">{value}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

const TabBtn: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1 px-3 py-2 text-[11px] font-semibold ${active ? 'text-white border-b-2 border-amber-500' : 'text-slate-500 hover:text-slate-300'}`}
  >
    {icon}{label}
  </button>
);

export default VisitsLeaderRanking;
