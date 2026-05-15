import * as React from 'react';
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

// Componente de Gráfico de Barras SVG Moderno e Animado
const AnimatedBarChart = ({ data }: { data: { date: string; visits: number; votes: number }[] }) => {
    const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
    const [tooltipPos, setTooltipPos] = React.useState({ x: 0, y: 0 });
    
    const chartHeight = 350;
    const chartWidth = 800;
    const padding = { top: 60, right: 30, bottom: 50, left: 50 };
    
    const maxVisits = Math.max(...data.map(d => d.visits), 0);
    const maxVotes = Math.max(...data.map(d => d.votes), 0);
    const yMax = Math.max(maxVisits, maxVotes, 5);
    
    const yScale = (value: number) => chartHeight - padding.bottom - (value / yMax) * (chartHeight - padding.top - padding.bottom);
    const spacing = (chartWidth - padding.left - padding.right) / data.length;
    const barWidth = Math.min(spacing * 0.35, 35);

    const handleMouseMove = (e: React.MouseEvent, index: number) => {
        const svg = e.currentTarget.closest('svg');
        if (svg) {
            const pt = svg.createSVGPoint();
            pt.x = e.clientX;
            pt.y = e.clientY;
            const cursorPt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
            setTooltipPos({ x: cursorPt.x, y: cursorPt.y });
            setHoveredIndex(index);
        }
    };

    return (
        <div className="relative w-full overflow-hidden">
            <div className="h-[350px] w-full overflow-x-auto custom-scrollbar">
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" className="min-w-[800px] select-none">
                    <defs>
                        <linearGradient id="gradVisits" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#60a5fa" />
                            <stop offset="100%" stopColor="#2563eb" />
                        </linearGradient>
                        <linearGradient id="gradVotes" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#34d399" />
                            <stop offset="100%" stopColor="#059669" />
                        </linearGradient>
                        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                            <feGaussianBlur stdDeviation="3" result="blur" />
                            <feComposite in="SourceGraphic" in2="blur" operator="over" />
                        </filter>
                    </defs>

                    {/* Linhas de Grade e Eixo Y */}
                    {Array.from({ length: 6 }).map((_, i) => {
                        const y = padding.top + i * ((chartHeight - padding.top - padding.bottom) / 5);
                        const value = Math.round(yMax * (1 - i / 5));
                        return (
                            <g key={i}>
                                <line x1={padding.left} y1={y} x2={chartWidth - padding.right} y2={y} stroke="#334155" strokeDasharray="3 6" strokeWidth="0.5" />
                                <text x={padding.left - 15} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="11" fontWeight="bold">{value}</text>
                            </g>
                        )
                    })}

                    {/* Barras Interativas */}
                    {data.map((d, i) => {
                        const x = padding.left + (i + 0.5) * spacing;
                        const hVisits = chartHeight - padding.bottom - yScale(d.visits);
                        const hVotes = chartHeight - padding.bottom - yScale(d.votes);
                        const isHovered = hoveredIndex === i;
                        
                        return (
                            <g key={d.date} 
                               onMouseMove={(e) => handleMouseMove(e, i)}
                               onMouseLeave={() => setHoveredIndex(null)}
                               className="transition-all duration-300"
                            >
                                {/* Background Highlight */}
                                {isHovered && (
                                    <rect x={x - spacing/2} y={padding.top - 10} width={spacing} height={chartHeight - padding.top - padding.bottom + 20} fill="#334155" fillOpacity="0.2" rx="8" />
                                )}

                                {/* Barra Visitas */}
                                <rect
                                    x={x - barWidth - 3}
                                    y={yScale(d.visits)}
                                    width={barWidth}
                                    height={hVisits}
                                    fill="url(#gradVisits)"
                                    rx="6"
                                    className="transition-all duration-500"
                                    style={{ filter: isHovered ? 'url(#glow)' : 'none' }}
                                >
                                    <animate attributeName="height" from="0" to={hVisits} dur={`${0.5 + i * 0.05}s`} fill="freeze" calcMode="spline" keySplines="0.42 0 0.58 1" />
                                    <animate attributeName="y" from={chartHeight - padding.bottom} to={yScale(d.visits)} dur={`${0.5 + i * 0.05}s`} fill="freeze" calcMode="spline" keySplines="0.42 0 0.58 1" />
                                </rect>

                                {/* Barra Votos */}
                                <rect
                                    x={x + 3}
                                    y={yScale(d.votes)}
                                    width={barWidth}
                                    height={hVotes}
                                    fill="url(#gradVotes)"
                                    rx="6"
                                    className="transition-all duration-500"
                                    style={{ filter: isHovered ? 'url(#glow)' : 'none' }}
                                >
                                    <animate attributeName="height" from="0" to={hVotes} dur={`${0.7 + i * 0.05}s`} fill="freeze" calcMode="spline" keySplines="0.42 0 0.58 1" />
                                    <animate attributeName="y" from={chartHeight - padding.bottom} to={yScale(d.votes)} dur={`${0.7 + i * 0.05}s`} fill="freeze" calcMode="spline" keySplines="0.42 0 0.58 1" />
                                </rect>

                                 <text x={x} y={chartHeight - padding.bottom + 25} textAnchor="middle" fill={isHovered ? "#f8fafc" : "#64748b"} fontSize="11" fontWeight={isHovered ? "bold" : "600"} className="transition-colors">
                                    {new Date(d.date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                </text>
                            </g>
                        )
                    })}
                    
                    {/* Linha de base */}
                    <line x1={padding.left} y1={chartHeight - padding.bottom} x2={chartWidth - padding.right} y2={chartHeight - padding.bottom} stroke="#475569" strokeWidth="2" strokeLinecap="round" />
                </svg>

                {/* Tooltip Customizado (Floating HTML) */}
                {hoveredIndex !== null && (
                    <div 
                        className="pointer-events-none absolute z-50 bg-slate-900/95 border border-slate-700 p-3 rounded-xl shadow-2xl backdrop-blur-md min-w-[140px]"
                        style={{ 
                            left: Math.min(tooltipPos.x + 20, chartWidth - 160), 
                            top: Math.min(tooltipPos.y - 80, chartHeight - 100),
                            transform: 'translateY(-50%)'
                        }}
                    >
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                            {new Date(data[hoveredIndex].date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}
                        </p>
                        <div className="space-y-1">
                            <div className="flex justify-between items-center gap-4">
                                <span className="flex items-center gap-1.5 text-sm text-slate-300">
                                    <div className="w-2 h-2 rounded-full bg-blue-500"></div> Visitas
                                </span>
                                <span className="text-sm font-black text-white">{data[hoveredIndex].visits}</span>
                            </div>
                            <div className="flex justify-between items-center gap-4">
                                <span className="flex items-center gap-1.5 text-sm text-slate-300">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div> Votos
                                </span>
                                <span className="text-sm font-black text-white">{data[hoveredIndex].votes}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

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
                <AnimatedBarChart data={chartData} />
            ) : (
                <div className="h-80 flex items-center justify-center text-slate-400">
                    <p>Sem dados de visitas realizadas para exibir o gráfico.</p>
                </div>
            )}
        </Card>
    );
};

export default ProgressChart;