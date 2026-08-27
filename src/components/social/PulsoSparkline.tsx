/**
 * PulsoSparkline — mini gráfico inline SVG mostrando o volume diário de
 * signals nos últimos N dias. Consome `byDay` do endpoint /signals/stats
 * (PR 31).
 *
 * Sem library externa (Recharts/Chart.js): SVG puro. O footprint é
 * minúsculo e o Tailwind dá cor e escala responsiva.
 *
 * DESIGN:
 *   - Barras verticais empilhadas por severity (crisis no topo pra ficar
 *     visualmente óbvio quando presente)
 *   - Cores fixas alinhadas com o resto do Pulso Digital (red/orange/
 *     amber/slate)
 *   - Eixo Y implícito (sem números — é radar, não relatório)
 *   - Altura fixa 40px pra caber em qualquer card
 *   - Tooltip nativo via `<title>` no elemento (SVG accessibility)
 *
 * REGRA §45 aplicada: se TODAS as barras são zero, componente retorna
 * null (deixa o consumer mostrar o estado vazio dele, não empurra um
 * gráfico "zero" que sugere calmaria).
 */

import * as React from 'react';

export interface SparklineDayBucket {
  date: string;
  total: number;
  crisis: number;
  risk: number;
  attention: number;
  info: number;
}

interface PulsoSparklineProps {
  buckets: SparklineDayBucket[];
  height?: number;
  /** Aria-label do gráfico completo pra screen readers. */
  ariaLabel?: string;
}

const COLOR = {
  crisis: '#ef4444',
  risk: '#f97316',
  attention: '#f59e0b',
  info: '#94a3b8',
} as const;

const PulsoSparkline: React.FC<PulsoSparklineProps> = ({
  buckets,
  height = 40,
  ariaLabel = 'Volume diário de sinais por severidade',
}) => {
  // §45: nada pra mostrar → não renderiza
  const anyNonZero = buckets.some(b => b.total > 0);
  if (!anyNonZero || buckets.length === 0) return null;

  const max = buckets.reduce((m, b) => Math.max(m, b.total), 0);
  // Larguras responsivas via viewBox — height fixo em px pra layout previsível
  const barWidth = 10; // unidade viewBox
  const gap = 2;
  const totalWidth = buckets.length * (barWidth + gap) - gap;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${totalWidth} 100`}
      preserveAspectRatio="none"
      style={{ height, width: '100%' }}
      className="mt-2"
    >
      {buckets.map((b, i) => {
        const x = i * (barWidth + gap);
        // Empilha: info na base, crisis no topo. Altura proporcional ao max.
        const totalH = max > 0 ? (b.total / max) * 100 : 0;
        const iH = max > 0 ? (b.info / max) * 100 : 0;
        const aH = max > 0 ? (b.attention / max) * 100 : 0;
        const rH = max > 0 ? (b.risk / max) * 100 : 0;
        const cH = max > 0 ? (b.crisis / max) * 100 : 0;

        // baseY é o piso do bloco atual (100 = base do viewBox)
        let baseY = 100;
        const segments: Array<{ color: string; y: number; h: number }> = [];
        if (iH > 0) { baseY -= iH; segments.push({ color: COLOR.info, y: baseY, h: iH }); }
        if (aH > 0) { baseY -= aH; segments.push({ color: COLOR.attention, y: baseY, h: aH }); }
        if (rH > 0) { baseY -= rH; segments.push({ color: COLOR.risk, y: baseY, h: rH }); }
        if (cH > 0) { baseY -= cH; segments.push({ color: COLOR.crisis, y: baseY, h: cH }); }

        // Tooltip nativo com breakdown
        const parts: string[] = [];
        if (b.crisis) parts.push(`crise ${b.crisis}`);
        if (b.risk) parts.push(`risco ${b.risk}`);
        if (b.attention) parts.push(`atenção ${b.attention}`);
        if (b.info) parts.push(`info ${b.info}`);
        const tooltip = `${b.date}: ${b.total} sinais${parts.length ? ` (${parts.join(' · ')})` : ''}`;

        return (
          <g key={b.date}>
            <title>{tooltip}</title>
            {totalH === 0 ? (
              // Marca dia vazio como linha fina — mantém eixo X visível
              <rect
                x={x}
                y={99}
                width={barWidth}
                height={1}
                fill="#334155"
              />
            ) : (
              segments.map((s, idx) => (
                <rect
                  key={idx}
                  x={x}
                  y={s.y}
                  width={barWidth}
                  height={s.h}
                  fill={s.color}
                />
              ))
            )}
          </g>
        );
      })}
    </svg>
  );
};

export default PulsoSparkline;
