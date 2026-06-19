import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import {
  Bot, Database, Loader2, Play, FileText, Save, Send, Users, Sparkles, MessageSquare,
} from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';

/**
 * Debate por IA (estilo MiroFish) — agentes com persona debatem um cenário e a
 * opinião evolui por turnos. Fluxo: carregar agentes (dados reais) → descrever o
 * cenário → gerar personas → rodar debate (N turnos via LLM) → relatório → chat.
 */

interface AgentSpec { id: string; label: string; type: string; stubborn?: boolean; opinion?: number; }
interface Persona extends AgentSpec { persona: string; opinion: number; voteIntention?: string; }
interface TurnAgent { id: string; utterance: string; opinion: number; }
interface DebateTurn { turn: number; agents: TurnAgent[]; }
interface SavedGraph { id: string; label: string; nodes: AgentSpec[]; edges: unknown[] }

const TYPE_LABEL: Record<string, string> = {
  candidate: 'Candidato', opponent: 'Adversário', leader: 'Liderança',
  voter_group: 'Grupo de Eleitores', ally: 'Aliado',
};

function opinionColor(o: number): string {
  const t = Math.max(-1, Math.min(1, o));
  const neg = [239, 68, 68], mid = [100, 116, 139], pos = [16, 185, 129];
  const lerp = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const rgb = t < 0 ? lerp(mid, neg, -t) : lerp(mid, pos, t);
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

/** Render minimalista de markdown (negrito + títulos + bullets) pro relatório. */
function MarkdownLite({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-sm text-slate-300">
      {text.split('\n').map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1" />;
        const html = t.replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-100">$1</strong>');
        if (/^#{1,6}\s/.test(t)) {
          return <p key={i} className="text-slate-100 font-bold mt-2" dangerouslySetInnerHTML={{ __html: html.replace(/^#{1,6}\s/, '') }} />;
        }
        if (/^[-*]\s/.test(t)) {
          return <p key={i} className="pl-3 text-slate-400" dangerouslySetInnerHTML={{ __html: '• ' + html.replace(/^[-*]\s/, '') }} />;
        }
        return <p key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </div>
  );
}

export const AiDebate: React.FC = () => {
  const [scenario, setScenario] = React.useState('');
  const [agents, setAgents] = React.useState<AgentSpec[]>([]);
  const [personas, setPersonas] = React.useState<Persona[] | null>(null);
  const [transcript, setTranscript] = React.useState<DebateTurn[]>([]);
  const [turns, setTurns] = React.useState(3);
  const [report, setReport] = React.useState<string | null>(null);
  const [savedGraphs, setSavedGraphs] = React.useState<SavedGraph[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [savedOk, setSavedOk] = React.useState(false);

  // Chat
  const [chatId, setChatId] = React.useState<string | null>(null);
  const [chatInput, setChatInput] = React.useState('');
  const [chatHist, setChatHist] = React.useState<Record<string, Array<{ role: 'user' | 'agent'; text: string }>>>({});
  const [chatBusy, setChatBusy] = React.useState(false);

  React.useEffect(() => {
    authedFetch('/api/v1/scenarios/graphs')
      .then((r) => (r.ok ? r.json() : { graphs: [] }))
      .then((j) => setSavedGraphs(j.graphs ?? []))
      .catch(() => { /* ignore */ });
  }, []);

  // Opinião atual de cada agente = última fala do transcript, senão a da persona.
  const currentOpinion = (id: string): number => {
    for (let i = transcript.length - 1; i >= 0; i--) {
      const a = transcript[i].agents.find((x) => x.id === id);
      if (a) return a.opinion;
    }
    return personas?.find((p) => p.id === id)?.opinion ?? agents.find((a) => a.id === id)?.opinion ?? 0;
  };

  const apiError = async (res: Response): Promise<string> => {
    const j = await res.json().catch(() => ({}));
    if (res.status === 503) return 'IA não configurada no servidor (defina a chave do provedor).';
    if (res.status === 402) return 'Orçamento de IA da campanha esgotado.';
    return j?.error || 'Erro inesperado.';
  };

  const seedAgents = async () => {
    setError(null); setBusy('seed');
    try {
      const res = await authedFetch('/api/v1/scenarios/graph-seed');
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Erro ao semear');
      const ns: AgentSpec[] = (j.nodes ?? []).slice(0, 14);
      if (!ns.length) { setError('Sem dados suficientes (cadastre contatos/adversários na Inteligência).'); return; }
      setAgents(ns); setPersonas(null); setTranscript([]); setReport(null);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  const loadGraph = (g: SavedGraph) => {
    setAgents((g.nodes ?? []).slice(0, 14));
    setPersonas(null); setTranscript([]); setReport(null);
  };

  const genPersonas = async () => {
    if (!agents.length) { setError('Carregue agentes primeiro.'); return; }
    setError(null); setBusy('personas');
    try {
      const res = await authedFetch('/api/v1/scenarios/debate/personas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents }),
      });
      if (!res.ok) throw new Error(await apiError(res));
      const j = await res.json();
      setPersonas(j.personas ?? []);
      setTranscript([]); setReport(null);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  const runDebate = async () => {
    if (!personas?.length) { setError('Gere as personas primeiro.'); return; }
    if (!scenario.trim()) { setError('Descreva o cenário antes de rodar.'); return; }
    setError(null); setReport(null);
    let acc: DebateTurn[] = [];
    setTranscript([]);
    try {
      for (let t = 1; t <= turns; t++) {
        setBusy(`turn-${t}`);
        const prior = acc[acc.length - 1] ?? null;
        const res = await authedFetch('/api/v1/scenarios/debate/turn', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personas, scenario, prior, turn: t }),
        });
        if (!res.ok) throw new Error(await apiError(res));
        const j = await res.json();
        acc = [...acc, { turn: t, agents: j.agents ?? [] }];
        setTranscript(acc);
      }
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  const genReport = async () => {
    if (!transcript.length || !personas) return;
    setError(null); setBusy('report');
    try {
      const res = await authedFetch('/api/v1/scenarios/debate/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, personas, transcript }),
      });
      if (!res.ok) throw new Error(await apiError(res));
      const j = await res.json();
      setReport(j.report ?? '');
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  const saveDebate = async () => {
    if (!transcript.length) return;
    setBusy('save'); setSavedOk(false);
    try {
      const agentsOut = (personas ?? agents).map((p) => ({ ...p, opinion: currentOpinion(p.id) }));
      const res = await authedFetch('/api/v1/scenarios/debate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: scenario.slice(0, 60) || 'Debate', scenario,
          agents: agentsOut, transcript, report, turns: transcript.length,
        }),
      });
      if (!res.ok) throw new Error(await apiError(res));
      setSavedOk(true);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  const sendChat = async () => {
    if (!chatId || !chatInput.trim() || !personas) return;
    const persona = personas.find((p) => p.id === chatId);
    if (!persona) return;
    const msg = chatInput.trim();
    setChatInput('');
    const hist = chatHist[chatId] ?? [];
    setChatHist((h) => ({ ...h, [chatId]: [...hist, { role: 'user', text: msg }] }));
    setChatBusy(true);
    try {
      const res = await authedFetch('/api/v1/scenarios/debate/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: { ...persona, opinion: currentOpinion(persona.id) }, scenario, history: hist, message: msg }),
      });
      if (!res.ok) throw new Error(await apiError(res));
      const j = await res.json();
      setChatHist((h) => ({ ...h, [chatId]: [...(h[chatId] ?? []), { role: 'agent', text: j.reply ?? '...' }] }));
    } catch (e: any) {
      setChatHist((h) => ({ ...h, [chatId]: [...(h[chatId] ?? []), { role: 'agent', text: `(erro: ${e.message})` }] }));
    } finally { setChatBusy(false); }
  };

  const running = busy?.startsWith('turn-');

  return (
    <div className="space-y-6">
      {/* Setup */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <Bot className="w-4 h-4 text-indigo-400" /> Debate por IA
          <span className="text-[10px] font-normal text-slate-500">simula pessoas debatendo um cenário</span>
        </h3>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={seedAgents} disabled={busy === 'seed'}>
            {busy === 'seed' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Database className="w-3 h-3 mr-1" />}
            Carregar agentes (dados reais)
          </Button>
          {savedGraphs.length > 0 && (
            <select
              className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-slate-300"
              defaultValue=""
              onChange={(e) => { const g = savedGraphs.find((x) => x.id === e.target.value); if (g) loadGraph(g); }}
            >
              <option value="" disabled>Carregar de um grafo salvo…</option>
              {savedGraphs.map((g) => <option key={g.id} value={g.id}>{g.label} ({g.nodes?.length ?? 0})</option>)}
            </select>
          )}
          {agents.length > 0 && (
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> {agents.length} agentes
            </span>
          )}
        </div>

        <textarea
          className="w-full text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 resize-none"
          rows={3}
          placeholder="Descreva o cenário / acontecimento (ex.: 'Estourou uma denúncia de corrupção contra o adversário X' ou 'O candidato propõe zerar a tarifa de ônibus')…"
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
        />

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={genPersonas} disabled={!agents.length || busy === 'personas'}>
            {busy === 'personas' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
            1. Gerar personas
          </Button>
          <label className="text-xs text-slate-500 flex items-center gap-1">
            Turnos
            <select className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-300"
              value={turns} onChange={(e) => setTurns(Number(e.target.value))}>
              {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <Button variant="primary" className="text-xs px-3 py-1.5" onClick={runDebate} disabled={!personas?.length || !!running}>
            {running ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
            {running ? `Turno ${busy?.split('-')[1]}/${turns}…` : '2. Rodar debate'}
          </Button>
          {transcript.length > 0 && (
            <>
              <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={genReport} disabled={busy === 'report'}>
                {busy === 'report' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <FileText className="w-3 h-3 mr-1" />}
                3. Relatório
              </Button>
              <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={saveDebate} disabled={busy === 'save'}>
                {busy === 'save' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                {savedOk ? 'Salvo ✓' : 'Salvar'}
              </Button>
            </>
          )}
        </div>

        {error && <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 mt-3">{error}</p>}
      </Card>

      {/* Agentes + opinião ao vivo */}
      {personas && personas.length > 0 && (
        <Card>
          <h3 className="text-xs font-semibold text-slate-400 mb-3">Agentes ({personas.length}) — opinião ao vivo</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {personas.map((p) => {
              const o = currentOpinion(p.id);
              return (
                <div key={p.id} className="bg-slate-800/40 rounded-lg p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-slate-200 truncate">{p.label}</span>
                      <span className="ml-2 text-[10px] text-slate-500">{TYPE_LABEL[p.type] ?? p.type}{p.stubborn ? ' · âncora' : ''}</span>
                    </div>
                    <button
                      onClick={() => setChatId(chatId === p.id ? null : p.id)}
                      className="text-slate-500 hover:text-indigo-400 shrink-0"
                      title="Conversar com este agente"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{p.persona}</p>
                  <div className="mt-1.5 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${((o + 1) / 2) * 100}%`, backgroundColor: opinionColor(o) }} />
                  </div>

                  {/* Chat inline */}
                  {chatId === p.id && (
                    <div className="mt-2 border-t border-slate-700 pt-2">
                      <div className="space-y-1 max-h-32 overflow-y-auto mb-1.5">
                        {(chatHist[p.id] ?? []).map((m, i) => (
                          <p key={i} className={`text-[11px] ${m.role === 'user' ? 'text-indigo-300' : 'text-slate-300'}`}>
                            <span className="font-semibold">{m.role === 'user' ? 'Você: ' : `${p.label}: `}</span>{m.text}
                          </p>
                        ))}
                        {chatBusy && <Loader2 className="w-3 h-3 animate-spin text-slate-500" />}
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          className="flex-1 text-[11px] bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500"
                          placeholder="Pergunte algo a este agente…"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
                        />
                        <button onClick={sendChat} disabled={chatBusy} className="text-indigo-400 hover:text-indigo-300 disabled:opacity-40">
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Transcrição do debate */}
      {transcript.length > 0 && (
        <Card>
          <h3 className="text-xs font-semibold text-slate-400 mb-3">Debate</h3>
          <div className="space-y-4">
            {transcript.map((t) => (
              <div key={t.turn}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1.5">Turno {t.turn}</p>
                <div className="space-y-1.5">
                  {t.agents.map((a) => {
                    const p = personas?.find((x) => x.id === a.id);
                    return (
                      <div key={a.id} className="flex items-start gap-2">
                        <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: opinionColor(a.opinion) }} />
                        <p className="text-sm text-slate-300">
                          <span className="font-semibold text-slate-200">{p?.label ?? a.id}:</span> {a.utterance}
                        </p>
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
          <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-400" /> Relatório do debate
          </h3>
          <MarkdownLite text={report} />
          <p className="text-[10px] text-amber-400/80 mt-3 flex items-center gap-1">
            ⚠ Simulação hipotética para estratégia interna — não é pesquisa eleitoral nem previsão oficial.
          </p>
        </Card>
      )}
    </div>
  );
};

export default AiDebate;
