/**
 * PulsoSummaryHeader — mini-dashboard visual acima do feed do Pulso Digital.
 *
 * Mostra:
 *   - Total de signals na visão atual (respeita filtros ativos)
 *   - Barra de distribuição por severity (proporção visual)
 *   - Chips de contagem por severity (crise / risco / atenção / info)
 *   - Top 3 topics por volume
 *
 * REGRA §45 aplicada: quando total=0 este componente NÃO renderiza.
 * Estado vazio já tem card próprio na página; evitamos duplicar
 * "sem sinais" — e mais importante, não inventamos um summary de nada.
 *
 * Cálculos são puros (função `computePulsoSummary` exportada), permite
 * teste unitário sem DOM. Componente React só faz render.
 */

import * as React from 'react';
import {
  StoredSocialSignal,
  SocialSignalSeverity,
  SEVERITY_LABELS,
  SEVERITY_COLORS,
} from './pulsoTypes';
import { computePulsoSummary, computeDayBuckets } from './pulsoSummary';
import PulsoSparkline from './PulsoSparkline';

// ── Render ─────────────────────────────────────────────────────────

const SEVERITY_BAR_COLOR: Record<SocialSignalSeverity, string> = {
  info: 'bg-slate-500',
  attention: 'bg-amber-500',
  risk: 'bg-orange-500',
  crisis: 'bg-red-500',
};

const SEVERITY_ORDER_UI: SocialSignalSeverity[] = ['crisis', 'risk', 'attention', 'info'];

interface PulsoSummaryHeaderProps {
  signals: StoredSocialSignal[];
  className?: string;
}

const PulsoSummaryHeader: React.FC<PulsoSummaryHeaderProps> = ({ signals, className }) => {
  const summary = React.useMemo(() => computePulsoSummary(signals), [signals]);
  // "now" fixado uma vez no mount pra determinismo do bucket em cada render.
  // Refresh vem via re-mount ou nova query — não precisa de relógio ticking.
  const nowRef = React.useRef<Date>(new Date());
  const dayBuckets = React.useMemo(
    () => computeDayBuckets(signals, nowRef.current),
    [signals],
  );
  if (summary.total === 0) return null;

  return (
    <div
      className={`rounded-md border border-slate-700 bg-slate-800/60 p-3 ${className ?? ''}`}
      data-testid="pulso-summary-header"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-slate-100">{summary.total}</span>
          <span className="text-xs text-slate-400">
            {summary.total === 1 ? 'sinal na visão atual' : 'sinais na visão atual'}
          </span>
        </div>
        {summary.topTopics.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
              Top temas
            </span>
            {summary.topTopics.map(t => (
              <span
                key={t.topic}
                className="px-2 py-0.5 rounded-md text-[11px] bg-slate-700/60 text-slate-200 border border-slate-600"
              >
                {t.label} · {t.count}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Barra de distribuição por severity (crisis primeiro pra chamar a atenção) */}
      <div
        className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-900"
        role="presentation"
        aria-hidden="true"
      >
        {SEVERITY_ORDER_UI.map(sev => {
          const pct = summary.total > 0 ? (summary.bySeverity[sev] / summary.total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={sev}
              className={SEVERITY_BAR_COLOR[sev]}
              style={{ width: `${pct}%` }}
              title={`${SEVERITY_LABELS[sev]}: ${summary.bySeverity[sev]}`}
            />
          );
        })}
      </div>

      {/* Sparkline por dia — reusa componente do Dashboard tile (PR 32) */}
      {dayBuckets.length > 0 && (
        <PulsoSparkline
          buckets={dayBuckets}
          ariaLabel="Volume diário dos sinais visíveis"
        />
      )}

      {/* Chips numéricos por severity */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {SEVERITY_ORDER_UI.map(sev => {
          const count = summary.bySeverity[sev];
          const c = SEVERITY_COLORS[sev];
          const dimmed = count === 0;
          return (
            <span
              key={sev}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border ${c.bg} ${c.text} ${c.border} ${dimmed ? 'opacity-40' : ''}`}
              data-severity={sev}
            >
              <span className="font-semibold tabular-nums">{count}</span>
              <span>{SEVERITY_LABELS[sev]}</span>
              {count > 0 && (
                <span className="text-[10px] opacity-80">
                  · {summary.percentBySeverity[sev]}%
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
};

export default PulsoSummaryHeader;
