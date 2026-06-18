/**
 * ROI por Membro da Equipe (#138).
 *
 * Cruza custo mensal de cada membro (team_members.cost) com produção
 * (visitas, apoiadores, follow-ups convertidos) e mostra:
 *   - Custo por apoiador equivalente
 *   - Custo por voto
 *   - ROI Score (apoiadores por R$ 1000)
 *
 * Permite decisão financeira clara: quem promover, quem reorientar.
 */
import React, { useEffect, useState } from 'react';
import { DollarSign, TrendingUp, Award, AlertTriangle, RefreshCw, ArrowUp } from 'lucide-react';
import Card from '../ui/Card';
import { supabase } from '../../lib/supabaseClient';

interface MemberROI {
  name: string;
  id: string | null;
  role: string | null;
  costMensal: number | null;
  visitas: number;
  apoiadores: number;
  votos: number;
  followupsConvertidos: number;
  custoNoPeriodo: number;
  totalApoiadoresEquivalente: number;
  custoPorApoiador: number | null;
  custoPorVoto: number | null;
  roiScore: number | null;
}

interface Totals {
  custo: number;
  apoiadoresEquivalentes: number;
  votos: number;
  custoPorApoiador: number | null;
  custoPorVoto: number | null;
}

type SortBy = 'roi' | 'custo' | 'apoiadores' | 'votos';

async function authFetch(url: string): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${session?.access_token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

const fmtBRL = (v: number | null) => v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

interface TeamROIPanelProps {
  /** Quando passado, oculta o seletor interno e usa esse valor. */
  daysProp?: number;
}

const TeamROIPanel: React.FC<TeamROIPanelProps> = ({ daysProp }) => {
  const [daysLocal, setDaysLocal] = useState<30 | 60 | 90 | 180>(30);
  const days = daysProp ?? daysLocal;
  const [members, setMembers] = useState<MemberROI[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortBy>('roi');

  const load = async () => {
    setLoading(true);
    try {
      const r = await authFetch(`/api/v1/field-ops/team-roi?days=${days}`);
      setMembers(r.members || []);
      setTotals(r.totals || null);
    } catch (err) {
      console.error('[team-roi]', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [days]);

  const sorted = [...members].sort((a, b) => {
    if (sortBy === 'roi') {
      if (a.roiScore == null && b.roiScore == null) return b.visitas - a.visitas;
      if (a.roiScore == null) return 1;
      if (b.roiScore == null) return -1;
      return b.roiScore - a.roiScore;
    }
    if (sortBy === 'custo') return b.custoNoPeriodo - a.custoNoPeriodo;
    if (sortBy === 'apoiadores') return b.totalApoiadoresEquivalente - a.totalApoiadoresEquivalente;
    return b.votos - a.votos;
  });

  // Identifica top/bottom 3 com ROI calculado
  const withRoi = sorted.filter(m => m.roiScore != null);
  const topIds = new Set(withRoi.slice(0, 3).map(m => m.name));
  const bottomIds = new Set(withRoi.slice(-3).filter(m => m.visitas > 0).map(m => m.name));

  return (
    <Card className="border-l-4 border-l-emerald-500">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-emerald-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">ROI por Membro</h3>
        </div>
        <div className="flex items-center gap-2">
          {daysProp === undefined && (
            <select value={daysLocal} onChange={(e) => setDaysLocal(Number(e.target.value) as any)}
                    className="bg-slate-800 border border-slate-700 rounded text-xs text-white px-2 py-1">
              <option value={30}>30 dias</option>
              <option value={60}>60 dias</option>
              <option value={90}>90 dias</option>
              <option value={180}>6 meses</option>
            </select>
          )}
          <button onClick={load} className="p-1.5 hover:bg-slate-800 rounded text-slate-400">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 mb-3">
        Custo mensal × produção. <b>Apoiador equivalente</b> = apoiadores convertidos em visitas + follow-ups convertidos × 1,5.
      </p>

      {/* Totais da campanha */}
      {totals && (
        <div className="grid grid-cols-4 gap-2 mb-4">
          <KPI label="Custo total" value={fmtBRL(totals.custo)} />
          <KPI label="Apoiadores eq." value={String(totals.apoiadoresEquivalentes)} />
          <KPI label="Custo/apoiador" value={fmtBRL(totals.custoPorApoiador)} />
          <KPI label="Custo/voto" value={fmtBRL(totals.custoPorVoto)} />
        </div>
      )}

      {/* Sort */}
      <div className="flex gap-1 mb-2 border-b border-slate-800">
        <SortBtn active={sortBy === 'roi'} onClick={() => setSortBy('roi')} icon={<TrendingUp className="w-3 h-3" />} label="ROI" />
        <SortBtn active={sortBy === 'custo'} onClick={() => setSortBy('custo')} icon={<DollarSign className="w-3 h-3" />} label="Custo" />
        <SortBtn active={sortBy === 'apoiadores'} onClick={() => setSortBy('apoiadores')} icon={<Award className="w-3 h-3" />} label="Apoiadores" />
        <SortBtn active={sortBy === 'votos'} onClick={() => setSortBy('votos')} icon={<ArrowUp className="w-3 h-3" />} label="Votos" />
      </div>

      {loading && members.length === 0 ? (
        <p className="text-xs text-slate-500 italic py-6 text-center">Carregando ROI...</p>
      ) : members.length === 0 ? (
        <p className="text-xs text-slate-500 italic py-6 text-center">Sem dados de equipe ainda. Cadastre membros + registre visitas pra ver ROI.</p>
      ) : (
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {sorted.map(m => {
            const isTop = topIds.has(m.name);
            const isBottom = bottomIds.has(m.name);
            const noCost = m.costMensal == null || m.costMensal === 0;
            const noActivity = m.visitas === 0 && m.followupsConvertidos === 0;
            return (
              <div key={m.name} className={`p-2.5 rounded-lg border ${
                isTop ? 'bg-emerald-500/5 border-emerald-500/30' :
                isBottom ? 'bg-amber-500/5 border-amber-500/30' :
                'bg-slate-900/60 border-slate-800'
              }`}>
                <div className="flex items-center gap-2 mb-1.5">
                  {isTop && <span className="text-xs">🏆</span>}
                  {isBottom && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                  <span className="text-sm font-bold text-white flex-1 truncate">{m.name}</span>
                  {m.role && <span className="text-[9px] text-slate-500 uppercase tracking-wide">{m.role}</span>}
                  {m.roiScore != null && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      isTop ? 'bg-emerald-500/30 text-emerald-300' :
                      isBottom ? 'bg-amber-500/30 text-amber-300' :
                      'bg-slate-700 text-slate-300'
                    }`}>
                      ROI {m.roiScore}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <Cell label="Custo período" value={fmtBRL(m.custoNoPeriodo)} muted={noCost} />
                  <Cell label="Visitas" value={String(m.visitas)} muted={noActivity} />
                  <Cell label="Apoiadores eq." value={String(m.totalApoiadoresEquivalente)} muted={noActivity} />
                  <Cell label="R$/apoiador" value={fmtBRL(m.custoPorApoiador)} muted={m.custoPorApoiador == null} />
                </div>
                {noCost && (
                  <p className="text-[10px] text-slate-500 italic mt-1">
                    💡 Sem custo cadastrado — preencha o campo "Custo mensal" no cadastro pra calcular ROI.
                  </p>
                )}
                {!noCost && noActivity && (
                  <p className="text-[10px] text-amber-300 italic mt-1">
                    ⚠️ Está custando mas sem produção registrada no período.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-slate-500 italic mt-3">
        💡 ROI Score = apoiadores equivalentes por R$ 1.000 gastos. Maior = melhor.
      </p>
    </Card>
  );
};

const KPI: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-slate-900/60 rounded-lg p-2 border border-slate-800">
    <p className="text-[9px] text-slate-500 uppercase tracking-widest">{label}</p>
    <p className="text-base font-bold text-white">{value}</p>
  </div>
);

const Cell: React.FC<{ label: string; value: string; muted?: boolean }> = ({ label, value, muted }) => (
  <div>
    <p className="text-[9px] text-slate-500">{label}</p>
    <p className={`font-semibold ${muted ? 'text-slate-600' : 'text-slate-200'}`}>{value}</p>
  </div>
);

const SortBtn: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold ${active ? 'text-white border-b-2 border-emerald-500' : 'text-slate-500 hover:text-slate-300'}`}
  >
    {icon}{label}
  </button>
);

export default TeamROIPanel;
