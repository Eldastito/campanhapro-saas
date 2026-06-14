import * as React from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import Card from '../ui/Card';
import { Visit } from '../../types/visits';

interface ProgressChartProps {
    filteredVisits: Visit[];
    municipioFilter: string;
    setMunicipioFilter: (value: string) => void;
    allMunicipios: string[];
    bairroFilter: string;
    setBairroFilter: (value: string) => void;
    allBairros: string[];
    apoiadorFilter: string;
    setApoiadorFilter: (value: string) => void;
    allApoiadores: string[];
}

/**
 * Tooltip de vidro fosco — igual ao do Supreme (ModernArea/Charts.tsx).
 */
const GlassTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: 'rgba(15,23,42,0.85)',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 12,
            padding: '10px 14px',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            minWidth: 140,
        }}>
            {label && (
                <p style={{ color: '#94a3b8', fontSize: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {new Date(label + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}
                </p>
            )}
            {payload.map((p: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: i > 0 ? 4 : 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cbd5e1', fontSize: 13 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
                        {p.name}
                    </span>
                    <span style={{ color: '#fff', fontWeight: 800, fontFamily: 'monospace' }}>
                        {Number(p.value).toLocaleString('pt-BR')}
                    </span>
                </div>
            ))}
        </div>
    );
};

/**
 * Gráfico de linha com área glow — visual igual ao "Crescimento de Usuários
 * (30d)" do Supreme Control (Charts.tsx ModernArea), mas com 2 séries
 * sobrepostas (Visitas + Votos). Substituiu o gráfico de barras antigo.
 */
const AnimatedAreaChart = ({ data }: { data: { date: string; visits: number; votes: number }[] }) => {
    return (
        <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 16, right: 12, left: -6, bottom: 0 }}>
                    <defs>
                        <linearGradient id="fill-visits" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#93c5fd" stopOpacity={0.75} />
                            <stop offset="45%" stopColor="#3b82f6" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="stroke-visits" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#93c5fd" />
                            <stop offset="100%" stopColor="#3b82f6" />
                        </linearGradient>
                        <linearGradient id="fill-votes" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6ee7b7" stopOpacity={0.65} />
                            <stop offset="45%" stopColor="#10b981" stopOpacity={0.30} />
                            <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="stroke-votes" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#6ee7b7" />
                            <stop offset="100%" stopColor="#10b981" />
                        </linearGradient>
                        <filter id="glow-visits" x="-30%" y="-30%" width="160%" height="160%">
                            <feGaussianBlur stdDeviation="4" result="blur" />
                            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                        </filter>
                        <filter id="glow-votes" x="-30%" y="-30%" width="160%" height="160%">
                            <feGaussianBlur stdDeviation="4" result="blur" />
                            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                        </filter>
                    </defs>
                    <CartesianGrid strokeDasharray="4 6" stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                        dy={6}
                        tickFormatter={(d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                    />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
                    <Tooltip content={<GlassTooltip />} cursor={{ stroke: '#3b82f6', strokeOpacity: 0.25, strokeWidth: 2 }} />
                    <Legend
                        verticalAlign="top"
                        iconType="circle"
                        wrapperStyle={{ paddingBottom: 12 }}
                        formatter={(v: string) => <span style={{ color: '#cbd5e1', fontSize: 12, marginLeft: 4 }}>{v}</span>}
                    />
                    <Area
                        type="monotone"
                        name="Visitas"
                        dataKey="visits"
                        stroke="url(#stroke-visits)"
                        strokeWidth={3.5}
                        strokeLinecap="round"
                        fill="url(#fill-visits)"
                        filter="url(#glow-visits)"
                        dot={false}
                        activeDot={{ r: 6, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2, filter: 'url(#glow-visits)' }}
                        isAnimationActive
                        animationDuration={1100}
                        animationEasing="ease-out"
                    />
                    <Area
                        type="monotone"
                        name="Votos"
                        dataKey="votes"
                        stroke="url(#stroke-votes)"
                        strokeWidth={3.5}
                        strokeLinecap="round"
                        fill="url(#fill-votes)"
                        filter="url(#glow-votes)"
                        dot={false}
                        activeDot={{ r: 6, fill: '#10b981', stroke: '#fff', strokeWidth: 2, filter: 'url(#glow-votes)' }}
                        isAnimationActive
                        animationDuration={1100}
                        animationEasing="ease-out"
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};


const ProgressChart = ({
    filteredVisits,
    municipioFilter,
    setMunicipioFilter,
    allMunicipios,
    bairroFilter,
    setBairroFilter,
    allBairros,
    apoiadorFilter,
    setApoiadorFilter,
    allApoiadores
}: ProgressChartProps) => {
    const chartData = React.useMemo(() => {
        const dataByDay: { [date: string]: { visits: number; votes: number } } = {};
        filteredVisits.forEach(v => {
          if (v.realizada === 'sim') {
            const dateKey = v.data; // Assumindo formato YYYY-MM-DD
            if (!dataByDay[dateKey]) {
              dataByDay[dateKey] = { visits: 0, votes: 0 };
            }
            dataByDay[dateKey].visits += 1;
            dataByDay[dateKey].votes += v.votos;
          }
        });
        return Object.keys(dataByDay)
          .map(date => ({ date, visits: dataByDay[date].visits, votes: dataByDay[date].votes }))
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      }, [filteredVisits]);

    return (
        <Card className="print-break-inside-avoid">
            <h3 className="font-bold text-lg text-slate-300 mb-4">Progresso (Visitas e Votos / Dia)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 no-print">
                <select value={municipioFilter} onChange={e => { setMunicipioFilter(e.target.value); setBairroFilter(''); }} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                    <option value="">Todos os Municípios</option>
                    {allMunicipios.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <select value={bairroFilter} onChange={e => setBairroFilter(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                    <option value="">Todos os Bairros</option>
                    {allBairros.map(b => <option key={`${municipioFilter}-${b}`} value={b}>{b}</option>)}
                </select>
                <select value={apoiadorFilter} onChange={e => setApoiadorFilter(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                    <option value="">Todos os Apoiadores</option>
                    {allApoiadores.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
            </div>
            
            <div className="flex items-center gap-4 text-sm mb-4">
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-sky-500 rounded-sm"></div><span>Visitas</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-teal-500 rounded-sm"></div><span>Votos</span></div>
            </div>

            {chartData.length > 0 ? (
                <AnimatedAreaChart data={chartData} />
            ) : (
                <div className="h-80 flex items-center justify-center text-slate-400">
                    <p>Sem dados de visitas realizadas para exibir o gráfico.</p>
                </div>
            )}
        </Card>
    );
};

export default ProgressChart;