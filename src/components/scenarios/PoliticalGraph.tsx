import * as React from 'react';
import { Network, Plus, Trash2, Save, Loader2 } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';

interface GraphNode {
  id: string;
  label: string;
  type: 'candidate' | 'leader' | 'voter_group' | 'opponent' | 'ally';
  weight?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: 'support' | 'opposition' | 'neutral' | 'undecided';
  weight?: number;
}

interface GraphRecord {
  id: string;
  label: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  created_at: string;
}

const NODE_COLORS: Record<string, string> = {
  candidate: '#6366f1',
  leader: '#10b981',
  voter_group: '#f59e0b',
  opponent: '#ef4444',
  ally: '#06b6d4',
};

const EDGE_COLORS: Record<string, string> = {
  support: '#10b981',
  opposition: '#ef4444',
  neutral: '#64748b',
  undecided: '#f59e0b',
};

const NODE_TYPES: GraphNode['type'][] = ['candidate', 'leader', 'voter_group', 'opponent', 'ally'];
const EDGE_TYPES: GraphEdge['type'][] = ['support', 'opposition', 'neutral', 'undecided'];

const NODE_TYPE_LABELS: Record<string, string> = {
  candidate: 'Candidato',
  leader: 'Liderança',
  voter_group: 'Grupo de Eleitores',
  opponent: 'Adversário',
  ally: 'Aliado',
};
const EDGE_TYPE_LABELS: Record<string, string> = {
  support: 'Apoio',
  opposition: 'Oposição',
  neutral: 'Neutro',
  undecided: 'Indefinido',
};

/** Minimal SVG force-layout approximation (static spring-like positions) */
function layoutNodes(nodes: GraphNode[], _edges: GraphEdge[], w: number, h: number) {
  if (nodes.length === 0) return [];
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) * 0.36;
  return nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    const candidate = n.type === 'candidate';
    return {
      ...n,
      x: candidate ? cx : cx + r * Math.cos(angle),
      y: candidate ? cy : cy + r * Math.sin(angle),
    };
  });
}

const GraphCanvas: React.FC<{ nodes: GraphNode[]; edges: GraphEdge[] }> = ({ nodes, edges }) => {
  const W = 600, H = 340;
  const laid = layoutNodes(nodes, edges, W, H);
  const nodeMap = Object.fromEntries(laid.map(n => [n.id, n]));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl bg-slate-900 border border-slate-700">
      <defs>
        {EDGE_TYPES.map(t => (
          <marker key={t} id={`arr-${t}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill={EDGE_COLORS[t]} />
          </marker>
        ))}
      </defs>

      {edges.map((e, i) => {
        const s = nodeMap[e.source], t = nodeMap[e.target];
        if (!s || !t) return null;
        const dx = t.x - s.x, dy = t.y - s.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ex = t.x - (dx / len) * 18, ey = t.y - (dy / len) * 18;
        return (
          <line
            key={i}
            x1={s.x} y1={s.y} x2={ex} y2={ey}
            stroke={EDGE_COLORS[e.type]} strokeWidth={1.5} opacity={0.7}
            markerEnd={`url(#arr-${e.type})`}
          />
        );
      })}

      {laid.map(n => (
        <g key={n.id}>
          <circle cx={n.x} cy={n.y} r={18} fill={NODE_COLORS[n.type] ?? '#64748b'} opacity={0.85} />
          <text x={n.x} y={n.y + 1} textAnchor="middle" dominantBaseline="middle"
            fontSize={9} fill="white" fontWeight={600} className="select-none">
            {n.label.slice(0, 8)}
          </text>
          <text x={n.x} y={n.y + 28} textAnchor="middle" fontSize={8} fill="#94a3b8" className="select-none">
            {NODE_TYPE_LABELS[n.type]}
          </text>
        </g>
      ))}
    </svg>
  );
};

export const PoliticalGraph: React.FC = () => {
  const [graphLabel, setGraphLabel] = React.useState('Mapa Político');
  const [nodes, setNodes] = React.useState<GraphNode[]>([
    { id: 'n1', label: 'Candidato', type: 'candidate' },
    { id: 'n2', label: 'Grupo A', type: 'voter_group' },
    { id: 'n3', label: 'Lider B', type: 'leader' },
  ]);
  const [edges, setEdges] = React.useState<GraphEdge[]>([
    { source: 'n2', target: 'n1', type: 'support' },
    { source: 'n3', target: 'n1', type: 'undecided' },
  ]);
  const [history, setHistory] = React.useState<GraphRecord[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [loadingHistory, setLoadingHistory] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchHistory = React.useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/v1/scenarios/graphs');
      if (res.ok) {
        const json = await res.json();
        setHistory(json.graphs ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  React.useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const addNode = () => {
    const id = `n${Date.now()}`;
    setNodes(prev => [...prev, { id, label: 'Novo Nó', type: 'voter_group' }]);
  };

  const removeNode = (id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id));
    setEdges(prev => prev.filter(e => e.source !== id && e.target !== id));
  };

  const addEdge = () => {
    if (nodes.length < 2) return;
    setEdges(prev => [...prev, { source: nodes[0].id, target: nodes[1].id, type: 'neutral' }]);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/scenarios/graphs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, edges, label: graphLabel }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao salvar');
      await fetchHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const loadGraph = (g: GraphRecord) => {
    setGraphLabel(g.label);
    setNodes(g.nodes);
    setEdges(g.edges);
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-indigo-400" />
            <input
              className="text-sm font-semibold bg-transparent border-b border-slate-600 focus:border-indigo-500 focus:outline-none text-slate-200 pb-0.5"
              value={graphLabel}
              onChange={e => setGraphLabel(e.target.value)}
            />
          </div>
          <Button variant="primary" className="text-xs px-3 py-1.5" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
            Salvar
          </Button>
        </div>

        <GraphCanvas nodes={nodes} edges={edges} />

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 mt-2">{error}</p>
        )}

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Nodes editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-400">Nós</p>
              <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={addNode}>
                <Plus className="w-3 h-3 inline mr-1" />Adicionar
              </button>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {nodes.map(n => (
                <div key={n.id} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: NODE_COLORS[n.type] }} />
                  <input
                    className="flex-1 text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500"
                    value={n.label}
                    onChange={e => setNodes(prev => prev.map(x => x.id === n.id ? { ...x, label: e.target.value } : x))}
                  />
                  <select
                    className="text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300"
                    value={n.type}
                    onChange={e => setNodes(prev => prev.map(x => x.id === n.id ? { ...x, type: e.target.value as GraphNode['type'] } : x))}
                  >
                    {NODE_TYPES.map(t => <option key={t} value={t}>{NODE_TYPE_LABELS[t]}</option>)}
                  </select>
                  <button className="text-slate-600 hover:text-red-400" onClick={() => removeNode(n.id)}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Edges editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-400">Arestas</p>
              <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={addEdge}>
                <Plus className="w-3 h-3 inline mr-1" />Adicionar
              </button>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {edges.map((e, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <select
                    className="flex-1 text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300"
                    value={e.source}
                    onChange={ev => setEdges(prev => prev.map((x, j) => j === i ? { ...x, source: ev.target.value } : x))}
                  >
                    {nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                  </select>
                  <select
                    className="text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300"
                    value={e.type}
                    onChange={ev => setEdges(prev => prev.map((x, j) => j === i ? { ...x, type: ev.target.value as GraphEdge['type'] } : x))}
                  >
                    {EDGE_TYPES.map(t => <option key={t} value={t}>{EDGE_TYPE_LABELS[t]}</option>)}
                  </select>
                  <select
                    className="flex-1 text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300"
                    value={e.target}
                    onChange={ev => setEdges(prev => prev.map((x, j) => j === i ? { ...x, target: ev.target.value } : x))}
                  >
                    {nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                  </select>
                  <button className="text-slate-600 hover:text-red-400" onClick={() => setEdges(prev => prev.filter((_, j) => j !== i))}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* History */}
      {(history.length > 0 || loadingHistory) && (
        <Card>
          <h3 className="text-xs font-semibold text-slate-400 mb-3">Grafos Salvos</h3>
          <div className="space-y-1.5">
            {history.map(g => (
              <button
                key={g.id}
                className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg hover:bg-slate-700/50 transition-colors"
                onClick={() => loadGraph(g)}
              >
                <span className="text-sm text-slate-300">{g.label}</span>
                <span className="text-xs text-slate-500">
                  {new Date(g.created_at).toLocaleDateString('pt-BR')} · {g.nodes.length} nós
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default PoliticalGraph;
