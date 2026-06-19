import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import { History, Loader2, RefreshCw, FlaskConical, Network, Bot } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';

interface BucketResult {
  candidateId: string;
  name: string;
  meanShare: number;
  p50: number;
  winProbability: number;
}

// Backend manda em camelCase ("candidatesInput"/"resultsSummary"); aceitamos os
// dois nomes pra não quebrar caso a serialização mude.
interface SimulationRun {
  id: string;
  iterations: number;
  candidatesInput?: Array<{ id: string; name: string; baseShare: number; margin: number }>;
  candidates_input?: Array<{ id: string; name: string; baseShare: number; margin: number }>;
  resultsSummary?: BucketResult[];
  results_summary?: BucketResult[];
  createdAt: string;
}

interface GraphRecord {
  id: string;
  label: string;
  nodes: Array<unknown>;
  edges: Array<unknown>;
  createdAt: string;
}

interface DebateRecord {
  id: string;
  label: string;
  scenario: string;
  agents: Array<unknown>;
  turns: number;
  report?: string | null;
  createdAt: string;
}

type HistoryItem =
  | { kind: 'simulation'; createdAt: string; run: SimulationRun }
  | { kind: 'graph'; createdAt: string; graph: GraphRecord }
  | { kind: 'debate'; createdAt: string; debate: DebateRecord };

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export const SimulationHistory: React.FC = () => {
  const [items, setItems] = React.useState<HistoryItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const fetchAll = React.useCallback(async () => {
    setLoading(true);
    try {
      // Histórico unificado: simulações Monte Carlo + grafos salvos + debates IA.
      const [simRes, graphRes, debRes] = await Promise.all([
        authedFetch('/api/v1/scenarios/simulate'),
        authedFetch('/api/v1/scenarios/graphs'),
        authedFetch('/api/v1/scenarios/debate'),
      ]);
      const sims: SimulationRun[] = simRes.ok ? ((await simRes.json()).runs ?? []) : [];
      const graphs: GraphRecord[] = graphRes.ok ? ((await graphRes.json()).graphs ?? []) : [];
      const debates: DebateRecord[] = debRes.ok ? ((await debRes.json()).debates ?? []) : [];
      const merged: HistoryItem[] = [
        ...sims.map((run) => ({ kind: 'simulation' as const, createdAt: run.createdAt, run })),
        ...graphs.map((graph) => ({ kind: 'graph' as const, createdAt: graph.createdAt, graph })),
        ...debates.map((debate) => ({ kind: 'debate' as const, createdAt: debate.createdAt, debate })),
      ].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setItems(merged);
    } catch {
      // empty state
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { fetchAll(); }, [fetchAll]);

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-slate-200 flex items-center gap-2">
          <History className="w-4 h-4 text-indigo-400" />
          Histórico de Cenários
        </h3>
        <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={fetchAll} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">
          <History className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nada por aqui ainda. Rode uma simulação Monte Carlo ou salve um grafo.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const when = new Date(item.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

            // ── Grafo salvo ──
            if (item.kind === 'graph') {
              const g = item.graph;
              return (
                <div key={`g-${g.id}`} className="border border-slate-700 rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 flex items-center gap-1 shrink-0">
                      <Network className="w-3 h-3" /> Grafo
                    </span>
                    <span className="text-sm text-slate-200 truncate">{g.label}</span>
                  </div>
                  <span className="text-xs text-slate-500 ml-3 shrink-0">
                    {g.nodes?.length ?? 0} nós · {when}
                  </span>
                </div>
              );
            }

            // ── Debate por IA ──
            if (item.kind === 'debate') {
              const d = item.debate;
              const open = expanded === d.id;
              return (
                <div key={`d-${d.id}`} className="border border-slate-700 rounded-xl overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-700/40 transition-colors"
                    onClick={() => setExpanded((e) => (e === d.id ? null : d.id))}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200 flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300 flex items-center gap-1 shrink-0">
                          <Bot className="w-3 h-3" /> Debate IA
                        </span>
                        <span className="truncate">{d.label}</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {d.turns} turnos · {d.agents?.length ?? 0} agentes
                      </p>
                    </div>
                    <span className="text-xs text-slate-500 ml-3 shrink-0">{when}</span>
                  </button>
                  {open && (
                    <div className="px-4 pb-4 pt-2 border-t border-slate-700/60 space-y-2">
                      <p className="text-xs text-slate-400"><span className="text-slate-500">Cenário:</span> {d.scenario}</p>
                      {d.report && <p className="text-xs text-slate-400 whitespace-pre-wrap line-clamp-[12]">{d.report}</p>}
                    </div>
                  )}
                </div>
              );
            }

            // ── Simulação Monte Carlo ──
            const run = item.run;
            const summary = run.resultsSummary ?? run.results_summary ?? [];
            const inputs = run.candidatesInput ?? run.candidates_input ?? [];
            const winner = [...summary].sort((a, b) => b.winProbability - a.winProbability)[0];
            return (
              <div key={`s-${run.id}`} className="border border-slate-700 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-700/40 transition-colors"
                  onClick={() => setExpanded((e) => (e === run.id ? null : run.id))}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-200 flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 flex items-center gap-1 shrink-0">
                        <FlaskConical className="w-3 h-3" /> Monte Carlo
                      </span>
                      {run.iterations.toLocaleString('pt-BR')} iterações — {inputs.length} candidatos
                    </p>
                    {winner && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        Líder: <span className="text-emerald-400">{winner.name}</span> ({(winner.winProbability * 100).toFixed(1)}% prob.)
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-slate-500 ml-3 shrink-0">{when}</span>
                </button>

                {expanded === run.id && summary.length > 0 && (
                  <div className="px-4 pb-4 pt-2 border-t border-slate-700/60">
                    <div className="space-y-2">
                      {[...summary]
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
