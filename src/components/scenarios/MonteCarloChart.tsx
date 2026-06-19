import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import { TrendingUp, AlertTriangle, Info, ChevronDown } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';

interface CandidateInput {
  id: string;
  name: string;
  baseShare: number;
  margin: number;
}

interface BucketResult {
  candidateId: string;
  name: string;
  meanShare: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  winProbability: number;
}

interface SimulationResult {
  runId: string | null;
  iterations: number;
  disclaimer: string;
  candidates: BucketResult[];
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function BoxPlotBar({ bucket, color }: { bucket: BucketResult; color: string }) {
  const toPercent = (v: number) => `${(v * 100).toFixed(1)}%`;
  const pct = (v: number) => v * 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span className="font-medium text-slate-200 truncate max-w-[140px]">{bucket.name}</span>
        <span className="text-xs text-slate-300 ml-2">P50: {toPercent(bucket.p50)}</span>
      </div>
      {/* Box plot track */}
      <div className="relative h-5 bg-slate-700 rounded-full overflow-hidden">
        {/* P10–P90 range */}
        <div
          className="absolute top-0 h-full rounded-full opacity-30"
          style={{
            left: `${pct(bucket.p10)}%`,
            width: `${pct(bucket.p90 - bucket.p10)}%`,
            backgroundColor: color,
          }}
        />
        {/* P25–P75 box */}
        <div
          className="absolute top-0 h-full rounded-full opacity-60"
          style={{
            left: `${pct(bucket.p25)}%`,
            width: `${pct(bucket.p75 - bucket.p25)}%`,
            backgroundColor: color,
          }}
        />
        {/* Median tick */}
        <div
          className="absolute top-0 h-full w-0.5 bg-white opacity-90"
          style={{ left: `${pct(bucket.p50)}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>{toPercent(bucket.p10)}</span>
        <span className="text-slate-400 font-medium">
          Prob. vitória: {(bucket.winProbability * 100).toFixed(1)}%
        </span>
        <span>{toPercent(bucket.p90)}</span>
      </div>
    </div>
  );
}

const DEFAULT_CANDIDATES: CandidateInput[] = [
  { id: 'c1', name: 'Candidato A', baseShare: 0.40, margin: 0.05 },
  { id: 'c2', name: 'Candidato B', baseShare: 0.35, margin: 0.06 },
  { id: 'c3', name: 'Candidato C', baseShare: 0.25, margin: 0.04 },
];

export const MonteCarloChart: React.FC = () => {
  const [candidates, setCandidates] = React.useState<CandidateInput[]>(DEFAULT_CANDIDATES);
  const [iterations, setIterations] = React.useState(10000);
  const [result, setResult] = React.useState<SimulationResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showHelp, setShowHelp] = React.useState(false);
  const [suggesting, setSuggesting] = React.useState(false);
  const [suggestNote, setSuggestNote] = React.useState<string | null>(null);

  // Pré-preenche a partir de dados REAIS (pesquisas internas + adversários).
  const suggestFromData = async () => {
    setSuggesting(true); setError(null); setSuggestNote(null);
    try {
      const res = await authedFetch('/api/v1/scenarios/monte-carlo/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao sugerir');
      if (Array.isArray(json.candidates) && json.candidates.length >= 2) {
        setCandidates(json.candidates.slice(0, 6));
      } else if (json.candidates?.length === 1) {
        setError('Só achei 1 candidato nos dados — adicione adversários ou registre mais pesquisas.');
      }
      setSuggestNote(json.note ?? null);
    } catch (err: any) { setError(err.message); } finally { setSuggesting(false); }
  };

  const sumIntencao = candidates.reduce((s, c) => s + (c.baseShare || 0), 0);
  const sumPct = Math.round(sumIntencao * 100);

  const addCandidate = () => {
    if (candidates.length >= 6) return;
    const id = `c${Date.now()}`;
    setCandidates(prev => [...prev, { id, name: `Candidato ${prev.length + 1}`, baseShare: 0.1, margin: 0.05 }]);
  };

  const removeCandidate = (id: string) => {
    if (candidates.length <= 2) return;
    setCandidates(prev => prev.filter(c => c.id !== id));
  };

  const updateCandidate = (id: string, field: keyof CandidateInput, value: string | number) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const runSimulation = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch('/api/v1/scenarios/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates, iterations }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro na simulação');
      setResult(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Config Panel */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-400" />
            Configuração da Simulação
          </h3>
          <button
            onClick={() => setShowHelp((s) => !s)}
            className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300"
          >
            <Info className="w-3.5 h-3.5" />
            Como funciona
            <ChevronDown className={`w-3 h-3 transition-transform ${showHelp ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {showHelp && (
          <div className="mb-4 text-xs text-slate-400 bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-2">
            <p>
              <span className="text-slate-200 font-semibold">Intenção (%)</span> — a intenção de voto
              estimada do candidato hoje (o <em>centro</em> da previsão). Ex.: 40 = "gira em torno de 40%".
            </p>
            <p>
              <span className="text-slate-200 font-semibold">Margem (±%)</span> — a incerteza, igual ao
              "±X%" de uma pesquisa. Internamente vira o desvio-padrão da curva. Ex.: Intenção 40 / Margem 5
              significa que ~95% dos cenários simulados caem entre <strong>35% e 45%</strong>.
            </p>
            <p>
              A cada rodada (das milhares de <span className="text-slate-200 font-semibold">iterações</span>),
              o sistema sorteia uma fatia pra cada candidato dentro da sua curva, normaliza pra somar 100% e
              anota quem venceu. Daí saem a <span className="text-slate-200 font-semibold">probabilidade de
              vitória</span> e as faixas P10–P90. Quanto maior a margem, mais incerto o resultado.
            </p>
            <p className="text-slate-500">
              Dica: as intenções não precisam somar exatamente 100% (o cálculo normaliza), mas mantê-las
              perto de 100% deixa o cenário mais realista.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {candidates.map((c) => (
            <div key={c.id} className="grid grid-cols-[1fr_100px_100px_28px] gap-2 items-center">
              <input
                className="text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                value={c.name}
                onChange={e => updateCandidate(c.id, 'name', e.target.value)}
                placeholder="Nome"
              />
              <div className="flex flex-col">
                <label className="text-[10px] text-slate-500 mb-0.5" title="Intenção de voto estimada (centro da previsão).">Intenção (%)</label>
                <input
                  type="number"
                  min={1} max={99} step={1}
                  className="text-sm bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                  value={Math.round(c.baseShare * 100)}
                  onChange={e => updateCandidate(c.id, 'baseShare', Number(e.target.value) / 100)}
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-slate-500 mb-0.5" title="Incerteza (±%), como o erro de uma pesquisa. Vira o desvio-padrão da curva.">Margem (±%)</label>
                <input
                  type="number"
                  min={1} max={30} step={1}
                  className="text-sm bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                  value={Math.round(c.margin * 100)}
                  onChange={e => updateCandidate(c.id, 'margin', Number(e.target.value) / 100)}
                />
              </div>
              <button
                className="text-slate-600 hover:text-red-400 transition-colors text-lg leading-none disabled:opacity-30"
                onClick={() => removeCandidate(c.id)}
                disabled={candidates.length <= 2}
              >×</button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <div className="flex items-center gap-3">
            <button
              className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-30"
              onClick={addCandidate}
              disabled={candidates.length >= 6}
            >
              + Adicionar candidato
            </button>
            <button
              className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
              onClick={suggestFromData}
              disabled={suggesting}
              title="Puxa a intenção de voto das suas pesquisas internas + adversários cadastrados, com margem de erro real."
            >
              {suggesting ? 'Puxando…' : '⤓ Sugerir números reais'}
            </button>
            <span
              className={`text-[11px] ${sumPct >= 90 && sumPct <= 110 ? 'text-slate-500' : 'text-amber-400'}`}
              title="Soma das intenções. O cálculo normaliza pra 100%, mas o ideal é ficar perto de 100."
            >
              Soma: {sumPct}%{(sumPct < 90 || sumPct > 110) ? ' ⚠' : ''}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-500">Iterações:</label>
            <select
              className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-300"
              value={iterations}
              onChange={e => setIterations(Number(e.target.value))}
            >
              <option value={1000}>1.000</option>
              <option value={5000}>5.000</option>
              <option value={10000}>10.000</option>
              <option value={50000}>50.000</option>
            </select>
            <Button variant="primary" className="text-xs px-4 py-1.5" onClick={runSimulation} disabled={loading}>
              {loading ? 'Simulando...' : 'Simular'}
            </Button>
          </div>
        </div>

        {suggestNote && (
          <p className="text-[11px] text-emerald-300/90 bg-emerald-500/10 rounded px-2 py-1.5 mt-2">{suggestNote}</p>
        )}
        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 mt-2">{error}</p>
        )}
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <h3 className="text-sm font-semibold text-slate-300 mb-1">
            Resultados — {result.iterations.toLocaleString('pt-BR')} iterações
          </h3>

          <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 rounded p-2 mb-4">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{result.disclaimer}</span>
          </div>

          <div className="space-y-4">
            {result.candidates.map((b, i) => (
              <BoxPlotBar key={b.candidateId} bucket={b} color={COLORS[i % COLORS.length]} />
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-slate-700">
            <p className="text-xs text-slate-500 mb-2 font-semibold">Probabilidade de Vitória</p>
            <div className="flex flex-wrap gap-3">
              {result.candidates
                .sort((a, b) => b.winProbability - a.winProbability)
                .map((b, _i) => (
                  <div key={b.candidateId} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[_i % COLORS.length] }} />
                    <span className="text-xs text-slate-300">{b.name}</span>
                    <span className="text-xs font-bold" style={{ color: COLORS[_i % COLORS.length] }}>
                      {(b.winProbability * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

export default MonteCarloChart;
