import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import { History, Loader2, RefreshCw } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';

interface BucketResult {
  candidateId: string;
  name: string;
  meanShare: number;
  p50: number;
  winProbability: number;
}

interface SimulationRun {
  id: string;
  iterations: number;
  candidates_input: Array<{ id: string; name: string; baseShare: number; margin: number }>;
  results_summary: BucketResult[];
  created_at: string;
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export const SimulationHistory: React.FC = () => {
  const [runs, setRuns] = React.useState<SimulationRun[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const fetchRuns = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch('/api/v1/scenarios/simulate');
      if (res.ok) {
        const json = await res.json();
        setRuns(json.runs ?? []);
      }
    } catch {
      // empty state
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { fetchRuns(); }, [fetchRuns]);

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-slate-200 flex items-center gap-2">
          <History className="w-4 h-4 text-indigo-400" />
          Histórico de Simulações
        </h3>
        <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={fetchRuns} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">
          <History className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nenhuma simulação executada ainda.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map(run => {
            const winner = run.results_summary?.sort((a, b) => b.winProbability - a.winProbability)[0];
            return (
              <div key={run.id} className="border border-slate-700 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-700/40 transition-colors"
                  onClick={() => setExpanded(e => e === run.id ? null : run.id)}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-200">
                      {run.iterations.toLocaleString('pt-BR')} iterações — {run.candidates_input?.length ?? 0} candidatos
                    </p>
                    {winner && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        Líder: <span className="text-emerald-400">{winner.name}</span> ({(winner.winProbability * 100).toFixed(1)}% prob.)
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-slate-500 ml-3 shrink-0">
                    {new Date(run.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>

                {expanded === run.id && run.results_summary && (
                  <div className="px-4 pb-4 pt-2 border-t border-slate-700/60">
                    <div className="space-y-2">
                      {[...run.results_summary]
                        .sort((a, b) => b.winProbability - a.winProbability)
                        .map((b, i) => (
                          <div key={b.candidateId} className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                            <span className="text-xs text-slate-300 min-w-[120px] truncate">{b.name}</span>
                            <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${b.winProbability * 100}%`,
                                  backgroundColor: COLORS[i % COLORS.length],
                                }}
                              />
                            </div>
                            <span className="text-xs font-bold w-12 text-right" style={{ color: COLORS[i % COLORS.length] }}>
                              {(b.winProbability * 100).toFixed(1)}%
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

export default SimulationHistory;
