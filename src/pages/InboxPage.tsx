import * as React from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { authedFetch } from '../lib/authedFetch';
import { useAuth } from '../contexts/AuthContext';
import {
    Inbox as InboxIcon, RefreshCw, User, Clock,
    MessageCircle, Send, Sparkles, BrainCircuit, X,
} from 'lucide-react';

interface Conversation {
    id: string;
    channel: 'whatsapp' | 'instagram';
    contactId: string | null;
    externalId: string;
    lastMessageAt: string | null;
    lastInboundAt: string | null;
    isOpen: boolean;
    stage: 'novo_lead' | 'em_atendimento' | 'proposta' | 'fechado';
    priority: 'alta' | 'media' | 'baixa';
}

interface Message {
    id: string;
    conversationId: string;
    direction: 'inbound' | 'outbound';
    body: string;
    createdAt: string;
}

const STAGES: { id: Conversation['stage']; title: string; headerColor: string }[] = [
    { id: 'novo_lead',      title: 'Novo Lead',      headerColor: 'border-blue-500/40' },
    { id: 'em_atendimento', title: 'Em Atendimento', headerColor: 'border-amber-500/40' },
    { id: 'proposta',       title: 'Proposta',        headerColor: 'border-purple-500/40' },
    { id: 'fechado',        title: 'Fechado',         headerColor: 'border-emerald-500/40' },
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
    const [input, setInput] = React.useState('');
    const [sending, setSending] = React.useState(false);
    const [suggesting, setSuggesting] = React.useState(false);
    const [summarizing, setSummarizing] = React.useState(false);
    const [summary, setSummary] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);
    const scrollRef = React.useRef<HTMLDivElement>(null);

    const selectedConvo = conversations.find(c => c.id === selectedId) ?? null;

    const fetchConversations = React.useCallback(async () => {
        if (!user?.campaignId) return;
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
                <button onClick={fetchConversations} disabled={loading}
                    className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-50 transition-colors">
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Atualizar
                </button>
            </div>

            <div className="flex flex-1 gap-4 overflow-hidden">

                {/* ── Kanban ── */}
                <div className="flex-1 overflow-x-auto overflow-y-hidden">
                    <DragDropContext onDragEnd={handleDragEnd}>
                        <div className="flex h-full items-start gap-4 pb-4 min-w-max">
                            {STAGES.map(stage => {
                                const stageConvos = conversations
                                    .filter(c => (c.stage ?? 'novo_lead') === stage.id)
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
