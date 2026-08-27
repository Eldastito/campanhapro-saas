import * as React from 'react';
import {
  StoredSocialSignal,
  SEVERITY_COLORS,
  SEVERITY_LABELS,
  SOURCE_LABELS,
  PROVIDER_LABELS,
  TOPIC_LABELS,
  SocialTopic,
  formatEmittedAt,
} from './pulsoTypes';

interface Props {
  signal: StoredSocialSignal;
  onClick?: (signal: StoredSocialSignal) => void;
}

const PulsoSignalCard: React.FC<Props> = ({ signal, onClick }) => {
  const colors = SEVERITY_COLORS[signal.severity];
  const topicLabel = signal.topic && signal.topic in TOPIC_LABELS
    ? TOPIC_LABELS[signal.topic as SocialTopic]
    : signal.topic;

  const clickable = typeof onClick === 'function';
  const handleClick = () => { if (onClick) onClick(signal); };
  const handleKey = (e: React.KeyboardEvent) => {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick(signal);
    }
  };

  return (
    <div
      className={`rounded-xl border ${colors.border} ${colors.bg} p-4 ring-1 ${colors.ring} print-bg-transparent ${
        clickable ? 'cursor-pointer hover:ring-2 hover:brightness-110 transition-all' : ''
      }`}
      data-severity={signal.severity}
      onClick={clickable ? handleClick : undefined}
      onKeyDown={clickable ? handleKey : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Ver detalhes: ${signal.summary}` : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`px-2 py-0.5 rounded-md text-xs font-bold uppercase tracking-wide ${colors.text} border ${colors.border}`}
            >
              {SEVERITY_LABELS[signal.severity]}
            </span>
            <span className="text-xs text-slate-400">{SOURCE_LABELS[signal.source]}</span>
            {topicLabel && (
              <span className="text-xs text-slate-500">·</span>
            )}
            {topicLabel && (
              <span className="text-xs text-sky-300">{topicLabel}</span>
            )}
          </div>
          <p className="mt-2 text-sm text-slate-100 font-medium">{signal.summary}</p>
        </div>
        <span className="text-[11px] text-slate-500 whitespace-nowrap">
          {formatEmittedAt(signal.emittedAt)}
        </span>
      </div>

      {/* Providers strip */}
      {signal.providers.length > 0 && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {signal.providers.map(p => (
            <span
              key={p}
              className="px-2 py-0.5 rounded-full text-[11px] bg-slate-800/60 text-slate-300 border border-slate-700"
            >
              {PROVIDER_LABELS[p] ?? p}
            </span>
          ))}
          <span className="text-[11px] text-slate-500 ml-1">
            confidence {(signal.confidence * 100).toFixed(0)}%
          </span>
        </div>
      )}

      {/* Hypotheses (§42 — sempre separadas do summary factual) */}
      {signal.hypotheses.length > 0 && (
        <div className="mt-3 border-t border-slate-700/60 pt-2">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1">
            Hipóteses (não afirmação)
          </p>
          <ul className="space-y-1">
            {signal.hypotheses.map((h, i) => (
              <li key={i} className="text-xs text-slate-400">· {h}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default PulsoSignalCard;
