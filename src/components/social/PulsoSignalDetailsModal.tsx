/**
 * PulsoSignalDetailsModal — drill-down §58 do PRD Social Intelligence.
 *
 * Abre quando o usuário clica num signal card. Mostra:
 *   - Header: severity + source + topic
 *   - Summary factual (mesmo texto do card, mas em fonte maior)
 *   - Hipóteses SEPARADAS (§42) — bloco distinto com label explícito
 *   - Per-provider breakdown do payload (varia por source):
 *       * trend → currentTotal/baselineTotal/deltaPct/window/state
 *       * anomaly → observed/baseline/kind/severity interna
 *       * cross_network_trend → networks + networksDivergent + averageDelta
 *       * cross_network_anomaly → summaries por provider
 *   - Metadata: emittedAt exato + confidence + dedupKey + busVersion
 *   - Botão "Copiar JSON" (payload completo) — util pra debug
 *
 * REGRA §42 preservada: hypotheses NUNCA aparecem misturadas com summary.
 * REGRA §37/§58: provenance visível (por provider quando disponível).
 */
import * as React from 'react';
import Modal from '../ui/Modal';
import {
  StoredSocialSignal,
  SEVERITY_COLORS,
  SEVERITY_LABELS,
  SOURCE_LABELS,
  PROVIDER_LABELS,
  TOPIC_LABELS,
  SocialTopic,
  SocialProvider,
} from './pulsoTypes';

interface Props {
  signal: StoredSocialSignal | null;
  onClose: () => void;
}

// ── Payload type helpers ────────────────────────────────────────────

interface TrendPayload {
  kind: 'trend';
  result: {
    window: string;
    state: string;
    direction: string;
    currentTotal: number;
    baselineTotal: number;
    deltaPct: number | null;
    samples: { current: number; baseline: number };
    confidence: number;
  };
}

interface AnomalyPayload {
  kind: 'anomaly';
  event: {
    kind: string;
    state: string;
    severity: string;
    summary: string;
    observed: number;
    baseline: number | null;
    confidence: number;
    metadata?: Record<string, unknown>;
  };
}

interface CrossNetworkTrendPayload {
  kind: 'cross_network_trend';
  signal: {
    topic: string;
    direction: string;
    networks: string[];
    networksInsufficient: string[];
    networksDivergent: string[];
    confidence: string;
    averageDelta: number | null;
    perProvider: Array<{
      provider: string;
      direction: string;
      state: string;
      deltaPct: number | null;
    }>;
  };
}

interface CrossNetworkAnomalyPayload {
  kind: 'cross_network_anomaly';
  anomaly: {
    kind: string;
    topic?: string;
    networks: string[];
    severity: string;
    summaries: Array<{ provider: string; summary: string }>;
    confidence: number;
    occurrences: number;
  };
}

type TypedPayload =
  | TrendPayload
  | AnomalyPayload
  | CrossNetworkTrendPayload
  | CrossNetworkAnomalyPayload
  | { kind: string; [k: string]: unknown };

// ── Row helper ──────────────────────────────────────────────────────

const Row: React.FC<{ label: string; value: React.ReactNode; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex items-baseline gap-2 py-1 border-b border-slate-700/40 last:border-0">
    <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold min-w-[140px]">{label}</span>
    <span className={`text-sm text-slate-200 ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
  </div>
);

function formatDelta(delta: number | null): string {
  if (delta === null) return 'sem baseline';
  const pct = (delta * 100).toFixed(1);
  return `${delta >= 0 ? '+' : ''}${pct}%`;
}

// ── Per-source blocks ───────────────────────────────────────────────

const TrendBlock: React.FC<{ p: TrendPayload }> = ({ p }) => (
  <>
    <Row label="Janela" value={p.result.window} />
    <Row label="Estado" value={p.result.state} />
    <Row label="Direção" value={p.result.direction} />
    <Row label="Total atual" value={p.result.currentTotal.toLocaleString('pt-BR')} />
    <Row label="Total baseline" value={p.result.baselineTotal.toLocaleString('pt-BR')} />
    <Row label="Delta" value={formatDelta(p.result.deltaPct)} />
    <Row label="Amostras" value={`atual ${p.result.samples.current} · baseline ${p.result.samples.baseline}`} />
  </>
);

const AnomalyBlock: React.FC<{ p: AnomalyPayload }> = ({ p }) => (
  <>
    <Row label="Categoria" value={p.event.kind} />
    <Row label="Estado interno" value={p.event.state} />
    <Row label="Severity interna" value={p.event.severity} />
    <Row label="Observado" value={p.event.observed.toLocaleString('pt-BR')} />
    <Row label="Baseline" value={p.event.baseline === null ? 'null' : p.event.baseline.toLocaleString('pt-BR')} />
    <Row label="Confidence interna" value={`${(p.event.confidence * 100).toFixed(0)}%`} />
  </>
);

const CrossNetworkTrendBlock: React.FC<{ p: CrossNetworkTrendPayload }> = ({ p }) => (
  <>
    <Row label="Direção correlacionada" value={p.signal.direction} />
    <Row label="Confidence cross-network" value={p.signal.confidence} />
    <Row label="Redes concordantes" value={p.signal.networks.join(', ')} />
    {p.signal.networksDivergent.length > 0 && (
      <Row label="Redes divergentes" value={p.signal.networksDivergent.join(', ')} />
    )}
    {p.signal.networksInsufficient.length > 0 && (
      <Row label="Sem histórico suficiente" value={p.signal.networksInsufficient.join(', ')} />
    )}
    <Row label="Delta médio" value={formatDelta(p.signal.averageDelta)} />

    <div className="mt-3">
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Per-provider</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500">
            <th className="text-left font-normal py-1">Rede</th>
            <th className="text-left font-normal py-1">Direção</th>
            <th className="text-left font-normal py-1">Estado</th>
            <th className="text-right font-normal py-1">Delta</th>
          </tr>
        </thead>
        <tbody>
          {p.signal.perProvider.map((r, i) => (
            <tr key={i} className="text-slate-300">
              <td className="py-1">{PROVIDER_LABELS[r.provider as SocialProvider] ?? r.provider}</td>
              <td className="py-1">{r.direction}</td>
              <td className="py-1 text-slate-400">{r.state}</td>
              <td className="py-1 text-right">{formatDelta(r.deltaPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>
);

const CrossNetworkAnomalyBlock: React.FC<{ p: CrossNetworkAnomalyPayload }> = ({ p }) => (
  <>
    <Row label="Categoria" value={p.anomaly.kind} />
    <Row label="Severity" value={p.anomaly.severity} />
    <Row label="Ocorrências" value={String(p.anomaly.occurrences)} />
    <Row label="Redes" value={p.anomaly.networks.join(', ')} />
    <Row label="Confidence média" value={`${(p.anomaly.confidence * 100).toFixed(0)}%`} />

    <div className="mt-3">
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Summaries por rede</p>
      <ul className="space-y-2">
        {p.anomaly.summaries.map((s, i) => (
          <li key={i} className="text-xs">
            <span className="text-sky-300 font-medium">{PROVIDER_LABELS[s.provider as SocialProvider] ?? s.provider}:</span>{' '}
            <span className="text-slate-300">{s.summary}</span>
          </li>
        ))}
      </ul>
    </div>
  </>
);

// ── Modal principal ─────────────────────────────────────────────────

const PulsoSignalDetailsModal: React.FC<Props> = ({ signal, onClose }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(() => {
    if (!signal) return;
    try {
      const json = JSON.stringify(signal, null, 2);
      void navigator.clipboard.writeText(json).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    } catch {
      /* clipboard bloqueado — silencioso */
    }
  }, [signal]);

  if (!signal) return null;

  const colors = SEVERITY_COLORS[signal.severity];
  const topicLabel = signal.topic && signal.topic in TOPIC_LABELS
    ? TOPIC_LABELS[signal.topic as SocialTopic]
    : signal.topic;
  const payload = signal.payload as TypedPayload;

  return (
    <Modal isOpen={true} onClose={onClose} title="Detalhes do sinal">
      {/* Header — severity/source/topic */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className={`px-2 py-0.5 rounded-md text-xs font-bold uppercase tracking-wide ${colors.text} border ${colors.border}`}>
          {SEVERITY_LABELS[signal.severity]}
        </span>
        <span className="text-xs text-slate-400">{SOURCE_LABELS[signal.source]}</span>
        {topicLabel && <span className="text-xs text-slate-500">·</span>}
        {topicLabel && <span className="text-xs text-sky-300">{topicLabel}</span>}
      </div>

      {/* Summary factual — grande */}
      <div className="mb-4">
        <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Fato observado</p>
        <p className="text-sm text-slate-100 leading-relaxed">{signal.summary}</p>
      </div>

      {/* Hipóteses (§42) — sempre bloco separado */}
      {signal.hypotheses.length > 0 && (
        <div className="mb-4 border-t border-slate-700/60 pt-3">
          <p className="text-[11px] uppercase tracking-wider text-amber-400 font-semibold mb-2">
            Hipóteses (não afirmação — precisam verificação humana)
          </p>
          <ul className="space-y-1.5">
            {signal.hypotheses.map((h, i) => (
              <li key={i} className="text-xs text-slate-300 pl-3 border-l-2 border-amber-500/40">{h}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Providers list */}
      {signal.providers.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Redes envolvidas</p>
          <div className="flex items-center gap-2 flex-wrap">
            {signal.providers.map(p => (
              <span key={p} className="px-2 py-0.5 rounded-full text-[11px] bg-slate-800/60 text-slate-300 border border-slate-700">
                {PROVIDER_LABELS[p] ?? p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Per-source drill-down */}
      <div className="mb-4 border-t border-slate-700/60 pt-3">
        <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Payload detalhado</p>
        <div className="bg-slate-900/40 rounded-md p-3">
          {payload.kind === 'trend' && <TrendBlock p={payload as TrendPayload} />}
          {payload.kind === 'anomaly' && <AnomalyBlock p={payload as AnomalyPayload} />}
          {payload.kind === 'cross_network_trend' && <CrossNetworkTrendBlock p={payload as CrossNetworkTrendPayload} />}
          {payload.kind === 'cross_network_anomaly' && <CrossNetworkAnomalyBlock p={payload as CrossNetworkAnomalyPayload} />}
          {!['trend', 'anomaly', 'cross_network_trend', 'cross_network_anomaly'].includes(payload.kind) && (
            <p className="text-xs text-slate-400">Payload de tipo desconhecido — abra o JSON abaixo.</p>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="mb-4 border-t border-slate-700/60 pt-3">
        <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Metadata</p>
        <Row label="Emitido em" value={new Date(signal.emittedAt).toLocaleString('pt-BR')} />
        <Row label="Confidence" value={`${(signal.confidence * 100).toFixed(1)}%`} />
        <Row label="DedupKey" value={signal.dedupKey} mono />
        <Row label="Bus version" value={signal.busVersion} mono />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 justify-end border-t border-slate-700/60 pt-3">
        <button
          type="button"
          onClick={handleCopy}
          className="px-3 py-1.5 rounded-md text-xs bg-slate-700 hover:bg-slate-600 text-slate-100 border border-slate-600"
        >
          {copied ? 'Copiado ✓' : 'Copiar JSON'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-md text-xs bg-sky-600 hover:bg-sky-500 text-white"
        >
          Fechar
        </button>
      </div>
    </Modal>
  );
};

export default PulsoSignalDetailsModal;
