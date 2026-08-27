/**
 * PulsoStatsTile — tile no Dashboard mostrando resumo do Pulso Digital
 * (últimos 7 dias). Consome GET /api/v1/social/signals/stats (PR 29).
 *
 * Objetivo: coordenador de campanha vê o "estado geral do social" sem
 * navegar até Pulso Digital. Se houver crisis/risk aparente, um chip
 * chama atenção — clicando vai direto pra tela.
 *
 * REGRA §45 aplicada: total=0 mostra "sem sinais coletados no período" —
 * NUNCA "campanha calma". Diferença conceitual importante — pipeline
 * pode estar sem dados, não que não haja o que reportar.
 *
 * Design: minimalista. Nada de gráfico grande — o feed dedicado tem
 * detalhamento. Aqui é só radar.
 */

import * as React from 'react';
import { authedFetch } from '../../lib/authedFetch';
import Card from '../ui/Card';
import { useAuth } from '../../contexts/AuthContext';

interface StatsResponse {
  total: number;
  sinceDate: string;
  untilDate: string;
  bySeverity: {
    info: number;
    attention: number;
    risk: number;
    crisis: number;
  };
  byTopic: Record<string, number>;
}

const SEVERITY_LABEL: Record<'info' | 'attention' | 'risk' | 'crisis', string> = {
  info: 'Info',
  attention: 'Atenção',
  risk: 'Risco',
  crisis: 'Crise',
};

const SEVERITY_COLOR_CLS: Record<'info' | 'attention' | 'risk' | 'crisis', string> = {
  info: 'text-slate-300 bg-slate-700/40 border-slate-600',
  attention: 'text-amber-300 bg-amber-500/15 border-amber-600/60',
  risk: 'text-orange-300 bg-orange-500/15 border-orange-600/70',
  crisis: 'text-red-200 bg-red-500/20 border-red-500',
};

interface PulsoStatsTileProps {
  onNavigate?: () => void;
}

const PulsoStatsTile: React.FC<PulsoStatsTileProps> = ({ onNavigate }) => {
  const { user } = useAuth();
  const campaignId = user?.campaignId;

  const [stats, setStats] = React.useState<StatsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch('/api/v1/social/signals/stats');
      if (!res.ok) {
        setError(`Erro ${res.status}`);
        setStats(null);
        return;
      }
      const body = await res.json() as StatsResponse;
      setStats(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (!campaignId) return null;

  // Top 2 topics — se lista, mais informativo que só o número
  const topTopics = React.useMemo(() => {
    if (!stats) return [] as Array<{ topic: string; count: number }>;
    return Object.entries(stats.byTopic)
      .filter(([k]) => k !== '__null__')
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
      .slice(0, 2);
  }, [stats]);

  const highest: 'info' | 'attention' | 'risk' | 'crisis' | null = React.useMemo(() => {
    if (!stats) return null;
    if (stats.bySeverity.crisis > 0) return 'crisis';
    if (stats.bySeverity.risk > 0) return 'risk';
    if (stats.bySeverity.attention > 0) return 'attention';
    if (stats.bySeverity.info > 0) return 'info';
    return null;
  }, [stats]);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-slate-200">Pulso Digital · últimos 7 dias</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Sinais das redes monitoradas. Hipóteses ≠ afirmação (§42).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onNavigate && (
            <button
              type="button"
              onClick={onNavigate}
              className="text-[11px] text-sky-400 hover:text-sky-300 underline"
            >
              Ver feed
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-50"
            title="Atualizar"
          >
            {loading ? '…' : '↻'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-300">{error}</p>
      )}

      {!error && loading && !stats && (
        <p className="mt-3 text-xs text-slate-400">Carregando…</p>
      )}

      {!error && !loading && stats && stats.total === 0 && (
        <p className="mt-3 text-xs text-slate-400">
          Sem sinais coletados no período — pipeline pode estar sem dados suficientes.
        </p>
      )}

      {stats && stats.total > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-100 tabular-nums">{stats.total}</span>
            <span className="text-xs text-slate-400">
              {stats.total === 1 ? 'sinal' : 'sinais'}
              {highest && (
                <>
                  {' · pico '}
                  <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${SEVERITY_COLOR_CLS[highest]}`}>
                    {SEVERITY_LABEL[highest]}
                  </span>
                </>
              )}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(['crisis', 'risk', 'attention', 'info'] as const).map(sev => {
              const c = stats.bySeverity[sev];
              const dimmed = c === 0;
              return (
                <span
                  key={sev}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${SEVERITY_COLOR_CLS[sev]} ${dimmed ? 'opacity-40' : ''}`}
                >
                  <span className="font-semibold tabular-nums">{c}</span>
                  <span>{SEVERITY_LABEL[sev]}</span>
                </span>
              );
            })}
          </div>

          {topTopics.length > 0 && (
            <div className="text-[11px] text-slate-500">
              <span className="text-slate-400 font-medium">Top temas: </span>
              {topTopics.map((t, i) => (
                <span key={t.topic}>
                  {i > 0 && ' · '}
                  {t.topic} ({t.count})
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

export default PulsoStatsTile;
