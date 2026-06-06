import * as React from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

/**
 * Gráficos modernos reutilizáveis para o Supreme Admin: fills em gradiente,
 * efeito glow (brilho neon), cantos arredondados, animação de entrada suave
 * e tooltip com blur. Cada gráfico recebe uma cor e gera ids únicos pros
 * <defs> (evita colisão de gradiente quando há vários no mesmo DOM).
 */

const slug = (s: string) => s.replace(/[^a-z0-9]/gi, '').slice(0, 24);

const ModernTooltip = ({ active, payload, label, unit }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(15,23,42,0.92)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 10,
      padding: '8px 12px',
      backdropFilter: 'blur(8px)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    }}>
      {label !== undefined && <p style={{ color: '#94a3b8', fontSize: 10, marginBottom: 4 }}>{label}{unit ?? ''}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color || p.fill || '#e2e8f0', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>
          {Number(p.value).toLocaleString('pt-BR')}
        </p>
      ))}
    </div>
  );
};

interface AreaProps {
  data: any[];
  xKey: string;
  dataKey: string;
  color?: string;
}

export const ModernArea: React.FC<AreaProps> = ({ data, xKey, dataKey, color = '#34d399' }) => {
  const id = slug(dataKey + color);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 10, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.55} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
          <filter id={`glow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
        <Tooltip content={<ModernTooltip />} cursor={{ stroke: color, strokeOpacity: 0.2 }} />
        <Area
          type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5}
          fill={`url(#fill-${id})`} filter={`url(#glow-${id})`}
          dot={false} activeDot={{ r: 4, fill: color, stroke: '#0f172a', strokeWidth: 2 }}
          isAnimationActive animationDuration={900} animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

interface BarProps {
  data: any[];
  xKey: string;
  dataKey: string;
  color?: string;
  /** Gradiente multicolor por barra (paleta) em vez de cor única. */
  palette?: string[];
  horizontal?: boolean;
  unit?: string;
  yWidth?: number;
}

const DEFAULT_PALETTE = ['#6366f1', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#a78bfa', '#fb7185', '#4ade80'];

export const ModernBar: React.FC<BarProps> = ({
  data, xKey, dataKey, color = '#6366f1', palette, horizontal = false, unit, yWidth = 28,
}) => {
  const id = slug(dataKey + color);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 10, right: 12, left: horizontal ? 8 : -8, bottom: 0 }}>
        <defs>
          <linearGradient id={`bar-${id}`} x1="0" y1="0" x2={horizontal ? '1' : '0'} y2={horizontal ? '0' : '1'}>
            <stop offset="0%" stopColor={color} stopOpacity={1} />
            <stop offset="100%" stopColor={color} stopOpacity={0.45} />
          </linearGradient>
          {(palette ?? DEFAULT_PALETTE).map((c, i) => (
            <linearGradient key={i} id={`barp-${id}-${i}`} x1="0" y1="0" x2={horizontal ? '1' : '0'} y2={horizontal ? '0' : '1'}>
              <stop offset="0%" stopColor={c} stopOpacity={1} />
              <stop offset="100%" stopColor={c} stopOpacity={0.45} />
            </linearGradient>
          ))}
          <filter id={`bglow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={!horizontal} vertical={horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey={xKey} tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={120} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} unit={unit} />
            <YAxis tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} width={yWidth} />
          </>
        )}
        <Tooltip content={<ModernTooltip unit={unit} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar
          dataKey={dataKey}
          radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]}
          filter={`url(#bglow-${id})`}
          isAnimationActive animationDuration={900} animationEasing="ease-out"
        >
          {palette
            ? data.map((_, i) => <Cell key={i} fill={`url(#barp-${id}-${i % (palette ?? DEFAULT_PALETTE).length})`} />)
            : data.map((_, i) => <Cell key={i} fill={`url(#bar-${id})`} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};
