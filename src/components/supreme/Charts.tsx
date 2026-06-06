import * as React from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

/**
 * Gráficos modernos reutilizáveis para o Supreme Admin: gradientes vivos
 * (two-tone), glow neon, barras arredondadas com "trilho" de fundo,
 * linha de área curva e espessa com pontos brilhantes, animação de entrada
 * e tooltip com vidro fosco. Ids únicos por instância evitam colisão de
 * <defs> quando há vários gráficos no mesmo DOM.
 */

const slug = (s: string) => s.replace(/[^a-z0-9]/gi, '').slice(0, 24);

/** Clareia/escurece um hex pra montar gradientes two-tone. */
function shade(hex: string, pct: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r + (pct / 100) * 255)));
  g = Math.max(0, Math.min(255, Math.round(g + (pct / 100) * 255)));
  b = Math.max(0, Math.min(255, Math.round(b + (pct / 100) * 255)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

const ModernTooltip = ({ active, payload, label, unit }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(15,23,42,0.85)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: 12,
      padding: '10px 14px',
      backdropFilter: 'blur(12px)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    }}>
      {label !== undefined && <p style={{ color: '#94a3b8', fontSize: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>{label}{unit ?? ''}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color || p.fill || '#e2e8f0', fontSize: 16, fontWeight: 800, fontFamily: 'monospace' }}>
          {Number(p.value).toLocaleString('pt-BR')}
        </p>
      ))}
    </div>
  );
};

interface AreaProps { data: any[]; xKey: string; dataKey: string; color?: string; }

export const ModernArea: React.FC<AreaProps> = ({ data, xKey, dataKey, color = '#34d399' }) => {
  const id = slug(dataKey + color);
  const light = shade(color, 25);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 16, right: 12, left: -6, bottom: 0 }}>
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={light} stopOpacity={0.75} />
            <stop offset="45%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id={`stroke-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={light} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
          <filter id={`glow-${id}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <CartesianGrid strokeDasharray="4 6" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} dy={6} />
        <YAxis tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} width={30} />
        <Tooltip content={<ModernTooltip />} cursor={{ stroke: color, strokeOpacity: 0.25, strokeWidth: 2 }} />
        <Area
          type="monotone" dataKey={dataKey}
          stroke={`url(#stroke-${id})`} strokeWidth={3.5} strokeLinecap="round"
          fill={`url(#fill-${id})`} filter={`url(#glow-${id})`}
          dot={false}
          activeDot={{ r: 6, fill: color, stroke: '#fff', strokeWidth: 2, filter: `url(#glow-${id})` }}
          isAnimationActive animationDuration={1100} animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

interface BarProps {
  data: any[]; xKey: string; dataKey: string; color?: string;
  palette?: string[]; horizontal?: boolean; unit?: string; yWidth?: number;
}

const DEFAULT_PALETTE = ['#818cf8', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#a78bfa', '#fb7185', '#4ade80'];

export const ModernBar: React.FC<BarProps> = ({
  data, xKey, dataKey, color = '#818cf8', palette, horizontal = false, unit, yWidth = 30,
}) => {
  const id = slug(dataKey + color);
  const pal = palette ?? null;
  const grad = (c: string, key: string) => (
    <linearGradient key={key} id={key} x1="0" y1="0" x2={horizontal ? '1' : '0'} y2={horizontal ? '0' : '1'}>
      <stop offset="0%" stopColor={shade(c, 30)} stopOpacity={1} />
      <stop offset="100%" stopColor={c} stopOpacity={0.65} />
    </linearGradient>
  );
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} barCategoryGap={horizontal ? '28%' : '32%'} margin={{ top: 16, right: 14, left: horizontal ? 8 : -6, bottom: 0 }}>
        <defs>
          {grad(color, `bar-${id}`)}
          {(pal ?? DEFAULT_PALETTE).map((c, i) => grad(c, `barp-${id}-${i}`))}
          <filter id={`bglow-${id}`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <CartesianGrid strokeDasharray="4 6" stroke="rgba(255,255,255,0.06)" horizontal={!horizontal} vertical={horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey={xKey} tick={{ fontSize: 10, fill: '#cbd5e1' }} axisLine={false} tickLine={false} width={130} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} unit={unit} dy={6} />
            <YAxis tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} width={yWidth} />
          </>
        )}
        <Tooltip content={<ModernTooltip unit={unit} />} cursor={{ fill: 'rgba(255,255,255,0.05)', radius: 8 }} />
        <Bar
          dataKey={dataKey}
          radius={horizontal ? [0, 10, 10, 0] : [10, 10, 0, 0]}
          maxBarSize={horizontal ? 26 : 46}
          filter={`url(#bglow-${id})`}
          background={{ fill: 'rgba(255,255,255,0.035)', radius: horizontal ? 10 : 10 } as any}
          isAnimationActive animationDuration={1000} animationEasing="ease-out"
        >
          {data.map((_, i) => (
            <Cell key={i} fill={pal ? `url(#barp-${id}-${i % pal.length})` : `url(#bar-${id})`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};
