import * as React from 'react';
import { supabase } from '../../lib/supabaseClient';
import { Sparkles, Zap, CheckCircle2, AlertTriangle, Loader2, Brain, ChevronRight, Wallet, Trash2 } from 'lucide-react';
import { useAgentStore } from '../../stores/useAgentStore';

interface ManagerEvent {
    type: string;
    payload: any;
    ts: string;
}

interface ManagerRoomProps {
    campaignId: string | undefined;
}

const AGENT_LABELS: Record<string, string> = {
    strategist: 'Estrategista',
    growth: 'Growth Hacker',
    field: 'Comandante de Campo',
    social: 'Social Media',
    creative: 'Produtor Criativo',
    crm: 'CRM',
    fraud: 'Auditor de Fraude',
};

const ManagerRoom: React.FC<ManagerRoomProps> = ({ campaignId }) => {
    // Persistido no Zustand: sobrevive a troca de aba e reload (localStorage).
    const { managerSession, setManagerIntent, setManagerEvents, appendManagerEvent, setManagerFinal, setManagerError, clearManagerSession } = useAgentStore();
    const intent = managerSession.intent;
    const events = managerSession.events as ManagerEvent[];
    const finalResult = managerSession.finalResult;
    const error = managerSession.error;
    // running NÃO persiste — sempre começa false em montagem nova (intencional).
    const [running, setRunning] = React.useState(false);
    const abortRef = React.useRef<AbortController | null>(null);

    const stop = () => {
        abortRef.current?.abort();
        abortRef.current = null;
        setRunning(false);
    };

    const run = async () => {
        if (!campaignId || !intent.trim()) {
            console.warn('[Manager] click ignorado — campaignId:', campaignId, 'intent.trim():', intent.trim());
            return;
        }
        setRunning(true);
        setManagerEvents([]);
        setManagerFinal(null);
        setManagerError(null);
        console.log('[Manager] disparando fetch — campaignId:', campaignId);

        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const { data: { session } } = await supabase.auth.getSession();
            console.log('[Manager] session token:', session?.access_token ? 'presente' : 'AUSENTE');

            const response = await fetch('/api/agents/manager', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({ campaignId, intent: intent.trim() }),
                signal: controller.signal,
            });
            console.log('[Manager] HTTP', response.status, 'Content-Type:', response.headers.get('content-type'));

            if (!response.ok) {
                const text = await response.text();
                console.error('[Manager] resposta nao-OK:', text);
                throw new Error(text || `HTTP ${response.status}`);
            }
            if (!response.body) throw new Error('Sem corpo de resposta');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let chunkCount = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    console.log('[Manager] stream ENCERRADO. Total chunks:', chunkCount);
                    setRunning(false);
                    break;
                }
                chunkCount += 1;
                const text = decoder.decode(value, { stream: true });
                console.log(`[Manager] chunk #${chunkCount} (${text.length} chars):`, text.slice(0, 200));
                buffer += text;
                const chunks = buffer.split('\n\n');
                buffer = chunks.pop() || '';
                for (const chunk of chunks) {
                    if (!chunk.trim() || chunk.startsWith(':')) continue;
                    let evt = '';
                    let data = '';
                    for (const line of chunk.split('\n')) {
                        if (line.startsWith('event: ')) evt = line.slice(7);
                        else if (line.startsWith('data: ')) data += line.slice(6);
                    }
                    if (!evt) continue;
                    try {
                        const payload = data ? JSON.parse(data) : {};
                        console.log('[Manager] evento:', evt, payload);
                        appendManagerEvent({ type: evt, payload, ts: payload.ts || new Date().toISOString() });
                        if (evt === 'done') {
                            setManagerFinal(payload);
                            setRunning(false);
                        } else if (evt === 'error' || evt === 'budget_exceeded') {
                            setManagerError(payload.error || 'Falha');
                            setRunning(false);
                        }
                    } catch (parseErr) {
                        console.warn('[Manager] erro parse SSE:', parseErr, data);
                    }
                }
            }
        } catch (err: any) {
            if (err.name === 'AbortError') { console.log('[Manager] abortado pelo user'); return; }
            console.error('[Manager] EXCEPTION:', err);
            setManagerError(err?.message || String(err));
            setRunning(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-gradient-to-br from-indigo-900/30 to-blue-900/30 border border-indigo-500/30 rounded-3xl p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-3 rounded-2xl bg-indigo-500/20">
                        <Brain className="w-6 h-6 text-indigo-300" />
                    </div>
                    <div>
                        <h3 className="text-xl font-black">Manager Agent</h3>
                        <p className="text-xs text-slate-400">Chefe de Gabinete que orquestra os 7 especialistas pra resolver uma intenção sua.</p>
                    </div>
                </div>

                <textarea
                    value={intent}
                    onChange={e => setManagerIntent(e.target.value)}
                    disabled={running}
                    rows={3}
                    placeholder='Ex: "Identifica a maior dor desta semana, prepara um post pro Instagram e auditoria fraude antes de publicar."'
                    className="w-full bg-slate-900/60 border border-white/10 rounded-2xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                />

                <div className="flex gap-2 mt-3 items-center">
                    <button
                        onClick={run}
                        disabled={running || !intent.trim() || !campaignId}
                        className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold flex items-center gap-2 transition-all"
                    >
                        {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Executando…</> : <><Sparkles className="w-4 h-4" /> Executar</>}
                    </button>
                    {running && (
                        <button onClick={stop} className="px-4 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm">
                            Parar
                        </button>
                    )}
                    {(events.length > 0 || finalResult) && !running && (
                        <button
                            onClick={() => clearManagerSession()}
                            className="ml-auto px-3 py-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 text-xs flex items-center gap-1"
                        >
                            <Trash2 className="w-3 h-3" /> Limpar tela
                        </button>
                    )}
                </div>
            </div>

            {(events.length > 0 || error) && (
                <div className="bg-[#161b22] border border-white/5 rounded-3xl p-6">
                    <h4 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-4">Linha de Decisão</h4>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                        {events.map((e, i) => <EventRow key={i} event={e} />)}
                        {error && (
                            <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                                <p className="text-sm text-red-300">{error}</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {finalResult && (
                <div className="bg-emerald-900/20 border border-emerald-500/40 rounded-3xl p-6">
                    <div className="flex items-center gap-2 mb-3">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        <h4 className="font-bold text-emerald-300">Decisão Final</h4>
                    </div>
                    <pre className="whitespace-pre-wrap text-sm text-slate-200 font-sans leading-relaxed">{finalResult.finalSummary}</pre>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-4 border-t border-white/10 text-xs">
                        <Stat label="Iterações" value={finalResult.iterations} />
                        <Stat label="Tokens (in/out)" value={`${finalResult.totalTokensIn}/${finalResult.totalTokensOut}`} />
                        <Stat label="Custo (US$)" value={`$${(finalResult.totalCostCents / 100).toFixed(3)}`} />
                        <Stat label="Run ID" value={String(finalResult.managerRunId).slice(0, 8) + '…'} mono />
                    </div>
                </div>
            )}
        </div>
    );
};

const Stat: React.FC<{ label: string; value: any; mono?: boolean }> = ({ label, value, mono }) => (
    <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
        <p className={`text-sm font-bold text-slate-200 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
);

const EventRow: React.FC<{ event: ManagerEvent }> = ({ event }) => {
    const t = new Date(event.ts).toLocaleTimeString();
    if (event.type === 'started') {
        return <Row icon={<Sparkles className="w-4 h-4 text-indigo-400" />} title="Manager iniciou" detail={`run ${String(event.payload.managerRunId).slice(0,8)}…`} time={t} />;
    }
    if (event.type === 'iteration') {
        return <Row icon={<ChevronRight className="w-4 h-4 text-slate-500" />} title={`Rodada ${event.payload.iteration}/${event.payload.max}`} time={t} faded />;
    }
    if (event.type === 'manager_thinking') {
        return <Row icon={<Brain className="w-4 h-4 text-indigo-300 animate-pulse" />} title="Manager pensando…" time={t} faded />;
    }
    if (event.type === 'tool_call') {
        const agent = event.payload.agent;
        return (
            <Row
                icon={<Zap className="w-4 h-4 text-yellow-400" />}
                title={`Chamando ${AGENT_LABELS[agent] || agent}`}
                detail={event.payload.reason || event.payload.prompt?.slice(0, 80)}
                time={t}
            />
        );
    }
    if (event.type === 'tool_result') {
        const agent = event.payload.agent;
        if (event.payload.error) {
            return <Row icon={<AlertTriangle className="w-4 h-4 text-red-400" />} title={`${AGENT_LABELS[agent] || agent} falhou`} detail={event.payload.error} time={t} />;
        }
        const tools = Array.isArray(event.payload.toolsUsed) ? event.payload.toolsUsed : [];
        const toolsTxt = tools.length ? `📊 consultou: ${tools.join(', ')} · ` : '';
        return (
            <Row
                icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                title={`${AGENT_LABELS[agent] || agent} respondeu`}
                detail={`${toolsTxt}${event.payload.latencyMs}ms · $${(event.payload.costCents / 100).toFixed(4)} · "${(event.payload.response || '').slice(0, 100)}…"`}
                time={t}
            />
        );
    }
    if (event.type === 'budget_exceeded') {
        return <Row icon={<Wallet className="w-4 h-4 text-orange-400" />} title="Budget desta execução estourou" detail={event.payload.error} time={t} />;
    }
    if (event.type === 'finalized') {
        return <Row icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />} title="Manager finalizou" time={t} />;
    }
    if (event.type === 'done') return null; // tratado no painel final
    return <Row icon={<ChevronRight className="w-4 h-4 text-slate-500" />} title={event.type} detail={JSON.stringify(event.payload)} time={t} faded />;
};

const Row: React.FC<{ icon: React.ReactNode; title: string; detail?: string; time: string; faded?: boolean }> = ({ icon, title, detail, time, faded }) => (
    <div className={`flex items-start gap-3 p-3 rounded-xl ${faded ? 'opacity-60' : 'bg-white/[0.02] border border-white/5'}`}>
        <div className="flex-shrink-0 mt-0.5">{icon}</div>
        <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-200">{title}</p>
            {detail && <p className="text-xs text-slate-400 mt-0.5 truncate">{detail}</p>}
        </div>
        <span className="text-[10px] text-slate-600 font-mono flex-shrink-0">{time}</span>
    </div>
);

export default ManagerRoom;
