import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import {
  Play, Database, Save, Loader2, FileText, Send, X, ChevronDown, Sparkles, Users, Info,
} from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { useScenarioStore, type Agent, type Edge, type DebateTurn } from '../../stores/useScenarioStore';

/**
 * SIMULAÇÃO — grafo VIVO de população (estilo MiroFish).
 *
 * Além dos agentes nomeados (âncoras vindas de dados reais — candidato, adversários,
 * lideranças, segmentos de eleitores), geramos uma MULTIDÃO de cidadãos. A rede se
 * auto-organiza por HOMOFILIA: quem pensa parecido se atrai e cria laços; quem é
 * muito diferente se repele. Clusters/“bolhas” de opinião emergem sozinhos. O
 * debate por IA empurra a opinião das âncoras e a multidão migra e se reorganiza
 * ao vivo. Estado persiste em store (não some ao trocar de aba / F5).
 */

interface P {
  id: string; kind: 'anchor' | 'citizen';
  label: string; type: Agent['type'] | 'citizen';
  segment?: string; stubborn?: boolean; persona?: string;
  opinion: number; opinionAnim: number; weight: number;
  x: number; y: number; vx: number; vy: number; fx?: number | null; fy?: number | null;
}
interface Link { a: string; b: string; w: number; explicit?: boolean; etype?: Edge['type']; }

const NODE_RING: Record<string, string> = {
  candidate: '#818cf8', leader: '#34d399', voter_group: '#fbbf24', opponent: '#f87171', ally: '#22d3ee',
};
const EDGE_COLORS: Record<string, string> = { support: '#10b981', opposition: '#ef4444', neutral: '#64748b', undecided: '#f59e0b' };
const NODE_TYPES: Agent['type'][] = ['candidate', 'leader', 'voter_group', 'opponent', 'ally'];
const EDGE_TYPES: Edge['type'][] = ['support', 'opposition', 'neutral', 'undecided'];
const NODE_TYPE_LABELS: Record<string, string> = { candidate: 'Candidato', leader: 'Liderança', voter_group: 'Grupo de Eleitores', opponent: 'Adversário', ally: 'Aliado' };
const EDGE_TYPE_LABELS: Record<string, string> = { support: 'Apoio', opposition: 'Oposição', neutral: 'Neutro', undecided: 'Indefinido' };
const DEFAULT_OPINION: Record<string, number> = { candidate: 1, ally: 0.7, leader: 0.6, voter_group: 0, opponent: -1 };

// Homofilia/física
const SIM_THRESH = 0.5;   // |Δopinião| < isto → afinidade (atrai); acima → repele
const LINK_CONF = 0.38;   // confiança p/ formar laço entre cidadãos
const REWIRE_EVERY = 26;  // frames entre recomputar laços+influência

function opinionColor(o: number, alpha = 1): string {
  const t = Math.max(-1, Math.min(1, o));
  const neg = [239, 68, 68], mid = [148, 163, 184], pos = [16, 185, 129];
  const lerp = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const rgb = t < 0 ? lerp(mid, neg, -t) : lerp(mid, pos, t);
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}
function anchorRadius(p: P): number {
  const base = p.type === 'candidate' ? 18 : p.type === 'opponent' ? 16 : p.type === 'voter_group' ? 13 : 12;
  return base + Math.min(9, Math.log2((p.weight ?? 1) + 1) * 2.2);
}
function randn() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const clampO = (v: number) => Math.max(-1, Math.min(1, v));
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const ScenarioSimulator: React.FC = () => {
  const store = useScenarioStore();
  const { label, scenario, nodes, edges, transcript, report, population } = store;

  const [turns, setTurns] = React.useState(3);
  const [phase, setPhase] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [stats, setStats] = React.useState({ apoio: 0, neutro: 0, oposicao: 0 });
  const [selected, setSelected] = React.useState<string | null>(null);
  const [showEditor, setShowEditor] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);
  const [savedGraphs, setSavedGraphs] = React.useState<Array<{ id: string; label: string; nodes: Agent[]; edges: Edge[] }>>([]);
  const [chatHist, setChatHist] = React.useState<Record<string, Array<{ role: 'user' | 'agent'; text: string }>>>({});
  const [chatInput, setChatInput] = React.useState('');
  const [chatBusy, setChatBusy] = React.useState(false);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const partsRef = React.useRef<Map<string, P>>(new Map());
  const linksRef = React.useRef<Link[]>([]);
  const viewRef = React.useRef({ scale: 1, ox: 0, oy: 0 });
  const dragRef = React.useRef<{ id: string | null; panning: boolean; lastX: number; lastY: number; moved: boolean }>({ id: null, panning: false, lastX: 0, lastY: 0, moved: false });
  const bubblesRef = React.useRef<Map<string, { text: string; born: number }>>(new Map());
  const speakerRef = React.useRef<string | null>(null);
  const edgesRef = React.useRef(edges);
  const abortRef = React.useRef(false);
  React.useEffect(() => { edgesRef.current = edges; }, [edges]);

  React.useEffect(() => {
    authedFetch('/api/v1/scenarios/graphs').then((r) => (r.ok ? r.json() : { graphs: [] })).then((j) => setSavedGraphs(j.graphs ?? [])).catch(() => {});
  }, []);

  const W = 660, H = 440;

  // Sincroniza ÂNCORAS (store.nodes) → partículas, preservando posição. Roda quando
  // os nós mudam (inclui debate atualizando opinião → só ajusta o alvo).
  React.useEffect(() => {
    const m = partsRef.current;
    const keep = new Set<string>();
    nodes.forEach((n, i) => {
      keep.add(n.id);
      const o = n.opinion ?? DEFAULT_OPINION[n.type] ?? 0;
      const ex = m.get(n.id);
      if (ex && ex.kind === 'anchor') {
        ex.label = n.label; ex.type = n.type; ex.stubborn = n.stubborn; ex.persona = n.persona; ex.opinion = o; ex.weight = n.weight ?? 1;
      } else {
        const a = (2 * Math.PI * i) / Math.max(1, nodes.length);
        m.set(n.id, { id: n.id, kind: 'anchor', label: n.label, type: n.type, stubborn: n.stubborn, persona: n.persona, opinion: o, opinionAnim: o, weight: n.weight ?? 1, x: W / 2 + Math.cos(a) * 150, y: H / 2 + Math.sin(a) * 150, vx: 0, vy: 0 });
      }
    });
    // remove âncoras que saíram
    for (const [id, p] of m) if (p.kind === 'anchor' && !keep.has(id)) m.delete(id);
  }, [nodes]);

  // (Re)gera a MULTIDÃO só quando muda o conjunto de segmentos ou o tamanho —
  // NÃO quando só a opinião das âncoras muda (pra não resetar no meio do debate).
  const segments = nodes.filter((n) => n.type === 'voter_group');
  const segKey = segments.map((s) => s.id).join(',') + '|' + population;
  React.useEffect(() => {
    const m = partsRef.current;
    for (const [id, p] of m) if (p.kind === 'citizen') m.delete(id);
    const segs = segments.length ? segments : [{ id: 'cand', label: 'Base', type: 'voter_group', opinion: 0.3, weight: 1 } as Agent];
    const totalW = segs.reduce((s, x) => s + (x.weight ?? 1), 0) || 1;
    let idx = 0;
    segs.forEach((seg) => {
      const k = Math.max(3, Math.round((population * (seg.weight ?? 1)) / totalW));
      const base = seg.opinion ?? 0;
      for (let i = 0; i < k; i++) {
        const op = clampO(base + randn() * 0.22);
        const ang = Math.random() * Math.PI * 2, rad = 40 + Math.random() * 150;
        m.set(`cz${idx}`, { id: `cz${idx}`, kind: 'citizen', label: '', type: 'citizen', segment: seg.id, opinion: op, opinionAnim: op, weight: 1, x: W / 2 + Math.cos(ang) * rad, y: H / 2 + Math.sin(ang) * rad, vx: 0, vy: 0 });
        idx++;
      }
    });
    // alguns indecisos "soltos"
    const floaters = Math.round(population * 0.08);
    for (let i = 0; i < floaters; i++) {
      const op = clampO(randn() * 0.3);
      m.set(`fz${idx}`, { id: `fz${idx}`, kind: 'citizen', label: '', type: 'citizen', opinion: op, opinionAnim: op, weight: 1, x: W / 2 + randn() * 120, y: H / 2 + randn() * 120, vx: 0, vy: 0 });
      idx++;
    }
    linksRef.current = [];
  }, [segKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Loop de animação.
  React.useEffect(() => {
    let raf = 0, frame = 0;
    const step = () => {
      const canvas = canvasRef.current;
      if (!canvas) { raf = requestAnimationFrame(step); return; }
      const ctx = canvas.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(step); return; }
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth || W, cssH = H;
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      }
      const parts = [...partsRef.current.values()];
      const byId = partsRef.current;
      frame++;

      // ── Recomputar laços (homofilia) + influência, periodicamente ──
      if (frame % REWIRE_EVERY === 0) {
        const links: Link[] = [];
        const citizens = parts.filter((p) => p.kind === 'citizen');
        const anchors = parts.filter((p) => p.kind === 'anchor');
        // laços explícitos entre âncoras
        for (const e of edgesRef.current) {
          if (byId.has(e.source) && byId.has(e.target)) links.push({ a: e.source, b: e.target, w: 1.4, explicit: true, etype: e.type });
        }
        for (const c of citizens) {
          // laço com a âncora do segmento (puxa o cidadão pro seu grupo)
          if (c.segment && byId.has(c.segment)) links.push({ a: c.id, b: c.segment, w: 0.7 });
          // até 3 vizinhos parecidos e próximos
          const cand = parts
            .filter((o) => o.id !== c.id && Math.abs(o.opinion - c.opinion) < LINK_CONF)
            .map((o) => ({ o, d: (o.x - c.x) ** 2 + (o.y - c.y) ** 2 }))
            .sort((a, b) => a.d - b.d).slice(0, 3);
          for (const { o } of cand) links.push({ a: c.id, b: o.id, w: 0.5 });
        }
        linksRef.current = links;
        // Influência (confiança limitada): cidadãos migram p/ a média dos laços + âncora de segmento.
        for (const c of citizens) {
          let sum = 0, n = 0;
          for (const l of links) {
            const other = l.a === c.id ? byId.get(l.b) : l.b === c.id ? byId.get(l.a) : null;
            if (other) { sum += other.opinion * (other.kind === 'anchor' ? 2 : 1); n += (other.kind === 'anchor' ? 2 : 1); }
          }
          if (n) c.opinion = clampO(c.opinion + ((sum / n) - c.opinion) * 0.06);
        }
        void anchors;
      }

      // ── Física: homofilia (semelhante atrai, diferente repele) ──
      const K_REP = 950, K_ATT = 0.0016, CENTER = 0.004, DAMP = 0.9;
      for (let i = 0; i < parts.length; i++) {
        const a = parts[i];
        a.opinionAnim += (a.opinion - a.opinionAnim) * 0.07;
        if (a.fx != null) continue;
        let ax = 0, ay = 0;
        for (let j = 0; j < parts.length; j++) {
          if (i === j) continue;
          const b = parts[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { d2 = 1; dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
          const d = Math.sqrt(d2);
          const diff = Math.abs(a.opinion - b.opinion);     // 0 (igual) .. 2 (oposto)
          const affinity = SIM_THRESH - diff;               // >0 parecido, <0 diferente
          // repulsão base (anti-sobreposição) + repulsão extra p/ diferentes
          const rep = (K_REP * (diff > SIM_THRESH ? 1.8 : 0.6)) / d2;
          ax += (dx / d) * rep; ay += (dy / d) * rep;
          // atração entre parecidos (homofilia) quando estão longe
          if (affinity > 0 && d > 60) {
            const att = affinity * K_ATT * d;
            ax -= (dx / d) * att; ay -= (dy / d) * att;
          }
        }
        ax += (cssW / 2 - a.x) * CENTER; ay += (cssH / 2 - a.y) * CENTER;
        a.vx = (a.vx + ax) * DAMP; a.vy = (a.vy + ay) * DAMP;
      }
      // molas dos laços
      for (const l of linksRef.current) {
        const a = byId.get(l.a), b = byId.get(l.b);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const target = l.explicit ? 95 : 55;
        const f = (d - target) * 0.012 * l.w;
        if (a.fx == null) { a.vx += (dx / d) * f; a.vy += (dy / d) * f; }
        if (b.fx == null) { b.vx -= (dx / d) * f; b.vy -= (dy / d) * f; }
      }
      for (const a of parts) { if (a.fx != null) { a.x = a.fx!; a.y = a.fy!; } else { a.x += a.vx; a.y += a.vy; } }

      // ── Render ──
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      const bg = ctx.createLinearGradient(0, 0, 0, cssH); bg.addColorStop(0, '#0a0f1d'); bg.addColorStop(1, '#0b1120');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, cssW, cssH);
      const { scale, ox, oy } = viewRef.current;
      ctx.translate(ox, oy); ctx.scale(scale, scale);
      const speaker = speakerRef.current;

      // laços
      for (const l of linksRef.current) {
        const a = byId.get(l.a), b = byId.get(l.b);
        if (!a || !b) continue;
        if (l.explicit) { ctx.strokeStyle = EDGE_COLORS[l.etype ?? 'neutral']; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.6; }
        else { ctx.strokeStyle = opinionColor((a.opinionAnim + b.opinionAnim) / 2, 1); ctx.globalAlpha = 0.13; ctx.lineWidth = 1; }
        const hot = speaker && (l.a === speaker || l.b === speaker);
        if (hot) { ctx.globalAlpha = 0.9; ctx.lineWidth = 2; }
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // cidadãos
      for (const p of parts) {
        if (p.kind !== 'citizen') continue;
        ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = opinionColor(p.opinionAnim, 0.92); ctx.fill();
      }
      // âncoras
      let apoio = 0, neutro = 0, oposicao = 0;
      for (const p of parts) {
        const o = p.opinionAnim;
        if (o > 0.2) apoio++; else if (o < -0.2) oposicao++; else neutro++;
        if (p.kind !== 'anchor') continue;
        const r = anchorRadius(p); const col = opinionColor(p.opinionAnim);
        const speaking = p.id === speaker, sel = p.id === selected;
        const gR = r * (speaking ? 3 : 2.2);
        const g = ctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, gR);
        g.addColorStop(0, opinionColor(p.opinionAnim, 0.6)); g.addColorStop(1, 'rgba(11,17,32,0)');
        ctx.globalAlpha = speaking ? 0.85 : 0.5; ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, gR, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
        ctx.lineWidth = sel ? 3.5 : 2.5; ctx.strokeStyle = sel ? '#fff' : (NODE_RING[p.type] ?? '#64748b'); ctx.stroke();
        if (p.stubborn) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); }
        ctx.fillStyle = '#e2e8f0'; ctx.font = '600 11px Inter, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(p.label.slice(0, 16), p.x, p.y + r + 12);
      }

      // balões
      ctx.textAlign = 'left';
      const now = performance.now();
      for (const [id, b] of bubblesRef.current) {
        const node = byId.get(id); const age = now - b.born;
        if (!node || age > 6500) { bubblesRef.current.delete(id); continue; }
        const alpha = age > 5000 ? 1 - (age - 5000) / 1500 : 1;
        const maxW = 160, pad = 7, lh = 13, fs = 11;
        ctx.font = `${fs}px Inter, sans-serif`;
        const words = b.text.split(' '); const lines: string[] = []; let cur = '';
        for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW - pad * 2 && cur) { lines.push(cur); cur = w; } else cur = t; }
        if (cur) lines.push(cur);
        const shown = lines.slice(0, 4); const bw = maxW, bh = shown.length * lh + pad * 2;
        const bx = node.x + anchorRadius(node) + 6, by = node.y - bh - 6;
        ctx.globalAlpha = alpha * 0.94; ctx.fillStyle = '#1e293b'; ctx.strokeStyle = opinionColor(node.opinionAnim); ctx.lineWidth = 1.5;
        const rr = 8;
        ctx.beginPath(); ctx.moveTo(bx + rr, by); ctx.arcTo(bx + bw, by, bx + bw, by + bh, rr); ctx.arcTo(bx + bw, by + bh, bx, by + bh, rr); ctx.arcTo(bx, by + bh, bx, by, rr); ctx.arcTo(bx, by, bx + bw, by, rr); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e2e8f0'; shown.forEach((ln, k) => ctx.fillText(ln, bx + pad, by + pad + lh * (k + 1) - 3));
        ctx.globalAlpha = 1;
      }

      if (frame % 12 === 0) setStats({ apoio, neutro, oposicao });
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
    // só âncoras são "clicáveis"/arrastáveis (cidadãos são multidão)
    const hit = [...partsRef.current.values()].find((p) => p.kind === 'anchor' && Math.hypot(p.x - x, p.y - y) <= anchorRadius(p) + 4);
    dragRef.current = { id: hit?.id ?? null, panning: !hit, lastX: e.clientX, lastY: e.clientY, moved: false };
    if (hit) { hit.fx = hit.x; hit.fy = hit.y; }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (Math.abs(e.clientX - d.lastX) + Math.abs(e.clientY - d.lastY) > 3) d.moved = true;
    if (d.id) { const { x, y } = toWorld(e.clientX, e.clientY); const n = partsRef.current.get(d.id); if (n) { n.fx = x; n.fy = y; n.x = x; n.y = y; } }
    else if (d.panning) { viewRef.current.ox += e.clientX - d.lastX; viewRef.current.oy += e.clientY - d.lastY; d.lastX = e.clientX; d.lastY = e.clientY; }
  };
  const onPointerUp = () => {
    const d = dragRef.current;
    if (d.id) { const n = partsRef.current.get(d.id); if (n) { n.fx = null; n.fy = null; } if (!d.moved) setSelected((s) => (s === d.id ? null : d.id)); }
    dragRef.current = { id: null, panning: false, lastX: 0, lastY: 0, moved: false };
  };
  const onWheel = (e: React.WheelEvent) => { const v = viewRef.current; v.scale = Math.max(0.4, Math.min(2.5, v.scale * (e.deltaY < 0 ? 1.1 : 0.9))); };

  // ── API ──
  const apiError = async (res: Response): Promise<string> => {
    const j = await res.json().catch(() => ({}));
    if (res.status === 503) return 'IA não configurada no servidor (defina OPENAI_API_KEY ou CLAUDE_API_KEY).';
    if (res.status === 402) return 'Orçamento de IA da campanha esgotado.';
    if (res.status === 429) return 'Muitas chamadas em sequência. Aguarde alguns segundos e tente de novo.';
    return [j?.error, j?.detail].filter(Boolean).join(' — ') || 'Erro inesperado.';
  };
  const currentOpinion = (id: string): number => {
    for (let i = transcript.length - 1; i >= 0; i--) { const a = transcript[i].agents.find((x) => x.id === id); if (a) return a.opinion; }
    return nodes.find((n) => n.id === id)?.opinion ?? 0;
  };

  const seedAgents = async () => {
    setError(null); setPhase('seed');
    try {
      const res = await authedFetch('/api/v1/scenarios/graph-seed'); const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Erro ao semear');
      if (!j.nodes?.length) { setError('Sem dados suficientes — cadastre contatos/adversários na Inteligência.'); return; }
      store.setGraph(j.nodes.slice(0, 14), j.edges ?? []); store.setLabel('Simulação (dados reais)');
    } catch (e: any) { setError(e.message); } finally { setPhase(null); }
  };

  const ensurePersonas = async (): Promise<Agent[]> => {
    if (store.hasPersonas) return nodes;
    setPhase('personas');
    const res = await authedFetch('/api/v1/scenarios/debate/personas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: nodes.map(({ id, label, type, stubborn, opinion }) => ({ id, label, type, stubborn, opinion })) }),
    });
    if (!res.ok) throw new Error(await apiError(res));
    const j = await res.json(); const personas: any[] = j.personas ?? [];
    const merged = nodes.map((n) => { const p = personas.find((x) => x.id === n.id); return p ? { ...n, persona: p.persona, opinion: p.opinion ?? n.opinion, voteIntention: p.voteIntention } : n; });
    store.setNodes(merged); store.setHasPersonas(true);
    return merged;
  };

  const runDebate = async () => {
    if (!scenario.trim()) { setError('Descreva o cenário antes de rodar.'); return; }
    setError(null); store.setReport(null); abortRef.current = false;
    try {
      const withP = await ensurePersonas();
      let acc: DebateTurn[] = []; store.setTranscript([]);
      for (let t = 1; t <= turns; t++) {
        if (abortRef.current) break;
        setPhase(`turn-${t}`);
        const prior = acc[acc.length - 1] ?? null;
        const payload = withP.map((n) => ({ id: n.id, label: n.label, type: n.type, stubborn: n.stubborn, persona: n.persona ?? '', opinion: currentFrom(acc, n) }));
        const res = await authedFetch('/api/v1/scenarios/debate/turn', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personas: payload, scenario, prior, turn: t }),
        });
        if (!res.ok) throw new Error(await apiError(res));
        const j = await res.json(); const ta = j.agents ?? [];
        for (const a of ta) {
          if (abortRef.current) break;
          speakerRef.current = a.id;
          bubblesRef.current.set(a.id, { text: a.utterance, born: performance.now() });
          const sn = partsRef.current.get(a.id); if (sn) sn.opinion = a.opinion;
          await delay(850);
        }
        speakerRef.current = null;
        acc = [...acc, { turn: t, agents: ta }]; store.setTranscript(acc);
        // persiste opinião das âncoras no store (pra durar entre abas)
        store.setNodes(withP.map((n) => ({ ...n, opinion: currentFrom(acc, n) })));
      }
    } catch (e: any) { setError(e.message); } finally { setPhase(null); speakerRef.current = null; }
  };
  const currentFrom = (acc: DebateTurn[], n: Agent): number => {
    for (let i = acc.length - 1; i >= 0; i--) { const a = acc[i].agents.find((x) => x.id === n.id); if (a) return a.opinion; }
    return n.opinion ?? DEFAULT_OPINION[n.type] ?? 0;
  };

  const genReport = async () => {
    if (!transcript.length) return; setError(null); setPhase('report');
    try {
      const payload = nodes.map((n) => ({ id: n.id, label: n.label, type: n.type, stubborn: n.stubborn, persona: n.persona ?? '', opinion: n.opinion ?? 0 }));
      const res = await authedFetch('/api/v1/scenarios/debate/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario, personas: payload, transcript }) });
      if (!res.ok) throw new Error(await apiError(res));
      const j = await res.json(); store.setReport(j.report ?? '');
    } catch (e: any) { setError(e.message); } finally { setPhase(null); }
  };

  const save = async () => {
    setPhase('save'); setError(null);
    try {
      const nodesOut = nodes.map((n) => ({ ...n, opinion: currentOpinion(n.id) }));
      const g = await authedFetch('/api/v1/scenarios/graphs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes: nodesOut, edges, label }) });
      if (!g.ok) throw new Error(await apiError(g));
      if (transcript.length) await authedFetch('/api/v1/scenarios/debate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: scenario.slice(0, 60) || label, scenario, agents: nodesOut, transcript, report, turns: transcript.length }) });
      authedFetch('/api/v1/scenarios/graphs').then((r) => r.json()).then((j) => setSavedGraphs(j.graphs ?? [])).catch(() => {});
    } catch (e: any) { setError(e.message); } finally { setPhase(null); }
  };

  const loadGraph = (g: { label: string; nodes: Agent[]; edges: Edge[] }) => {
    store.setLabel(g.label); store.setGraph(g.nodes.map((n) => ({ ...n, opinion: n.opinion ?? DEFAULT_OPINION[n.type] ?? 0 })), g.edges);
  };

  const sendChat = async () => {
    const n = nodes.find((x) => x.id === selected); if (!n || !chatInput.trim()) return;
    const msg = chatInput.trim(); setChatInput('');
    const hist = chatHist[n.id] ?? []; setChatHist((h) => ({ ...h, [n.id]: [...hist, { role: 'user', text: msg }] })); setChatBusy(true);
    try {
      const res = await authedFetch('/api/v1/scenarios/debate/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona: { ...n, persona: n.persona ?? '', opinion: currentOpinion(n.id) }, scenario, history: hist, message: msg }) });
      if (!res.ok) throw new Error(await apiError(res));
      const j = await res.json(); setChatHist((h) => ({ ...h, [n.id]: [...(h[n.id] ?? []), { role: 'agent', text: j.reply ?? '...' }] }));
    } catch (e: any) { setChatHist((h) => ({ ...h, [n.id]: [...(h[n.id] ?? []), { role: 'agent', text: `(erro: ${e.message})` }] })); } finally { setChatBusy(false); }
  };

  const running = phase?.startsWith('turn-');
  const selectedNode = nodes.find((n) => n.id === selected);
  const patchNode = store.patchNode;

  return (
    <div className="space-y-4">
      <Card>
        {/* Guia + controles */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <input className="text-sm font-semibold bg-transparent border-b border-slate-600 focus:border-indigo-500 focus:outline-none text-slate-200 pb-0.5 min-w-0" value={label} onChange={(e) => store.setLabel(e.target.value)} />
          <button onClick={() => setShowHelp((s) => !s)} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
            <Info className="w-3.5 h-3.5" /> Como funciona <ChevronDown className={`w-3 h-3 transition-transform ${showHelp ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {showHelp && (
          <div className="mb-3 text-xs text-slate-400 bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-1.5">
            <p><strong className="text-slate-200">1.</strong> Clique <strong>Semear (dados reais)</strong> — vira candidato, adversários, lideranças e segmentos de eleitores, mais uma multidão de cidadãos.</p>
            <p><strong className="text-slate-200">2.</strong> Descreva um <strong>acontecimento</strong> no campo (ex.: "estourou uma denúncia contra o adversário").</p>
            <p><strong className="text-slate-200">3.</strong> Clique <strong>Rodar debate</strong>: os agentes discutem (falam em balões), a opinião muda e <strong>a multidão se reorganiza</strong> — parecidos se aproximam, diferentes se afastam, formando bolhas. Clique num agente pra conversar com ele.</p>
            <p className="text-slate-500">Verde = apoio · vermelho = oposição · cinza = neutro. Tudo é simulação hipotética pra estratégia interna.</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={seedAgents} disabled={!!phase}>
            {phase === 'seed' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Database className="w-3 h-3 mr-1" />} Semear (dados reais)
          </Button>
          {savedGraphs.length > 0 && (
            <select className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-slate-300" defaultValue="" onChange={(e) => { const g = savedGraphs.find((x) => x.id === e.target.value); if (g) loadGraph(g); }}>
              <option value="" disabled>Carregar salvo…</option>
              {savedGraphs.map((g) => <option key={g.id} value={g.id}>{g.label} ({g.nodes?.length ?? 0})</option>)}
            </select>
          )}
          <label className="text-xs text-slate-500 flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Pop.
            <select className="text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300" value={population} onChange={(e) => store.setPopulation(Number(e.target.value))} disabled={!!phase}>
              {[40, 70, 100, 140].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <Button variant="secondary" className="text-xs px-3 py-1.5 ml-auto" onClick={save} disabled={!!phase}>
            {phase === 'save' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />} Salvar
          </Button>
        </div>

        <textarea className="w-full text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 resize-none mb-2" rows={2}
          placeholder="Descreva o acontecimento (ex.: 'Estourou uma denúncia contra o adversário' ou 'O candidato propõe transporte grátis')…"
          value={scenario} onChange={(e) => store.setScenario(e.target.value)} />

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Button variant="primary" className="text-xs px-4 py-1.5" onClick={runDebate} disabled={!!phase}>
            {running ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
            {phase === 'personas' ? 'Gerando personas…' : running ? `Turno ${phase?.split('-')[1]}/${turns}…` : 'Rodar debate'}
          </Button>
          <label className="text-xs text-slate-500 flex items-center gap-1">Turnos
            <select className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-300" value={turns} onChange={(e) => setTurns(Number(e.target.value))} disabled={!!phase}>
              {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {transcript.length > 0 && (
            <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={genReport} disabled={!!phase}>
              {phase === 'report' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <FileText className="w-3 h-3 mr-1" />} Relatório
            </Button>
          )}
          <button onClick={() => setShowEditor((s) => !s)} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 ml-auto">
            Editar agentes <ChevronDown className={`w-3 h-3 transition-transform ${showEditor ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Palco vivo */}
        <div className="relative">
          <canvas ref={canvasRef} className="w-full rounded-xl border border-slate-700 touch-none cursor-grab active:cursor-grabbing" style={{ height: 440 }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onWheel={onWheel} />
          <div className="absolute top-2 left-2 flex items-center gap-3 text-[11px] font-semibold bg-slate-900/70 rounded-lg px-2.5 py-1">
            <span className="text-emerald-400">{stats.apoio} apoio</span><span className="text-slate-400">{stats.neutro} neutro</span><span className="text-red-400">{stats.oposicao} oposição</span>
          </div>
          {selectedNode && (
            <div className="absolute top-2 right-2 w-64 max-h-[416px] overflow-y-auto bg-slate-900/95 border border-slate-700 rounded-xl p-3 shadow-xl">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div><p className="text-sm font-bold text-slate-100">{selectedNode.label}</p><p className="text-[10px] text-slate-500">{NODE_TYPE_LABELS[selectedNode.type]}{selectedNode.stubborn ? ' · âncora' : ''}</p></div>
                <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-slate-300"><X className="w-3.5 h-3.5" /></button>
              </div>
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden mb-2"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${((currentOpinion(selectedNode.id) + 1) / 2) * 100}%`, backgroundColor: opinionColor(currentOpinion(selectedNode.id)) }} /></div>
              {selectedNode.persona ? <p className="text-[11px] text-slate-400 mb-2">{selectedNode.persona}</p> : <p className="text-[11px] text-slate-600 italic mb-2">Persona ainda não gerada — rode o debate.</p>}
              {selectedNode.persona && (
                <>
                  <div className="space-y-1 max-h-40 overflow-y-auto mb-1.5">
                    {(chatHist[selectedNode.id] ?? []).map((m, i) => (<p key={i} className={`text-[11px] ${m.role === 'user' ? 'text-indigo-300' : 'text-slate-300'}`}><span className="font-semibold">{m.role === 'user' ? 'Você: ' : `${selectedNode.label}: `}</span>{m.text}</p>))}
                    {chatBusy && <Loader2 className="w-3 h-3 animate-spin text-slate-500" />}
                  </div>
                  <div className="flex gap-1.5">
                    <input className="flex-1 text-[11px] bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500" placeholder="Pergunte a este agente…" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }} />
                    <button onClick={sendChat} disabled={chatBusy} className="text-indigo-400 hover:text-indigo-300 disabled:opacity-40"><Send className="w-3.5 h-3.5" /></button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <p className="text-[11px] text-slate-500 mt-2">A multidão se reorganiza sozinha por afinidade · clique num agente nomeado pra conversar · arraste · scroll = zoom.</p>
        {error && <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 mt-2">{error}</p>}

        {/* Editor colapsável */}
        {showEditor && (
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4 border-t border-slate-700 pt-4">
            <div>
              <div className="flex items-center justify-between mb-2"><p className="text-xs font-semibold text-slate-400">Agentes nomeados</p>
                <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => store.setNodes([...nodes, { id: `n${Date.now()}`, label: 'Novo', type: 'voter_group', opinion: 0, weight: 20 }])}>+ Adicionar</button></div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {nodes.map((n) => (
                  <div key={n.id} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: NODE_RING[n.type] }} />
                    <input className="flex-1 min-w-0 text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500" value={n.label} onChange={(e) => patchNode(n.id, { label: e.target.value })} />
                    <select className="text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300" value={n.type} onChange={(e) => patchNode(n.id, { type: e.target.value as Agent['type'] })}>
                      {NODE_TYPES.map((t) => <option key={t} value={t}>{NODE_TYPE_LABELS[t]}</option>)}
                    </select>
                    <button className="text-slate-600 hover:text-red-400 shrink-0" onClick={() => { store.setNodes(nodes.filter((x) => x.id !== n.id)); store.setEdges(edges.filter((e) => e.source !== n.id && e.target !== n.id)); }}><X className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2"><p className="text-xs font-semibold text-slate-400">Conexões</p>
                <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => { if (nodes.length >= 2) store.setEdges([...edges, { source: nodes[0].id, target: nodes[1].id, type: 'neutral' }]); }}>+ Adicionar</button></div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {edges.map((e, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <select className="flex-1 min-w-0 text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300" value={e.source} onChange={(ev) => store.setEdges(edges.map((x, j) => (j === i ? { ...x, source: ev.target.value } : x)))}>{nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select>
                    <select className="text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300" value={e.type} onChange={(ev) => store.setEdges(edges.map((x, j) => (j === i ? { ...x, type: ev.target.value as Edge['type'] } : x)))}>{EDGE_TYPES.map((t) => <option key={t} value={t}>{EDGE_TYPE_LABELS[t]}</option>)}</select>
                    <select className="flex-1 min-w-0 text-xs bg-slate-700 border border-slate-600 rounded px-1 py-1 text-slate-300" value={e.target} onChange={(ev) => store.setEdges(edges.map((x, j) => (j === i ? { ...x, target: ev.target.value } : x)))}>{nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select>
                    <button className="text-slate-600 hover:text-red-400 shrink-0" onClick={() => store.setEdges(edges.filter((_, j) => j !== i))}><X className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      {transcript.length > 0 && (
        <Card>
          <h3 className="text-xs font-semibold text-slate-400 mb-3">Debate</h3>
          <div className="space-y-4">
            {transcript.map((t) => (
              <div key={t.turn}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1.5">Turno {t.turn}</p>
                <div className="space-y-1.5">
                  {t.agents.map((a) => { const n = nodes.find((x) => x.id === a.id); return (
                    <div key={a.id} className="flex items-start gap-2"><span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: opinionColor(a.opinion) }} /><p className="text-sm text-slate-300"><span className="font-semibold text-slate-200">{n?.label ?? a.id}:</span> {a.utterance}</p></div>
                  ); })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {report && (
        <Card>
          <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-indigo-400" /> Relatório do debate</h3>
          <div className="space-y-1.5 text-sm text-slate-300">
            {report.split('\n').map((line, i) => {
              const t = line.trim(); if (!t) return <div key={i} className="h-1" />;
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
