import * as React from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { authedFetch } from '../lib/authedFetch';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import CallCenterReports from '../components/callcenter/CallCenterReports';
import {
    Inbox as InboxIcon, RefreshCw, User, Clock,
    MessageCircle, Send, Sparkles, BrainCircuit, X, BarChart3,
} from 'lucide-react';

interface Conversation {
    id: string;
    channel: 'whatsapp' | 'instagram';
    contactId: string | null;
    externalId: string;
    lastMessageAt: string | null;
    lastInboundAt: string | null;
    isOpen: boolean;
    stage: string; // pipeline do call center + estágios legados
    priority: 'alta' | 'media' | 'baixa';
    areaId?: string | null; // área de atendimento roteada (F3)
}

interface Message {
    id: string;
    conversationId: string;
    direction: 'inbound' | 'outbound';
    body: string;
    createdAt: string;
}

// Pipeline do CALL CENTER. `match` absorve estágios legados (em_atendimento/proposta)
// pra nenhuma conversa antiga sumir do quadro do coordenador.
const STAGES: { id: string; match: string[]; title: string; headerColor: string }[] = [
    { id: 'novo_lead',             match: ['novo_lead'],                                      title: 'Novo Lead',       headerColor: 'border-blue-500/40' },
    { id: 'ia_atendendo',          match: ['ia_atendendo'],                                   title: '🤖 IA Atendendo', headerColor: 'border-indigo-500/40' },
    { id: 'aguardando_humano',     match: ['aguardando_humano'],                              title: '⏳ Fila Humana',  headerColor: 'border-amber-500/40' },
    { id: 'em_atendimento_humano', match: ['em_atendimento_humano', 'em_atendimento', 'proposta'], title: '🧑 Com Operador', headerColor: 'border-purple-500/40' },
    { id: 'fechado',               match: ['fechado'],                                        title: 'Fechado',         headerColor: 'border-emerald-500/40' },
];

const PRIORITY_BADGE: Record<Conversation['priority'], string> = {
    alta:  'border-red-500 text-red-400 bg-red-500/5',
    media: 'border-amber-500 text-amber-400 bg-amber-500/5',
    baixa: 'border-indigo-500 text-indigo-400 bg-indigo-500/5',
};

const CHANNEL_EMOJI: Record<string, string> = {
    whatsapp: '📱',
    instagram: '📷',
};

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return 'agora';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
}

const InboxPage: React.FC = () => {
    const { user } = useAuth();
    const [conversations, setConversations] = React.useState<Conversation[]>([]);
    const [messages, setMessages] = React.useState<Message[]>([]);
    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    // Espelha selectedId num ref p/ o handler de Broadcast ler a seleção atual
    // sem precisar re-assinar o canal a cada troca de conversa.
    const selectedIdRef = React.useRef<string | null>(null);
    React.useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
    const [input, setInput] = React.useState('');
    const [sending, setSending] = React.useState(false);
    const [suggesting, setSuggesting] = React.useState(false);
    const [summarizing, setSummarizing] = React.useState(false);
    const [summary, setSummary] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);
    const scrollRef = React.useRef<HTMLDivElement>(null);
    // Convites do call center (coordenador convida líder; líder convida operadores)
    const [ccOpen, setCcOpen] = React.useState(false);
    const [reportsOpen, setReportsOpen] = React.useState(false);
    const [ccName, setCcName] = React.useState('');
    const [ccRole, setCcRole] = React.useState('Líder Call Center');
    const [ccBusy, setCcBusy] = React.useState(false);
    const [ccInvites, setCcInvites] = React.useState<any[]>([]);
    const [ccCopied, setCcCopied] = React.useState<string | null>(null);
    const [ccError, setCcError] = React.useState<string | null>(null);
    // Áreas de atendimento (F3 — menu no mesmo número + roteamento)
    const [areas, setAreas] = React.useState<any[]>([]);
    const [areaName, setAreaName] = React.useState('');
    const [areaDesc, setAreaDesc] = React.useState('');
    const [areaPersona, setAreaPersona] = React.useState('');
    const [areaBusy, setAreaBusy] = React.useState(false);
    const areaById = React.useMemo(() => {
        const m: Record<string, any> = {};
        for (const a of areas) m[a.id] = a;
        return m;
    }, [areas]);

    const loadCcInvites = React.useCallback(async () => {
        try { const r = await authedFetch('/api/v1/callcenter/invites'); if (r.ok) { const j = await r.json(); setCcInvites(j.invites || []); } } catch { /* */ }
    }, []);
    const loadAreas = React.useCallback(async () => {
        try { const r = await authedFetch('/api/v1/callcenter/areas'); if (r.ok) { const j = await r.json(); setAreas(j.areas || []); } } catch { /* */ }
    }, []);
    React.useEffect(() => { if (ccOpen) { loadCcInvites(); loadAreas(); } }, [ccOpen, loadCcInvites, loadAreas]);
    // Carrega áreas no mount também — pra mostrar o badge da área nos cards.
    React.useEffect(() => { loadAreas(); }, [loadAreas]);

    const createArea = async () => {
        if (!areaName.trim()) return;
        setAreaBusy(true);
        try {
            const r = await authedFetch('/api/v1/callcenter/areas', {
                method: 'POST',
                body: JSON.stringify({ name: areaName.trim(), description: areaDesc.trim() || undefined, persona: areaPersona.trim() || undefined }),
            });
            if (r.ok) { setAreaName(''); setAreaDesc(''); setAreaPersona(''); await loadAreas(); }
        } finally { setAreaBusy(false); }
    };
    const toggleArea = async (a: any) => {
        await authedFetch(`/api/v1/callcenter/areas/${a.id}`, { method: 'PATCH', body: JSON.stringify({ active: !a.active }) });
        await loadAreas();
    };
    const deleteArea = async (id: string) => {
        await authedFetch(`/api/v1/callcenter/areas/${id}`, { method: 'DELETE' });
        await loadAreas();
    };

    const createCcInvite = async () => {
        setCcBusy(true); setCcError(null);
        try {
            const r = await authedFetch('/api/v1/callcenter/invites', {
                method: 'POST', body: JSON.stringify({ displayName: ccName.trim(), role: ccRole }),
            });
            if (r.ok) { setCcName(''); await loadCcInvites(); }
            else {
                const j = await r.json().catch(() => ({} as any));
                setCcError(j.error === 'feature_not_in_plan'
                    ? 'Seu plano não inclui o módulo Call Center. Fale com o suporte.'
                    : `Erro ao gerar convite: ${j.detail || j.error || `HTTP ${r.status}`}`);
            }
        } catch { setCcError('Sem resposta do servidor — tente de novo em instantes (pode haver deploy em andamento).'); }
        finally { setCcBusy(false); }
    };
    const copyCcLink = (token: string) => {
        navigator.clipboard?.writeText(`${window.location.origin}/cadastro/callcenter/${token}`)
            .then(() => { setCcCopied(token); setTimeout(() => setCcCopied(null), 1500); }, () => {});
    };

    const selectedConvo = conversations.find(c => c.id === selectedId) ?? null;

    const fetchConversations = React.useCallback(async () => {
        if (!user?.campaignId) { setLoading(false); return; }
        setLoading(true);
        try {
            const res = await authedFetch('/api/v1/channels/conversations');
            if (res.ok) {
                const json = await res.json();
                setConversations(json.conversations ?? []);
            }
        } finally {
            setLoading(false);
        }
    }, [user?.campaignId]);

    const fetchMessages = React.useCallback(async (id: string) => {
        const res = await authedFetch(`/api/v1/channels/conversations/${id}/messages`);
        if (res.ok) {
            const json = await res.json();
            setMessages(json.messages ?? []);
        }
    }, []);

    React.useEffect(() => { fetchConversations(); }, [fetchConversations]);

    React.useEffect(() => {
        if (!selectedId) return;
        fetchMessages(selectedId);
        setSummary(null);
    }, [selectedId, fetchMessages]);

    // Tempo real: mensagens novas (eleitor OU resposta da IA) chegam por
    // Broadcast no canal callcenter-<campaignId> — o webhook/bot dispara o
    // evento 'new_message'. Assim a Caixa de Entrada atualiza sozinha, sem F5.
    React.useEffect(() => {
        if (!user?.campaignId) return;
        const ch = supabase.channel(`callcenter-${user.campaignId}`)
            .on('broadcast', { event: 'queue_changed' }, () => fetchConversations())
            .on('broadcast', { event: 'new_message' }, (p: any) => {
                fetchConversations();
                const cid = p?.payload?.conversationId;
                if (cid && cid === selectedIdRef.current) fetchMessages(cid);
            })
            .subscribe();
        const safety = setInterval(fetchConversations, 60_000); // rede de segurança
        return () => { supabase.removeChannel(ch); clearInterval(safety); };
    }, [user?.campaignId, fetchConversations, fetchMessages]);

    React.useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleDragEnd = async (result: DropResult) => {
        if (!result.destination) return;
        const { draggableId, destination } = result;
        const newStage = destination.droppableId as Conversation['stage'];

        // Optimistic update
        setConversations(prev => prev.map(c => c.id === draggableId ? { ...c, stage: newStage } : c));

        try {
            await authedFetch(`/api/v1/channels/conversations/${draggableId}`, {
                method: 'PATCH',
                body: JSON.stringify({ stage: newStage }),
            });
        } catch {
            fetchConversations();
        }
    };

    const handleSend = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!input.trim() || !selectedConvo) return;
        setSending(true);
        try {
            await authedFetch('/api/v1/channels/send', {
                method: 'POST',
                body: JSON.stringify({
                    channel: selectedConvo.channel,
                    to: selectedConvo.externalId,
                    text: input.trim(),
                    contactId: selectedConvo.contactId,
                }),
            });
            setInput('');
            fetchMessages(selectedConvo.id);
            fetchConversations();
        } finally {
            setSending(false);
        }
    };

    const handleSuggest = async () => {
        if (!selectedId || !messages.length) return;
        setSuggesting(true);
        try {
            const res = await authedFetch(`/api/v1/channels/conversations/${selectedId}/suggest`, {
                method: 'POST',
                body: JSON.stringify({
                    messages: messages.slice(-8),
                    contact: { number: selectedConvo?.externalId },
                    mode: 'reply',
                }),
            });
            if (res.ok) {
                const json = await res.json();
                setInput(json.suggestion ?? '');
            }
        } finally {
            setSuggesting(false);
        }
    };

    const handleSummarize = async () => {
        if (!selectedId || !messages.length) return;
        setSummarizing(true);
        try {
            const res = await authedFetch(`/api/v1/channels/conversations/${selectedId}/suggest`, {
                method: 'POST',
                body: JSON.stringify({
                    messages,
                    contact: { number: selectedConvo?.externalId },
                    mode: 'summarize',
                }),
            });
            if (res.ok) {
                const json = await res.json();
                setSummary(json.suggestion ?? '');
            }
        } finally {
            setSummarizing(false);
        }
    };

    return (
        <div className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
            {/* Page header */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-slate-200 flex items-center gap-2">
                    <InboxIcon className="w-6 h-6 text-sky-400" />
                    Caixa de Entrada Omnichannel
                </h2>
                <div className="flex items-center gap-2">
                    <button onClick={() => setReportsOpen(true)}
                        className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-emerald-600/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/25 transition-colors">
                        <BarChart3 className="w-4 h-4" /> Relatórios
                    </button>
                    <button onClick={() => setCcOpen(true)}
                        className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-indigo-600/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/25 transition-colors">
                        <User className="w-4 h-4" /> Equipe de Atendimento
                    </button>
                    <button onClick={fetchConversations} disabled={loading}
                        className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-50 transition-colors">
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Atualizar
                    </button>
                </div>
            </div>

            {/* Modal: convidar Líder/Operador do Call Center */}
            {ccOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setCcOpen(false)}>
                    <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="font-bold text-white">Equipe de Atendimento (Call Center)</h4>
                            <button onClick={() => setCcOpen(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
                        </div>
                        <p className="text-xs text-slate-400 mb-3">Convide o <b>líder do call center</b> — ele cadastra os operadores pelo painel dele. O link já vem com o nome travado.</p>
                        <div className="flex gap-2 mb-3">
                            <input value={ccName} onChange={(e) => setCcName(e.target.value)} placeholder="Nome do líder"
                                className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white text-sm" />
                            <select value={ccRole} onChange={(e) => setCcRole(e.target.value)} className="bg-slate-950 border border-white/10 rounded-xl px-2 py-2 text-white text-sm">
                                <option value="Líder Call Center">Líder</option>
                                <option value="Operador Call Center">Operador</option>
                            </select>
                        </div>
                        <button onClick={createCcInvite} disabled={!ccName.trim() || ccBusy}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl px-4 py-2.5 font-bold text-sm mb-3">
                            {ccBusy ? 'Gerando…' : 'Gerar link de convite'}
                        </button>
                        {ccError && <p className="text-xs text-rose-400 mb-3">{ccError}</p>}
                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {ccInvites.map((i: any) => (
                                <div key={i.id} className="flex items-center justify-between gap-2 text-sm bg-slate-950/60 rounded-xl px-3 py-2">
                                    <span className="truncate">{i.displayName} <span className="text-[11px] text-slate-500">· {i.role === 'Líder Call Center' ? 'Líder' : 'Operador'} · {i.status === 'used' ? '✅' : i.status === 'revoked' ? 'revogado' : 'pendente'}</span></span>
                                    {i.status === 'pending' && (
                                        <button onClick={() => copyCcLink(i.token)}
                                            className="text-xs px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 shrink-0">
                                            {ccCopied === i.token ? '✅ Copiado' : '🔗 Copiar link'}
                                        </button>
                                    )}
                                </div>
                            ))}
                            {ccInvites.length === 0 && <p className="text-xs text-slate-500">Nenhum convite ainda.</p>}
                        </div>

                        {/* ── Áreas de Atendimento (menu no mesmo número) ── */}
                        <div className="mt-5 pt-4 border-t border-white/10">
                            <h4 className="font-bold text-white text-sm mb-1">🧭 Áreas de Atendimento</h4>
                            <p className="text-xs text-slate-400 mb-3">
                                Crie áreas (ex.: Financeiro, Suporte) e o eleitor escolhe pelo <b>menu no mesmo número</b>.
                                A IA responde com o tom da área. <b>Sem áreas</b>, o atendimento é único (sem menu).
                            </p>
                            <input value={areaName} onChange={(e) => setAreaName(e.target.value)} placeholder="Nome da área (ex.: Financeiro)"
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white text-sm mb-2" />
                            <input value={areaDesc} onChange={(e) => setAreaDesc(e.target.value)} placeholder="Descrição curta (aparece no menu) — opcional"
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white text-sm mb-2" />
                            <textarea value={areaPersona} onChange={(e) => setAreaPersona(e.target.value)} rows={2}
                                placeholder="Persona da IA p/ esta área (ex.: 'Você é do setor financeiro; tire dúvidas sobre prestação de contas') — opcional"
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-white text-sm mb-2" />
                            <button onClick={createArea} disabled={!areaName.trim() || areaBusy}
                                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl px-4 py-2 font-bold text-sm mb-3">
                                {areaBusy ? 'Salvando…' : '+ Adicionar área'}
                            </button>
                            <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                {areas.map((a: any, idx: number) => (
                                    <div key={a.id} className={`flex items-center justify-between gap-2 text-sm rounded-xl px-3 py-2 ${a.active ? 'bg-slate-950/60' : 'bg-slate-950/30 opacity-60'}`}>
                                        <span className="truncate">
                                            <span className="text-slate-500">{idx + 1}.</span> {a.name}
                                            {!a.active && <span className="text-[11px] text-slate-500"> · inativa</span>}
                                        </span>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button onClick={() => toggleArea(a)} title={a.active ? 'Desativar' : 'Ativar'}
                                                className="text-xs px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300">
                                                {a.active ? 'Pausar' : 'Ativar'}
                                            </button>
                                            <button onClick={() => deleteArea(a.id)} title="Remover"
                                                className="text-xs px-2 py-1 rounded-lg bg-rose-600/10 hover:bg-rose-600/20 text-rose-400">
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {areas.length === 0 && <p className="text-xs text-slate-500">Nenhuma área — atendimento único (sem menu).</p>}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Relatórios do Call Center */}
            {reportsOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setReportsOpen(false)}>
                    <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-2xl w-full p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="font-bold text-white flex items-center gap-2"><BarChart3 className="w-4 h-4 text-emerald-300" /> Relatórios do Atendimento</h4>
                            <button onClick={() => setReportsOpen(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
                        </div>
                        <CallCenterReports />
                    </div>
                </div>
            )}

            <div className="flex flex-1 gap-4 overflow-hidden">

                {/* ── Kanban ── */}
                <div className="flex-1 overflow-x-auto overflow-y-hidden">
                    <DragDropContext onDragEnd={handleDragEnd}>
                        <div className="flex h-full items-start gap-4 pb-4 min-w-max">
                            {STAGES.map(stage => {
                                const stageConvos = conversations
                                    .filter(c => stage.match.includes(c.stage ?? 'novo_lead'))
                                    .sort((a, b) =>
                                        new Date(b.lastMessageAt ?? 0).getTime() -
                                        new Date(a.lastMessageAt ?? 0).getTime());

                                return (
                                    <div key={stage.id}
                                        className={`flex flex-col h-full w-[270px] min-w-[270px] rounded-xl bg-slate-900/50 border ${stage.headerColor}`}>
                                        {/* Stage header */}
                                        <div className="flex items-center justify-between p-3 border-b border-slate-800">
                                            <h3 className="text-sm font-semibold text-slate-200">{stage.title}</h3>
                                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                                                {stageConvos.length}
                                            </span>
                                        </div>

                                        <Droppable droppableId={stage.id}>
                                            {(provided, snapshot) => (
                                                <div
                                                    {...provided.droppableProps}
                                                    ref={provided.innerRef}
                                                    className={`flex-1 overflow-y-auto p-2 space-y-2 transition-colors ${snapshot.isDraggingOver ? 'bg-slate-800/40' : ''}`}
                                                >
                                                    {stageConvos.map((convo, index) => (
                                                        <Draggable key={convo.id} draggableId={convo.id} index={index}>
                                                            {(provided, snapshot) => (
                                                                <div
                                                                    ref={provided.innerRef}
                                                                    {...provided.draggableProps}
                                                                    {...provided.dragHandleProps}
                                                                    onClick={() => setSelectedId(convo.id)}
                                                                    className={`p-3 rounded-xl border cursor-pointer transition-all select-none
                                                                        ${selectedId === convo.id
                                                                            ? 'border-sky-500 bg-slate-800'
                                                                            : 'border-slate-800 bg-slate-950 hover:border-slate-700'}
                                                                        ${snapshot.isDragging
                                                                            ? 'rotate-1 scale-105 shadow-2xl ring-2 ring-sky-500 z-50 bg-slate-800'
                                                                            : ''}`}
                                                                >
                                                                    <div className="flex items-start justify-between gap-2 mb-2">
                                                                        <div className="flex items-center gap-2 min-w-0">
                                                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center">
                                                                                <User className="w-4 h-4 text-slate-500" />
                                                                            </div>
                                                                            <div className="min-w-0">
                                                                                <p className="text-sm font-semibold text-slate-100 truncate">
                                                                                    {convo.externalId}
                                                                                </p>
                                                                                <p className="text-[10px] text-slate-500">
                                                                                    {CHANNEL_EMOJI[convo.channel]} {convo.channel}
                                                                                </p>
                                                                                {convo.areaId && areaById[convo.areaId] && (
                                                                                    <span className="inline-block mt-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                                                                                        🧭 {areaById[convo.areaId].name}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${PRIORITY_BADGE[convo.priority ?? 'media']}`}>
                                                                            {convo.priority ?? 'media'}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center justify-between">
                                                                        <div className="flex items-center gap-1 text-slate-500">
                                                                            <Clock className="w-3 h-3" />
                                                                            <span className="text-[11px]">
                                                                                {convo.lastMessageAt ? timeAgo(convo.lastMessageAt) : '–'}
                                                                            </span>
                                                                        </div>
                                                                        {convo.isOpen && (
                                                                            <span className="w-2 h-2 rounded-full bg-emerald-400" title="Aberta" />
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    ))}
                                                    {provided.placeholder}
                                                    {stageConvos.length === 0 && !snapshot.isDraggingOver && (
                                                        <div className="flex items-center justify-center h-16 text-slate-600 text-xs">
                                                            Arraste uma conversa aqui
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </Droppable>
                                    </div>
                                );
                            })}
                        </div>
                    </DragDropContext>
                </div>

                {/* ── Chat panel ── */}
                <div className="w-[380px] min-w-[380px] flex flex-col border border-slate-800 rounded-xl bg-slate-950 overflow-hidden">
                    {!selectedConvo ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                            <div className="w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center mb-3">
                                <MessageCircle className="w-8 h-8 text-slate-600" />
                            </div>
                            <p className="text-slate-400 font-medium">Selecione uma conversa</p>
                            <p className="text-slate-500 text-sm mt-1">
                                Clique em um card no Kanban para abrir o chat.
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* Chat header */}
                            <div className="flex items-center gap-3 p-4 border-b border-slate-800">
                                <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center flex-shrink-0">
                                    <User className="w-5 h-5 text-slate-400" />
                                </div>
                                <div className="min-w-0">
                                    <p className="font-medium text-slate-100 truncate">{selectedConvo.externalId}</p>
                                    <p className="text-xs text-slate-500 capitalize">
                                        {CHANNEL_EMOJI[selectedConvo.channel]} {selectedConvo.channel}
                                    </p>
                                </div>
                            </div>

                            {/* Messages */}
                            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                                {messages.length === 0 ? (
                                    <div className="flex h-full items-center justify-center text-slate-500 text-sm">
                                        Nenhuma mensagem ainda.
                                    </div>
                                ) : messages.map(msg => {
                                    const isInbound = msg.direction === 'inbound';
                                    return (
                                        <div key={msg.id} className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'}`}>
                                            <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm
                                                ${isInbound
                                                    ? 'bg-slate-800 text-slate-100 rounded-tl-sm border border-slate-700'
                                                    : 'bg-sky-600 text-white rounded-tr-sm'}`}>
                                                <p className="whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                                            </div>
                                            <span className="text-[10px] text-slate-500 mt-0.5">
                                                {new Date(msg.createdAt).toLocaleTimeString('pt-BR', {
                                                    hour: '2-digit', minute: '2-digit',
                                                })}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Input area */}
                            <div className="p-3 border-t border-slate-800 space-y-2">
                                {summary && (
                                    <div className="bg-indigo-950/30 border border-indigo-500/20 rounded-lg p-3 relative">
                                        <button onClick={() => setSummary(null)}
                                            className="absolute top-2 right-2 text-indigo-400 hover:text-indigo-200 transition-colors">
                                            <X className="w-4 h-4" />
                                        </button>
                                        <div className="flex items-center gap-2 mb-1 text-indigo-400">
                                            <BrainCircuit className="w-4 h-4" />
                                            <span className="text-xs font-semibold uppercase tracking-wider">Resumo</span>
                                        </div>
                                        <p className="text-sm text-slate-300 whitespace-pre-wrap pr-6">{summary}</p>
                                    </div>
                                )}

                                <div className="flex items-center gap-1">
                                    <button onClick={handleSuggest} disabled={suggesting || !messages.length}
                                        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-40 transition-colors">
                                        <Sparkles className={`w-3.5 h-3.5 text-purple-400 ${suggesting ? 'animate-spin' : ''}`} />
                                        {suggesting ? 'Gerando...' : 'Sugerir resposta'}
                                    </button>
                                    <button onClick={handleSummarize} disabled={summarizing || !messages.length}
                                        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-40 transition-colors">
                                        <BrainCircuit className={`w-3.5 h-3.5 text-indigo-400 ${summarizing ? 'animate-spin' : ''}`} />
                                        {summarizing ? 'Resumindo...' : 'Resumir thread'}
                                    </button>
                                </div>

                                <form onSubmit={handleSend}
                                    className="flex items-end gap-2 bg-slate-900 border border-slate-800 rounded-xl p-1 focus-within:border-slate-600 transition-colors">
                                    <textarea
                                        value={input}
                                        onChange={e => setInput(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSend();
                                            }
                                        }}
                                        placeholder="Digite a mensagem..."
                                        className="flex-1 resize-none bg-transparent py-2 px-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none max-h-[100px] min-h-[38px]"
                                        rows={1}
                                    />
                                    <button type="submit" disabled={!input.trim() || sending}
                                        className="mb-1 mr-1 p-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white transition-colors">
                                        <Send className="w-4 h-4" />
                                    </button>
                                </form>
                                <p className="text-center text-[10px] text-slate-600">
                                    Enter para enviar · Shift+Enter para nova linha
                                </p>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InboxPage;
