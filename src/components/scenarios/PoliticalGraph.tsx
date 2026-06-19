import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import { Network, Plus, Trash2, Save, Loader2, Play, Pause, RotateCcw, Sparkles, Database } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';

/**
 * Grafo Político — "debate" animado estilo Obsidian.
 *
 * Nós são pessoas/grupos com uma OPINIÃO ∈ [-1, +1] (oposição ↔ apoio). Roda em
 * <canvas> com:
 *  - layout force-directed animado (repulsão entre nós + molas nas arestas +
 *    centralização + atrito) num loop de requestAnimationFrame;
 *  - simulação de DEBATE: a cada passo, nós não-âncora puxam a opinião na direção
 *    de quem os apoia e se afastam de quem os opõe (DeGroot com sinal de aresta);
 *  - cor do nó reflete a opinião ao vivo (vermelho → cinza → verde);
 *  - arrastar nós, zoom (scroll) e pan (arrastar o fundo).
 * Âncoras (candidato/adversário) não mudam de opinião — elas conduzem o debate.
 */

interface GraphNode {
  id: string;
  label: string;
  type: 'candidate' | 'leader' | 'voter_group' | 'opponent' | 'ally';
  opinion?: number;   // -1..+1
  stubborn?: boolean; // âncora: não muda no debate
  weight?: number;    // peso/influência (afeta raio)
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
  createdAt: string;
}

// Posição/velocidade vivem só no runtime da simulação (não vão pro estado React).
interface SimNode extends GraphNode {
  x: number; y: number; vx: number; vy: number;
  fx?: number | null; fy?: number | null; // fixado durante drag
}

const NODE_COLORS: Record<string, string> = {
  candidate: '#6366f1', leader: '#10b981', voter_group: '#f59e0b',
  opponent: '#ef4444', ally: '#06b6d4',
};
const EDGE_COLORS: Record<string, string> = {
  support: '#10b981', opposition: '#ef4444', neutral: '#64748b', undecided: '#f59e0b',
};
const NODE_TYPES: GraphNode['type'][] = ['candidate', 'leader', 'voter_group', 'opponent', 'ally'];
const EDGE_TYPES: GraphEdge['type'][] = ['support', 'opposition', 'neutral', 'undecided'];
const NODE_TYPE_LABELS: Record<string, string> = {
  candidate: 'Candidato', leader: 'Liderança', voter_group: 'Grupo de Eleitores',
  opponent: 'Adversário', ally: 'Aliado',
};
const EDGE_TYPE_LABELS: Record<string, string> = {
  support: 'Apoio', opposition: 'Oposição', neutral: 'Neutro', undecided: 'Indefinido',
};

// Opinião default por tipo quando o nó não traz uma (grafos antigos / criados à mão).
const DEFAULT_OPINION: Record<string, number> = {
  candidate: 1, ally: 0.7, leader: 0.6, voter_group: 0, opponent: -1,
};
const DEFAULT_STUBBORN: Record<string, boolean> = {
  candidate: true, opponent: true, ally: false, leader: false, voter_group: false,
};

/** Cor por opinião: -1 vermelho → 0 cinza → +1 verde. */
function opinionColor(o: number): string {
  const t = Math.max(-1, Math.min(1, o));
  const neg = [239, 68, 68], mid = [100, 116, 139], pos = [16, 185, 129];
  const lerp = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const rgb = t < 0 ? lerp(mid, neg, -t) : lerp(mid, pos, t);
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function nodeRadius(n: GraphNode): number {
  const base = n.type === 'candidate' ? 22 : n.type === 'opponent' ? 18 : 14;
  return base + Math.min(10, Math.log2((n.weight ?? 1) + 1) * 3);
}

export const PoliticalGraph: React.FC = () => {
  const [graphLabel, setGraphLabel] = React.useState('Mapa Político');
  const [nodes, setNodes] = React.useState<GraphNode[]>([
    { id: 'n1', label: 'Candidato', type: 'candidate', opinion: 1, stubborn: true },
    { id: 'n2', label: 'Grupo A', type: 'voter_group', opinion: 0 },
    { id: 'n3', label: 'Líder B', type: 'leader', opinion: 0.6 },
    { id: 'n4', label: 'Adversário', type: 'opponent', opinion: -1, stubborn: true },
  ]);
  const [edges, setEdges] = React.useState<GraphEdge[]>([
    { source: 'n2', target: 'n1', type: 'undecided' },
    { source: 'n3', target: 'n1', type: 'support' },
    { source: 'n4', target: 'n2', type: 'opposition' },
  ]);
  const [history, setHistory] = React.useState<GraphRecord[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [seeding, setSeeding] = React.useState(false);
  const [running, setRunning] = React.useState(true);     // física sempre anima
  const [debating, setDebating] = React.useState(false);  // dinâmica de opinião
  const [speed, setSpeed] = React.useState(1);
  const [error, setError] = React.useState<string | null>(null);
  const [stats, setStats] = React.useState({ apoio: 0, neutro: 0, oposicao: 0 });

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const simRef = React.useRef<SimNode[]>([]);
  const viewRef = React.useRef({ scale: 1, ox: 0, oy: 0 });
  const dragRef = React.useRef<{ id: string | null; panning: boolean; lastX: number; lastY: number }>({
    id: null, panning: false, lastX: 0, lastY: 0,
  });
  const debatingRef = React.useRef(debating);
  const runningRef = React.useRef(running);
  const speedRef = React.useRef(speed);
  const edgesRef = React.useRef(edges);
  React.useEffect(() => { debatingRef.current = debating; }, [debating]);
  React.useEffect(() => { runningRef.current = running; }, [running]);
  React.useEffect(() => { speedRef.current = speed; }, [speed]);
  React.useEffect(() => { edgesRef.current = edges; }, [edges]);

  const fetchHistory = React.useCallback(async () => {
    try {
      const res = await authedFetch('/api/v1/scenarios/graphs');
      if (res.ok) { const json = await res.json(); setHistory(json.graphs ?? []); }
    } catch { /* ignore */ }
  }, []);
  React.useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // Reconcilia o estado React (nós/arestas) com os SimNodes do runtime, preservando
  // posição/velocidade de quem já existe e semeando novos perto do centro.
  React.useEffect(() => {
    const W = 600, H = 380;
    const prev = new Map(simRef.current.map((s) => [s.id, s]));
    simRef.current = nodes.map((n, i) => {
      const p = prev.get(n.id);
      const opinion = n.opinion ?? DEFAULT_OPINION[n.type] ?? 0;
      const angle = (2 * Math.PI * i) / Math.max(1, nodes.length);
      return p
        ? { ...p, ...n, opinion }
        : {
            ...n, opinion,
            x: W / 2 + Math.cos(angle) * 120 + (Math.random() - 0.5) * 20,
            y: H / 2 + Math.sin(angle) * 120 + (Math.random() - 0.5) * 20,
            vx: 0, vy: 0,
          };
    });
  }, [nodes]);

  // Loop principal: física + (opcional) debate + render. Roda uma vez (refs evitam
  // recriar o loop a cada tecla).
  React.useEffect(() => {
    let raf = 0;
    let opinionAccumulator = 0;

    const step = () => {
      const canvas = canvasRef.current;
      if (!canvas) { raf = requestAnimationFrame(step); return; }
      const ctx = canvas.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(step); return; }

      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth || 600;
      const cssH = 380;
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }

      const sim = simRef.current;
      const eds = edgesRef.current;
      const idIndex = new Map(sim.map((n, i) => [n.id, i]));

      // ── Física (force-directed) ──
      if (runningRef.current && sim.length) {
        const REP = 6000, SPRING = 0.02, LEN = 110, CENTER = 0.003, DAMP = 0.86;
        for (let i = 0; i < sim.length; i++) {
          const a = sim[i];
          if (a.fx != null) continue;
          let ax = 0, ay = 0;
          for (let j = 0; j < sim.length; j++) {
            if (i === j) continue;
            const b = sim[j];
            let dx = a.x - b.x, dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { d2 = 1; dx = Math.random(); dy = Math.random(); }
            const f = REP / d2;
            const d = Math.sqrt(d2);
            ax += (dx / d) * f; ay += (dy / d) * f;
          }
          ax += (cssW / 2 - a.x) * CENTER;
          ay += (cssH / 2 - a.y) * CENTER;
          a.vx = (a.vx + ax * 0.0016) * DAMP;
          a.vy = (a.vy + ay * 0.0016) * DAMP;
        }
        // Molas nas arestas
        for (const e of eds) {
          const ia = idIndex.get(e.source), ib = idIndex.get(e.target);
          if (ia == null || ib == null) continue;
          const a = sim[ia], b = sim[ib];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (d - LEN) * SPRING;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          if (a.fx == null) { a.vx += fx; a.vy += fy; }
          if (b.fx == null) { b.vx -= fx; b.vy -= fy; }
        }
        for (const a of sim) {
          if (a.fx != null) { a.x = a.fx; a.y = a.fy!; continue; }
          a.x += a.vx; a.y += a.vy;
        }
      }

      // ── Dinâmica de opinião (debate) ──
      if (debatingRef.current && sim.length) {
        opinionAccumulator += speedRef.current;
        if (opinionAccumulator >= 1) {
          opinionAccumulator = 0;
          const RATE = 0.04;
          const next = sim.map((n) => n.opinion ?? 0);
          for (const e of eds) {
            const ia = idIndex.get(e.source), ib = idIndex.get(e.target);
            if (ia == null || ib == null) continue;
            const oa = sim[ia].opinion ?? 0, ob = sim[ib].opinion ?? 0;
            const w = (e.weight ?? 1);
            // support: aproxima; opposition: empurra pro oposto; undecided/neutral: fraco.
            const k = e.type === 'support' ? 1 : e.type === 'opposition' ? -1
              : e.type === 'undecided' ? 0.3 : 0.1;
            if (!sim[ia].stubborn) next[ia] += RATE * w * (k * ob - oa) * 0.5;
            if (!sim[ib].stubborn) next[ib] += RATE * w * (k * oa - ob) * 0.5;
          }
          let apoio = 0, neutro = 0, oposicao = 0;
          sim.forEach((n, i) => {
            if (!n.stubborn) n.opinion = Math.max(-1, Math.min(1, next[i]));
            const o = n.opinion ?? 0;
            if (o > 0.2) apoio++; else if (o < -0.2) oposicao++; else neutro++;
          });
          setStats({ apoio, neutro, oposicao });
        }
      }

      // ── Render ──
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = '#0b1120';
      ctx.fillRect(0, 0, cssW, cssH);
      const { scale, ox, oy } = viewRef.current;
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);

      // Arestas
      for (const e of eds) {
        const ia = idIndex.get(e.source), ib = idIndex.get(e.target);
        if (ia == null || ib == null) continue;
        const a = sim[ia], b = sim[ib];
        ctx.strokeStyle = EDGE_COLORS[e.type] ?? '#475569';
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Nós (glow + corpo + label)
      for (const n of sim) {
        const r = nodeRadius(n);
        const col = opinionColor(n.opinion ?? 0);
        const g = ctx.createRadialGradient(n.x, n.y, r * 0.3, n.x, n.y, r * 2.4);
        g.addColorStop(0, col); g.addColorStop(1, 'rgba(11,17,32,0)');
        ctx.globalAlpha = 0.45; ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(n.x, n.y, r * 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        // anel do tipo
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = NODE_COLORS[n.type] ?? '#64748b'; ctx.stroke();
        if (n.stubborn) { // âncora: marca branca no centro
          ctx.beginPath(); ctx.arc(n.x, n.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
        }
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(n.label.slice(0, 16), n.x, n.y + r + 13);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Mapeia coords de tela → mundo (considera pan/zoom).
  const toWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const { scale, ox, oy } = viewRef.current;
    return { x: (clientX - rect.left - ox) / scale, y: (clientY - rect.top - oy) / scale };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = toWorld(e.clientX, e.clientY);
    const hit = simRef.current.find((n) => Math.hypot(n.x - x, n.y - y) <= nodeRadius(n) + 4);
    if (hit) {
      dragRef.current = { id: hit.id, panning: false, lastX: e.clientX, lastY: e.clientY };
      hit.fx = hit.x; hit.fy = hit.y;
    } else {
      dragRef.current = { id: null, panning: true, lastX: e.clientX, lastY: e.clientY };
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag.id) {
      const { x, y } = toWorld(e.clientX, e.clientY);
      const node = simRef.current.find((n) => n.id === drag.id);
      if (node) { node.fx = x; node.fy = y; node.x = x; node.y = y; }
    } else if (drag.panning) {
      viewRef.current.ox += e.clientX - drag.lastX;
      viewRef.current.oy += e.clientY - drag.lastY;
      drag.lastX = e.clientX; drag.lastY = e.clientY;
    }
  };
  const onPointerUp = () => {
    const drag = dragRef.current;
    if (drag.id) {
      const node = simRef.current.find((n) => n.id === drag.id);
      if (node) { node.fx = null; node.fy = null; }
    }
    dragRef.current = { id: null, panning: false, lastX: 0, lastY: 0 };
  };
  const onWheel = (e: React.WheelEvent) => {
    const v = viewRef.current;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const ns = Math.max(0.4, Math.min(2.5, v.scale * factor));
    v.scale = ns;
  };

  // ── Edição ──
  const addNode = () => {
    const id = `n${Date.now()}`;
    setNodes((prev) => [...prev, { id, label: 'Novo Nó', type: 'voter_group', opinion: 0 }]);
  };
  const removeNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
  };
  const addEdge = () => {
    if (nodes.length < 2) return;
    setEdges((prev) => [...prev, { source: nodes[0].id, target: nodes[1].id, type: 'neutral' }]);
  };
  const patchNode = (id: string, patch: Partial<GraphNode>) =>
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));

  const resetOpinions = () => {
    setNodes((prev) => prev.map((n) => ({
      ...n,
      opinion: n.stubborn ?? DEFAULT_STUBBORN[n.type] ? (DEFAULT_OPINION[n.type] ?? 0) : (DEFAULT_OPINION[n.type] ?? 0),
    })));
    setDebating(false);
  };

  const seedFromData = async () => {
    setSeeding(true); setError(null);
    try {
      const res = await authedFetch('/api/v1/scenarios/graph-seed');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao semear');
      if (!json.nodes?.length) { setError('Sem dados suficientes para semear (cadastre contatos/adversários).'); return; }
      setNodes(json.nodes);
      setEdges(json.edges ?? []);
      setGraphLabel('Debate (dados reais)');
    } catch (err: any) { setError(err.message); }
    finally { setSeeding(false); }
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await authedFetch('/api/v1/scenarios/graphs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, edges, label: graphLabel }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao salvar');
      await fetchHistory();
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  };

  const loadGraph = (g: GraphRecord) => {
    setGraphLabel(g.label);
    setNodes(g.nodes.map((n) => ({ ...n, opinion: n.opinion ?? DEFAULT_OPINION[n.type] ?? 0 })));
    setEdges(g.edges);
    setDebating(false);
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <Network className="w-4 h-4 text-indigo-400 shrink-0" />
            <input
              className="text-sm font-semibold bg-transparent border-b border-slate-600 focus:border-indigo-500 focus:outline-none text-slate-200 pb-0.5 min-w-0"
              value={graphLabel}
              onChange={(e) => setGraphLabel(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={seedFromData} disabled={seeding}>
              {seeding ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Database className="w-3 h-3 mr-1" />}
              Semear dados reais
            </Button>
            <Button variant="primary" className="text-xs px-3 py-1.5" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
              Salvar
            </Button>
          </div>
        </div>

        {/* Controles do debate */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            onClick={() => setDebating((d) => !d)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              debating ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                       : 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40'
            }`}
          >
            {debating ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {debating ? 'Pausar debate' : 'Rodar debate'}
          </button>
          <button
            onClick={resetOpinions}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-700/60 text-slate-300 hover:bg-slate-700"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Resetar opiniões
          </button>
          <label className="flex items-center gap-1.5 text-xs text-slate-500 ml-1">
            Velocidade
            <input type="range" min={0.2} max={3} step={0.2} value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))} className="accent-indigo-500" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" checked={running} onChange={(e) => setRunning(e.target.checked)} className="accent-indigo-500" />
            Movimento
          </label>
        </div>

        <canvas
          ref={canvasRef}
          className="w-full rounded-xl border border-slate-700 touch-none cursor-grab active:cursor-grabbing"
          style={{ height: 380 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
        />

        {/* Legenda + stats ao vivo */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-[11px]">
          <div className="flex flex-wrap items-center gap-3 text-slate-400">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Apoio</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-500" /> Neutro</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Oposição</span>
            <span className="text-slate-600">· arraste nós · scroll = zoom · arraste o fundo = mover</span>
          </div>
          <div className="flex items-center gap-3 font-semibold">
            <span className="text-emerald-400">{stats.apoio} apoio</span>
            <span className="text-slate-400">{stats.neutro} neutro</span>
            <span className="text-red-400">{stats.oposicao} oposição</span>
          </div>
        </div>

        {error && <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 mt-2">{error}</p>}

        {/* Editor de nós/arestas */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-400">Nós (pessoas/grupos)</p>
              <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={addNode}>
                <Plus className="w-3 h-3 inline mr-1" />Adicionar
              </button>
            </div>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {nodes.map((n) => (
                <div key={n.id} className="bg-slate-800/40 rounded-lg p-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: NODE_COLORS[n.type] }} />
                    <input
                      className="flex-1 text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500 min-w-0"
                      value={n.label}
                      onChange={(e) => patchNode(n.id, { label: e.target.value })}
                    />
                    <select
                      className="text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300"
                      value={n.type}
                      onChange={(e) => patchNode(n.id, { type: e.target.value as GraphNode['type'] })}
                    >
                      {NODE_TYPES.map((t) => <option key={t} value={t}>{NODE_TYPE_LABELS[t]}</option>)}
                    </select>
                    <button className="text-slate-600 hover:text-red-400 shrink-0" onClick={() => removeNode(n.id)}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 pl-4">
                    <span className="text-[10px] text-slate-500 w-12">Opinião</span>
                    <input type="range" min={-1} max={1} step={0.1}
                      value={n.opinion ?? DEFAULT_OPINION[n.type] ?? 0}
                      onChange={(e) => patchNode(n.id, { opinion: Number(e.target.value) })}
                      className="flex-1 accent-indigo-500" />
                    <span className="text-[10px] font-mono w-8 text-right" style={{ color: opinionColor(n.opinion ?? 0) }}>
                      {(n.opinion ?? DEFAULT_OPINION[n.type] ?? 0).toFixed(1)}
                    </span>
                    <label className="flex items-center gap-1 text-[10px] text-slate-500">
                      <input type="checkbox" checked={n.stubborn ?? DEFAULT_STUBBORN[n.type] ?? false}
                        onChange={(e) => patchNode(n.id, { stubborn: e.target.checked })} className="accent-indigo-500" />
                      âncora
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-400">Arestas (influência)</p>
              <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={addEdge}>
                <Plus className="w-3 h-3 inline mr-1" />Adicionar
              </button>
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {edges.map((e, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <select
                    className="flex-1 min-w-0 text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300"
                    value={e.source}
                    onChange={(ev) => setEdges((prev) => prev.map((x, j) => (j === i ? { ...x, source: ev.target.value } : x)))}
                  >
                    {nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                  </select>
                  <select
                    className="text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300"
                    value={e.type}
                    onChange={(ev) => setEdges((prev) => prev.map((x, j) => (j === i ? { ...x, type: ev.target.value as GraphEdge['type'] } : x)))}
                  >
                    {EDGE_TYPES.map((t) => <option key={t} value={t}>{EDGE_TYPE_LABELS[t]}</option>)}
                  </select>
                  <select
                    className="flex-1 min-w-0 text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300"
                    value={e.target}
                    onChange={(ev) => setEdges((prev) => prev.map((x, j) => (j === i ? { ...x, target: ev.target.value } : x)))}
                  >
                    {nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                  </select>
                  <button className="text-slate-600 hover:text-red-400 shrink-0" onClick={() => setEdges((prev) => prev.filter((_, j) => j !== i))}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {(history.length > 0) && (
        <Card>
          <h3 className="text-xs font-semibold text-slate-400 mb-3 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> Grafos Salvos
          </h3>
          <div className="space-y-1.5">
            {history.map((g) => (
              <button
                key={g.id}
                className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg hover:bg-slate-700/50 transition-colors"
                onClick={() => loadGraph(g)}
              >
                <span className="text-sm text-slate-300 truncate">{g.label}</span>
                <span className="text-xs text-slate-500 shrink-0 ml-2">
                  {new Date(g.createdAt).toLocaleDateString('pt-BR')} · {g.nodes.length} nós
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
