import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import {
  Network, Plus, Trash2, Save, Loader2, Play, Database, Sparkles, FileText,
  MessageSquare, Send, Users, X, ChevronDown,
} from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';

/**
 * SIMULAÇÃO — a tela única de Cenários (estilo MiroFish): o grafo animado É o
 * palco. Os nós são AGENTES (semeados de dados reais), você descreve um cenário
 * e o debate por IA acontece SOBRE o grafo: a cor de cada nó muda ao vivo com a
 * opinião, eles "falam" em balões turno a turno, e no fim sai um relatório.
 * Clicar num nó abre a persona + chat 1–1. Tudo num lugar só.
 *
 * Antes isto era duas abas soltas ("Grafo Político" só desenhava; "Debate IA" só
 * listava falas) — o usuário não via como se conectavam. Agora é um organismo só.
 */

interface GraphNode {
  id: string;
  label: string;
  type: 'candidate' | 'leader' | 'voter_group' | 'opponent' | 'ally';
  opinion?: number;
  stubborn?: boolean;
  weight?: number;
  persona?: string;
  voteIntention?: string;
}
interface GraphEdge {
  source: string; target: string;
  type: 'support' | 'opposition' | 'neutral' | 'undecided';
  weight?: number;
}
interface SimNode extends GraphNode {
  x: number; y: number; vx: number; vy: number;
  opinionAnim: number;          // valor exibido (suaviza a transição de cor)
  fx?: number | null; fy?: number | null;
}
interface TurnAgent { id: string; utterance: string; opinion: number; }
interface DebateTurn { turn: number; agents: TurnAgent[]; }

const NODE_RING: Record<string, string> = {
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
const DEFAULT_OPINION: Record<string, number> = {
  candidate: 1, ally: 0.7, leader: 0.6, voter_group: 0, opponent: -1,
};
const DEFAULT_STUBBORN: Record<string, boolean> = {
  candidate: true, opponent: true, ally: false, leader: false, voter_group: false,
};

function opinionColor(o: number): string {
  const t = Math.max(-1, Math.min(1, o));
  const neg = [239, 68, 68], mid = [100, 116, 139], pos = [16, 185, 129];
  const lerp = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const rgb = t < 0 ? lerp(mid, neg, -t) : lerp(mid, pos, t);
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}
function nodeRadius(n: GraphNode): number {
  const base = n.type === 'candidate' ? 20 : n.type === 'opponent' ? 17 : 13;
  return base + Math.min(9, Math.log2((n.weight ?? 1) + 1) * 3);
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_NODES: GraphNode[] = [
  { id: 'n1', label: 'Candidato', type: 'candidate', opinion: 1, stubborn: true },
  { id: 'n2', label: 'Grupo Centro', type: 'voter_group', opinion: 0 },
  { id: 'n3', label: 'Líder Bairro', type: 'leader', opinion: 0.6 },
  { id: 'n4', label: 'Adversário', type: 'opponent', opinion: -1, stubborn: true },
];
const DEFAULT_EDGES: GraphEdge[] = [
  { source: 'n2', target: 'n1', type: 'undecided' },
  { source: 'n3', target: 'n1', type: 'support' },
  { source: 'n4', target: 'n2', type: 'opposition' },
];

export const ScenarioSimulator: React.FC = () => {
  const [label, setLabel] = React.useState('Simulação');
  const [nodes, setNodes] = React.useState<GraphNode[]>(DEFAULT_NODES);
  const [edges, setEdges] = React.useState<GraphEdge[]>(DEFAULT_EDGES);
  const [scenario, setScenario] = React.useState('');
  const [turns, setTurns] = React.useState(3);
  const [transcript, setTranscript] = React.useState<DebateTurn[]>([]);
  const [report, setReport] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<string | null>(null); // 'seed'|'personas'|'turn-N'|'report'|'save'
  const [error, setError] = React.useState<string | null>(null);
  const [stats, setStats] = React.useState({ apoio: 0, neutro: 0, oposicao: 0 });
  const [selected, setSelected] = React.useState<string | null>(null);
  const [showEditor, setShowEditor] = React.useState(false);
  const [savedGraphs, setSavedGraphs] = React.useState<Array<{ id: string; label: string; nodes: GraphNode[]; edges: GraphEdge[] }>>([]);
  const [chatHist, setChatHist] = React.useState<Record<string, Array<{ role: 'user' | 'agent'; text: string }>>>({});
  const [chatInput, setChatInput] = React.useState('');
  const [chatBusy, setChatBusy] = React.useState(false);
  const [hasPersonas, setHasPersonas] = React.useState(false);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const simRef = React.useRef<SimNode[]>([]);
  const viewRef = React.useRef({ scale: 1, ox: 0, oy: 0 });
  const dragRef = React.useRef<{ id: string | null; panning: boolean; lastX: number; lastY: number; moved: boolean }>({ id: null, panning: false, lastX: 0, lastY: 0, moved: false });
  const bubblesRef = React.useRef<Map<string, { text: string; born: number }>>(new Map());
  const speakerRef = React.useRef<string | null>(null);
  const edgesRef = React.useRef(edges);
  const abortRef = React.useRef(false);
  React.useEffect(() => { edgesRef.current = edges; }, [edges]);

  // Carrega grafos salvos pra reusar como conjunto de agentes.
  React.useEffect(() => {
    authedFetch('/api/v1/scenarios/graphs')
      .then((r) => (r.ok ? r.json() : { graphs: [] }))
      .then((j) => setSavedGraphs(j.graphs ?? []))
      .catch(() => { /* ignore */ });
  }, []);

  // Reconcilia nós → SimNodes preservando posição.
  React.useEffect(() => {
    const W = 640, H = 420;
    const prev = new Map(simRef.current.map((s) => [s.id, s]));
    simRef.current = nodes.map((n, i) => {
      const p = prev.get(n.id);
      const opinion = n.opinion ?? DEFAULT_OPINION[n.type] ?? 0;
      const angle = (2 * Math.PI * i) / Math.max(1, nodes.length);
      if (p) return { ...p, ...n, opinion };
      return {
        ...n, opinion, opinionAnim: opinion,
        x: W / 2 + Math.cos(angle) * 130 + (Math.random() - 0.5) * 20,
        y: H / 2 + Math.sin(angle) * 130 + (Math.random() - 0.5) * 20,
        vx: 0, vy: 0,
      };
    });
  }, [nodes]);

  // Loop de animação: física + suavização de cor + render (nós, arestas, balões).
  React.useEffect(() => {
    let raf = 0;
    const step = () => {
      const canvas = canvasRef.current;
      if (!canvas) { raf = requestAnimationFrame(step); return; }
      const ctx = canvas.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(step); return; }
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth || 640;
      const cssH = 420;
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      }
      const sim = simRef.current;
      const eds = edgesRef.current;
      const idx = new Map(sim.map((n, i) => [n.id, i]));

      // Física
      const REP = 6500, SPRING = 0.02, LEN = 120, CENTER = 0.003, DAMP = 0.86;
      for (let i = 0; i < sim.length; i++) {
        const a = sim[i];
        a.opinionAnim += ((a.opinion ?? 0) - a.opinionAnim) * 0.08; // suaviza cor
        if (a.fx != null) continue;
        let ax = 0, ay = 0;
        for (let j = 0; j < sim.length; j++) {
          if (i === j) continue;
          const b = sim[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { d2 = 1; dx = Math.random(); dy = Math.random(); }
          const d = Math.sqrt(d2);
          ax += (dx / d) * (REP / d2); ay += (dy / d) * (REP / d2);
        }
        ax += (cssW / 2 - a.x) * CENTER; ay += (cssH / 2 - a.y) * CENTER;
        a.vx = (a.vx + ax * 0.0016) * DAMP; a.vy = (a.vy + ay * 0.0016) * DAMP;
      }
      for (const e of eds) {
        const ia = idx.get(e.source), ib = idx.get(e.target);
        if (ia == null || ib == null) continue;
        const a = sim[ia], b = sim[ib];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - LEN) * SPRING;
        if (a.fx == null) { a.vx += (dx / d) * f; a.vy += (dy / d) * f; }
        if (b.fx == null) { b.vx -= (dx / d) * f; b.vy -= (dy / d) * f; }
      }
      for (const a of sim) {
        if (a.fx != null) { a.x = a.fx; a.y = a.fy!; continue; }
        a.x += a.vx; a.y += a.vy;
      }

      // Render
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = '#0b1120'; ctx.fillRect(0, 0, cssW, cssH);
      const { scale, ox, oy } = viewRef.current;
      ctx.translate(ox, oy); ctx.scale(scale, scale);
      const now = performance.now();
      const speaker = speakerRef.current;

      for (const e of eds) {
        const ia = idx.get(e.source), ib = idx.get(e.target);
        if (ia == null || ib == null) continue;
        const a = sim[ia], b = sim[ib];
        const hot = speaker && (e.source === speaker || e.target === speaker);
        ctx.strokeStyle = EDGE_COLORS[e.type] ?? '#475569';
        ctx.globalAlpha = hot ? 0.95 : 0.4;
        ctx.lineWidth = hot ? 2.5 : 1.3;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const n of sim) {
        const r = nodeRadius(n);
        const col = opinionColor(n.opinionAnim);
        const speaking = n.id === speaker;
        const sel = n.id === selected;
        const glowR = r * (speaking ? 3.0 : 2.3);
        const g = ctx.createRadialGradient(n.x, n.y, r * 0.3, n.x, n.y, glowR);
        g.addColorStop(0, col); g.addColorStop(1, 'rgba(11,17,32,0)');
        ctx.globalAlpha = speaking ? 0.7 : 0.4; ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
        ctx.lineWidth = sel ? 3.5 : 2.5;
        ctx.strokeStyle = sel ? '#ffffff' : (NODE_RING[n.type] ?? '#64748b');
        ctx.stroke();
        if (n.stubborn) { ctx.beginPath(); ctx.arc(n.x, n.y, 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); }
        ctx.fillStyle = '#e2e8f0'; ctx.font = '600 11px Inter, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(n.label.slice(0, 16), n.x, n.y + r + 13);
      }

      // Balões de fala (texto enrolado, fade ~6s)
      ctx.textAlign = 'left';
      for (const [id, b] of bubblesRef.current) {
        const node = sim[idx.get(id) ?? -1];
        const age = now - b.born;
        if (!node || age > 6000) { bubblesRef.current.delete(id); continue; }
        const alpha = age > 4500 ? 1 - (age - 4500) / 1500 : 1;
        const maxW = 150, pad = 7, lh = 13, fs = 11;
        ctx.font = `${fs}px Inter, sans-serif`;
        const words = b.text.split(' ');
        const lines: string[] = []; let cur = '';
        for (const w of words) {
          const test = cur ? cur + ' ' + w : w;
          if (ctx.measureText(test).width > maxW - pad * 2 && cur) { lines.push(cur); cur = w; }
          else cur = test;
        }
        if (cur) lines.push(cur);
        const shown = lines.slice(0, 4);
        const bw = maxW, bh = shown.length * lh + pad * 2;
        const bx = node.x + nodeRadius(node) + 6, by = node.y - bh - 6;
        ctx.globalAlpha = alpha * 0.92;
        ctx.fillStyle = '#1e293b'; ctx.strokeStyle = opinionColor(node.opinionAnim); ctx.lineWidth = 1.5;
        const rr = 8;
        ctx.beginPath();
        ctx.moveTo(bx + rr, by); ctx.arcTo(bx + bw, by, bx + bw, by + bh, rr);
        ctx.arcTo(bx + bw, by + bh, bx, by + bh, rr); ctx.arcTo(bx, by + bh, bx, by, rr);
        ctx.arcTo(bx, by, bx + bw, by, rr); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e2e8f0';
        shown.forEach((ln, k) => ctx.fillText(ln, bx + pad, by + pad + lh * (k + 1) - 3));
        ctx.globalAlpha = 1;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [selected]);

  // ── Interação ──
  const toWorld = (cx: number, cy: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { scale, ox, oy } = viewRef.current;
    return { x: (cx - rect.left - ox) / scale, y: (cy - rect.top - oy) / scale };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = toWorld(e.clientX, e.clientY);
    const hit = simRef.current.find((n) => Math.hypot(n.x - x, n.y - y) <= nodeRadius(n) + 4);
    dragRef.current = { id: hit?.id ?? null, panning: !hit, lastX: e.clientX, lastY: e.clientY, moved: false };
    if (hit) { hit.fx = hit.x; hit.fy = hit.y; }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (Math.abs(e.clientX - d.lastX) + Math.abs(e.clientY - d.lastY) > 3) d.moved = true;
    if (d.id) {
      const { x, y } = toWorld(e.clientX, e.clientY);
      const n = simRef.current.find((s) => s.id === d.id);
      if (n) { n.fx = x; n.fy = y; n.x = x; n.y = y; }
    } else if (d.panning) {
      viewRef.current.ox += e.clientX - d.lastX; viewRef.current.oy += e.clientY - d.lastY;
      d.lastX = e.clientX; d.lastY = e.clientY;
    }
  };
  const onPointerUp = () => {
    const d = dragRef.current;
    if (d.id) {
      const n = simRef.current.find((s) => s.id === d.id);
      if (n) { n.fx = null; n.fy = null; }
      if (!d.moved) setSelected((s) => (s === d.id ? null : d.id)); // clique = selecionar
    }
    dragRef.current = { id: null, panning: false, lastX: 0, lastY: 0, moved: false };
  };
  const onWheel = (e: React.WheelEvent) => {
    const v = viewRef.current;
    v.scale = Math.max(0.4, Math.min(2.5, v.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
  };

  // ── API ──
  const apiError = async (res: Response): Promise<string> => {
    const j = await res.json().catch(() => ({}));
    if (res.status === 503) return 'IA não configurada no servidor (defina OPENAI_API_KEY ou CLAUDE_API_KEY).';
    if (res.status === 402) return 'Orçamento de IA da campanha esgotado.';
    if (res.status === 429) return 'Muitas chamadas em sequência. Aguarde alguns segundos e tente de novo.';
    // Inclui o detalhe do provedor (quando houver) pra diagnóstico — ex.: modelo
    // inválido, chave sem crédito, etc.
    return [j?.error, j?.detail].filter(Boolean).join(' — ') || 'Erro inesperado.';
  };
  const currentOpinion = (id: string): number => {
    for (let i = transcript.length - 1; i >= 0; i--) {
      const a = transcript[i].agents.find((x) => x.id === id);
      if (a) return a.opinion;
    }
    return nodes.find((n) => n.id === id)?.opinion ?? 0;
  };

  const seedAgents = async () => {
    setError(null); setPhase('seed');
    try {
      const res = await authedFetch('/api/v1/scenarios/graph-seed');
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Erro ao semear');
      if (!j.nodes?.length) { setError('Sem dados suficientes — cadastre contatos/adversários na Inteligência.'); return; }
      setNodes(j.nodes.slice(0, 14)); setEdges(j.edges ?? []);
      setTranscript([]); setReport(null); setHasPersonas(false); setLabel('Simulação (dados reais)');
    } catch (e: any) { setError(e.message); }
    finally { setPhase(null); }
  };

  const ensurePersonas = async (): Promise<GraphNode[]> => {
    if (hasPersonas) return nodes;
    setPhase('personas');
    const res = await authedFetch('/api/v1/scenarios/debate/personas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: nodes.map(({ id, label, type, stubborn, opinion }) => ({ id, label, type, stubborn, opinion })) }),
    });
    if (!res.ok) throw new Error(await apiError(res));
    const j = await res.json();
    const personas: any[] = j.personas ?? [];
    const merged = nodes.map((n) => {
      const p = personas.find((x) => x.id === n.id);
      return p ? { ...n, persona: p.persona, opinion: p.opinion ?? n.opinion, voteIntention: p.voteIntention } : n;
    });
    setNodes(merged); setHasPersonas(true);
    return merged;
  };

  const runDebate = async () => {
    if (!scenario.trim()) { setError('Descreva o cenário antes de rodar.'); return; }
    setError(null); setReport(null); abortRef.current = false;
    try {
      const withPersonas = await ensurePersonas();
      let acc: DebateTurn[] = [];
      setTranscript([]);
      for (let t = 1; t <= turns; t++) {
        if (abortRef.current) break;
        setPhase(`turn-${t}`);
        const prior = acc[acc.length - 1] ?? null;
        const personasPayload = withPersonas.map((n) => ({
          id: n.id, label: n.label, type: n.type, stubborn: n.stubborn,
          persona: n.persona ?? '', opinion: currentOpinionFrom(acc, n),
        }));
        const res = await authedFetch('/api/v1/scenarios/debate/turn', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personas: personasPayload, scenario, prior, turn: t }),
        });
        if (!res.ok) throw new Error(await apiError(res));
        const j = await res.json();
        const turnAgents: TurnAgent[] = j.agents ?? [];
        // Revela falas uma a uma, animando o grafo.
        for (const a of turnAgents) {
          if (abortRef.current) break;
          speakerRef.current = a.id;
          bubblesRef.current.set(a.id, { text: a.utterance, born: performance.now() });
          const sn = simRef.current.find((s) => s.id === a.id);
          if (sn) sn.opinion = a.opinion;
          updateStats();
          await delay(750);
        }
        speakerRef.current = null;
        acc = [...acc, { turn: t, agents: turnAgents }];
        setTranscript(acc);
      }
    } catch (e: any) { setError(e.message); }
    finally { setPhase(null); speakerRef.current = null; }
  };

  const currentOpinionFrom = (acc: DebateTurn[], n: GraphNode): number => {
    for (let i = acc.length - 1; i >= 0; i--) {
      const a = acc[i].agents.find((x) => x.id === n.id);
      if (a) return a.opinion;
    }
    return n.opinion ?? DEFAULT_OPINION[n.type] ?? 0;
  };
  const updateStats = () => {
    let apoio = 0, neutro = 0, oposicao = 0;
    simRef.current.forEach((n) => {
      const o = n.opinion ?? 0;
      if (o > 0.2) apoio++; else if (o < -0.2) oposicao++; else neutro++;
    });
    setStats({ apoio, neutro, oposicao });
  };

  const genReport = async () => {
    if (!transcript.length) return;
    setError(null); setPhase('report');
    try {
      const personasPayload = nodes.map((n) => ({ id: n.id, label: n.label, type: n.type, stubborn: n.stubborn, persona: n.persona ?? '', opinion: n.opinion ?? 0 }));
      const res = await authedFetch('/api/v1/scenarios/debate/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, personas: personasPayload, transcript }),
      });
      if (!res.ok) throw new Error(await apiError(res));
      const j = await res.json();
      setReport(j.report ?? '');
    } catch (e: any) { setError(e.message); }
    finally { setPhase(null); }
  };

  const save = async () => {
    setPhase('save'); setError(null);
    try {
      const nodesOut = nodes.map((n) => ({ ...n, opinion: currentOpinion(n.id) }));
      const gRes = await authedFetch('/api/v1/scenarios/graphs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: nodesOut, edges, label }),
      });
      if (!gRes.ok) throw new Error(await apiError(gRes));
      if (transcript.length) {
        await authedFetch('/api/v1/scenarios/debate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: scenario.slice(0, 60) || label, scenario, agents: nodesOut, transcript, report, turns: transcript.length }),
        });
      }
      authedFetch('/api/v1/scenarios/graphs').then((r) => r.json()).then((j) => setSavedGraphs(j.graphs ?? [])).catch(() => {});
    } catch (e: any) { setError(e.message); }
    finally { setPhase(null); }
  };

  const loadGraph = (g: { label: string; nodes: GraphNode[]; edges: GraphEdge[] }) => {
    setLabel(g.label); setNodes(g.nodes.map((n) => ({ ...n, opinion: n.opinion ?? DEFAULT_OPINION[n.type] ?? 0 })));
    setEdges(g.edges); setTranscript([]); setReport(null); setHasPersonas(g.nodes.some((n) => n.persona));
  };

  // Editor
  const addNode = () => setNodes((p) => [...p, { id: `n${Date.now()}`, label: 'Novo Nó', type: 'voter_group', opinion: 0 }]);
  const removeNode = (id: string) => { setNodes((p) => p.filter((n) => n.id !== id)); setEdges((p) => p.filter((e) => e.source !== id && e.target !== id)); };
  const addEdge = () => { if (nodes.length >= 2) setEdges((p) => [...p, { source: nodes[0].id, target: nodes[1].id, type: 'neutral' }]); };
  const patchNode = (id: string, patch: Partial<GraphNode>) => setNodes((p) => p.map((n) => (n.id === id ? { ...n, ...patch } : n)));

  // Chat com agente selecionado
  const sendChat = async () => {
    const n = nodes.find((x) => x.id === selected);
    if (!n || !chatInput.trim()) return;
    const msg = chatInput.trim(); setChatInput('');
    const hist = chatHist[n.id] ?? [];
    setChatHist((h) => ({ ...h, [n.id]: [...hist, { role: 'user', text: msg }] }));
    setChatBusy(true);
    try {
      const res = await authedFetch('/api/v1/scenarios/debate/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: { ...n, persona: n.persona ?? '', opinion: currentOpinion(n.id) }, scenario, history: hist, message: msg }),
      });
      if (!res.ok) throw new Error(await apiError(res));
      const j = await res.json();
      setChatHist((h) => ({ ...h, [n.id]: [...(h[n.id] ?? []), { role: 'agent', text: j.reply ?? '...' }] }));
    } catch (e: any) {
      setChatHist((h) => ({ ...h, [n.id]: [...(h[n.id] ?? []), { role: 'agent', text: `(erro: ${e.message})` }] }));
    } finally { setChatBusy(false); }
  };

  const running = phase?.startsWith('turn-');
  const selectedNode = nodes.find((n) => n.id === selected);

  return (
    <div className="space-y-4">
      <Card>
        {/* Controles */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <Network className="w-4 h-4 text-indigo-400 shrink-0" />
            <input className="text-sm font-semibold bg-transparent border-b border-slate-600 focus:border-indigo-500 focus:outline-none text-slate-200 pb-0.5 min-w-0"
              value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={seedAgents} disabled={!!phase}>
              {phase === 'seed' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Database className="w-3 h-3 mr-1" />}
              Semear (dados reais)
            </Button>
            {savedGraphs.length > 0 && (
              <select className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-slate-300" defaultValue=""
                onChange={(e) => { const g = savedGraphs.find((x) => x.id === e.target.value); if (g) loadGraph(g); }}>
                <option value="" disabled>Carregar salvo…</option>
                {savedGraphs.map((g) => <option key={g.id} value={g.id}>{g.label} ({g.nodes?.length ?? 0})</option>)}
              </select>
            )}
            <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={save} disabled={!!phase}>
              {phase === 'save' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
              Salvar
            </Button>
          </div>
        </div>

        <textarea
          className="w-full text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 resize-none mb-3"
          rows={2}
          placeholder="Descreva o cenário (ex.: 'Estourou uma denúncia contra o adversário' ou 'O candidato propõe transporte grátis')…"
          value={scenario} onChange={(e) => setScenario(e.target.value)}
        />

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Button variant="primary" className="text-xs px-4 py-1.5" onClick={runDebate} disabled={!!phase}>
            {running ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
            {phase === 'personas' ? 'Gerando personas…' : running ? `Turno ${phase?.split('-')[1]}/${turns}…` : 'Rodar simulação'}
          </Button>
          <label className="text-xs text-slate-500 flex items-center gap-1">
            Turnos
            <select className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-300" value={turns} onChange={(e) => setTurns(Number(e.target.value))} disabled={!!phase}>
              {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {transcript.length > 0 && (
            <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={genReport} disabled={!!phase}>
              {phase === 'report' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <FileText className="w-3 h-3 mr-1" />}
              Relatório
            </Button>
          )}
          <span className="text-xs text-slate-500 flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {nodes.length}</span>
          <button onClick={() => setShowEditor((s) => !s)} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 ml-auto">
            Editar agentes <ChevronDown className={`w-3 h-3 transition-transform ${showEditor ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Palco: grafo + painel da persona */}
        <div className="relative">
          <canvas
            ref={canvasRef}
            className="w-full rounded-xl border border-slate-700 touch-none cursor-grab active:cursor-grabbing"
            style={{ height: 420 }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onWheel={onWheel}
          />

          {/* HUD stats */}
          <div className="absolute top-2 left-2 flex items-center gap-3 text-[11px] font-semibold bg-slate-900/70 rounded-lg px-2.5 py-1">
            <span className="text-emerald-400">{stats.apoio} apoio</span>
            <span className="text-slate-400">{stats.neutro} neutro</span>
            <span className="text-red-400">{stats.oposicao} oposição</span>
          </div>

          {/* Painel da persona selecionada + chat */}
          {selectedNode && (
            <div className="absolute top-2 right-2 w-64 max-h-[396px] overflow-y-auto bg-slate-900/95 border border-slate-700 rounded-xl p-3 shadow-xl">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  <p className="text-sm font-bold text-slate-100">{selectedNode.label}</p>
                  <p className="text-[10px] text-slate-500">{NODE_TYPE_LABELS[selectedNode.type]}{selectedNode.stubborn ? ' · âncora' : ''}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-slate-300"><X className="w-3.5 h-3.5" /></button>
              </div>
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden mb-2">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${((currentOpinion(selectedNode.id) + 1) / 2) * 100}%`, backgroundColor: opinionColor(currentOpinion(selectedNode.id)) }} />
              </div>
              {selectedNode.persona
                ? <p className="text-[11px] text-slate-400 mb-2">{selectedNode.persona}</p>
                : <p className="text-[11px] text-slate-600 italic mb-2">Persona ainda não gerada — rode a simulação.</p>}

              {selectedNode.persona && (
                <>
                  <div className="space-y-1 max-h-40 overflow-y-auto mb-1.5">
                    {(chatHist[selectedNode.id] ?? []).map((m, i) => (
                      <p key={i} className={`text-[11px] ${m.role === 'user' ? 'text-indigo-300' : 'text-slate-300'}`}>
                        <span className="font-semibold">{m.role === 'user' ? 'Você: ' : `${selectedNode.label}: `}</span>{m.text}
                      </p>
                    ))}
                    {chatBusy && <Loader2 className="w-3 h-3 animate-spin text-slate-500" />}
                  </div>
                  <div className="flex gap-1.5">
                    <input className="flex-1 text-[11px] bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500"
                      placeholder="Pergunte a este agente…" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }} />
                    <button onClick={sendChat} disabled={chatBusy} className="text-indigo-400 hover:text-indigo-300 disabled:opacity-40"><Send className="w-3.5 h-3.5" /></button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <p className="text-[11px] text-slate-500 mt-2">
          Clique num agente pra ver a persona e conversar · arraste · scroll = zoom · arraste o fundo = mover.
        </p>
        {error && <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 mt-2">{error}</p>}

        {/* Editor (colapsável) */}
        {showEditor && (
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4 border-t border-slate-700 pt-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-400">Agentes</p>
                <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={addNode}><Plus className="w-3 h-3 inline mr-1" />Adicionar</button>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {nodes.map((n) => (
                  <div key={n.id} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: NODE_RING[n.type] }} />
                    <input className="flex-1 min-w-0 text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500" value={n.label} onChange={(e) => patchNode(n.id, { label: e.target.value })} />
                    <select className="text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300" value={n.type} onChange={(e) => patchNode(n.id, { type: e.target.value as GraphNode['type'], stubborn: DEFAULT_STUBBORN[e.target.value] })}>
                      {NODE_TYPES.map((t) => <option key={t} value={t}>{NODE_TYPE_LABELS[t]}</option>)}
                    </select>
                    <button className="text-slate-600 hover:text-red-400 shrink-0" onClick={() => removeNode(n.id)}><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-400">Conexões</p>
                <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={addEdge}><Plus className="w-3 h-3 inline mr-1" />Adicionar</button>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {edges.map((e, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <select className="flex-1 min-w-0 text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300" value={e.source} onChange={(ev) => setEdges((p) => p.map((x, j) => (j === i ? { ...x, source: ev.target.value } : x)))}>
                      {nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                    </select>
                    <select className="text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300" value={e.type} onChange={(ev) => setEdges((p) => p.map((x, j) => (j === i ? { ...x, type: ev.target.value as GraphEdge['type'] } : x)))}>
                      {EDGE_TYPES.map((t) => <option key={t} value={t}>{EDGE_TYPE_LABELS[t]}</option>)}
                    </select>
                    <select className="flex-1 min-w-0 text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300" value={e.target} onChange={(ev) => setEdges((p) => p.map((x, j) => (j === i ? { ...x, target: ev.target.value } : x)))}>
                      {nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                    </select>
                    <button className="text-slate-600 hover:text-red-400 shrink-0" onClick={() => setEdges((p) => p.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Transcrição */}
      {transcript.length > 0 && (
        <Card>
          <h3 className="text-xs font-semibold text-slate-400 mb-3 flex items-center gap-2"><MessageSquare className="w-3.5 h-3.5 text-indigo-400" /> Debate</h3>
          <div className="space-y-4">
            {transcript.map((t) => (
              <div key={t.turn}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1.5">Turno {t.turn}</p>
                <div className="space-y-1.5">
                  {t.agents.map((a) => {
                    const n = nodes.find((x) => x.id === a.id);
                    return (
                      <div key={a.id} className="flex items-start gap-2">
                        <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: opinionColor(a.opinion) }} />
                        <p className="text-sm text-slate-300"><span className="font-semibold text-slate-200">{n?.label ?? a.id}:</span> {a.utterance}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Relatório */}
      {report && (
        <Card>
          <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-indigo-400" /> Relatório do debate</h3>
          <div className="space-y-1.5 text-sm text-slate-300">
            {report.split('\n').map((line, i) => {
              const t = line.trim();
              if (!t) return <div key={i} className="h-1" />;
              const html = t.replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-100">$1</strong>');
              if (/^#{1,6}\s/.test(t)) return <p key={i} className="text-slate-100 font-bold mt-2" dangerouslySetInnerHTML={{ __html: html.replace(/^#{1,6}\s/, '') }} />;
              if (/^[-*]\s/.test(t)) return <p key={i} className="pl-3 text-slate-400" dangerouslySetInnerHTML={{ __html: '• ' + html.replace(/^[-*]\s/, '') }} />;
              return <p key={i} dangerouslySetInnerHTML={{ __html: html }} />;
            })}
          </div>
          <p className="text-[10px] text-amber-400/80 mt-3">⚠ Simulação hipotética para estratégia interna — não é pesquisa eleitoral.</p>
        </Card>
      )}
    </div>
  );
};

export default ScenarioSimulator;
