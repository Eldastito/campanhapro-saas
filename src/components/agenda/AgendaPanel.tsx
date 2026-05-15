import * as React from 'react';
import { Calendar, Plus, Edit2, Trash2, MapPin, BellRing, X, Clock, User } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

export interface AgendaEvent {
    id: string;
    campaignId: string;
    title: string;
    description: string | null;
    startsAt: string;        // ISO
    endsAt: string | null;
    location: string | null;
    withWhom: string | null;
    priority: 'critica' | 'alta' | 'media' | 'baixa';
    category: string | null;
    reminderMinutesBefore: number;
    reminderDispatched: boolean;
    createdAt: string;
}

const PRIORITY_OPTIONS: { value: AgendaEvent['priority']; label: string; color: string }[] = [
    { value: 'critica', label: 'Crítica', color: 'text-red-400 bg-red-500/10 border-red-500/30' },
    { value: 'alta',    label: 'Alta',    color: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
    { value: 'media',   label: 'Média',   color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
    { value: 'baixa',   label: 'Baixa',   color: 'text-slate-400 bg-slate-500/10 border-slate-500/30' },
];

const CATEGORIES = [
    { value: 'reuniao',   label: 'Reunião' },
    { value: 'caminhada', label: 'Caminhada' },
    { value: 'comicio',   label: 'Comício' },
    { value: 'gravacao',  label: 'Gravação' },
    { value: 'midia',     label: 'Mídia / Entrevista' },
    { value: 'outro',     label: 'Outro' },
];

interface AgendaPanelProps {
    /** Quando passado, exibe slot para botão de comando de voz (etapa 2C) */
    voiceSlot?: React.ReactNode;
}

const AgendaPanel: React.FC<AgendaPanelProps> = ({ voiceSlot }) => {
    const { user } = useAuth();
    const [events, setEvents] = React.useState<AgendaEvent[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [editing, setEditing] = React.useState<AgendaEvent | null>(null);
    const [showForm, setShowForm] = React.useState(false);
    const [notifPermission, setNotifPermission] = React.useState<NotificationPermission>('default');

    const fetchEvents = React.useCallback(async () => {
        if (!user?.campaignId) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('agenda_events')
            .select('*')
            .eq('campaignId', user.campaignId)
            .order('startsAt', { ascending: true });
        setLoading(false);
        if (error) {
            console.error('[Agenda] erro fetch:', error);
            return;
        }
        setEvents((data as AgendaEvent[]) || []);
    }, [user?.campaignId]);

    React.useEffect(() => {
        fetchEvents();
        // Realtime
        if (!user?.campaignId) return;
        const ch = supabase
            .channel(`agenda-${user.campaignId}-${Date.now()}`)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'agenda_events',
                filter: `campaign_id=eq.${user.campaignId}`,
            }, () => fetchEvents())
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [user?.campaignId, fetchEvents]);

    React.useEffect(() => {
        if (typeof Notification !== 'undefined') setNotifPermission(Notification.permission);
    }, []);

    // Lembretes via Browser Notification API: dispara quando `startsAt - reminderMinutesBefore` passa.
    React.useEffect(() => {
        if (notifPermission !== 'granted' || events.length === 0) return;
        const intv = setInterval(() => {
            const now = Date.now();
            for (const e of events) {
                if (e.reminderDispatched) continue;
                const triggerAt = new Date(e.startsAt).getTime() - e.reminderMinutesBefore * 60_000;
                if (now < triggerAt || now > triggerAt + 60_000) continue; // janela de 1 min
                try {
                    new Notification(`📅 ${e.title}`, {
                        body: `Em ${e.reminderMinutesBefore} min · ${e.location || 'sem local'}`,
                        tag: `agenda-${e.id}`,
                    });
                    supabase.from('agenda_events').update({
                        reminderDispatched: true,
                        reminderDispatchedAt: new Date().toISOString(),
                    }).eq('id', e.id).then(() => fetchEvents(), () => {});
                } catch (err) {
                    console.warn('[Agenda] erro notif:', err);
                }
            }
        }, 30_000);
        return () => clearInterval(intv);
    }, [events, notifPermission, fetchEvents]);

    const requestNotifs = async () => {
        if (typeof Notification === 'undefined') {
            alert('Seu navegador não suporta notificações.');
            return;
        }
        const result = await Notification.requestPermission();
        setNotifPermission(result);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Remover este evento da agenda?')) return;
        const { error } = await supabase.from('agenda_events').delete().eq('id', id);
        if (error) alert('Erro ao remover: ' + error.message);
    };

    const upcoming = events.filter(e => new Date(e.startsAt) >= new Date());
    const past = events.filter(e => new Date(e.startsAt) < new Date()).slice(-5).reverse();

    return (
        <div className="bg-[#161b22] border border-white/5 rounded-3xl p-6">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                    <Calendar className="w-6 h-6 text-emerald-400" />
                    <div>
                        <h3 className="text-lg font-bold text-slate-200">Agenda do Candidato</h3>
                        <p className="text-xs text-slate-500">{upcoming.length} evento(s) futuro(s)</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {voiceSlot}
                    {notifPermission !== 'granted' && (
                        <button
                            onClick={requestNotifs}
                            className="text-xs px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/20 flex items-center gap-1"
                            title="Permite alertas no navegador no horário de cada lembrete"
                        >
                            <BellRing className="w-3 h-3" /> Ativar lembretes
                        </button>
                    )}
                    <button
                        onClick={() => { setEditing(null); setShowForm(true); }}
                        className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" /> Novo evento
                    </button>
                </div>
            </div>

            {loading ? (
                <p className="text-center text-slate-400 py-8">Carregando...</p>
            ) : upcoming.length === 0 ? (
                <p className="text-center text-slate-400 py-8">Nenhum evento agendado.</p>
            ) : (
                <ul className="space-y-2">
                    {upcoming.map(e => (
                        <EventRow key={e.id} event={e} onEdit={() => { setEditing(e); setShowForm(true); }} onDelete={() => handleDelete(e.id)} />
                    ))}
                </ul>
            )}

            {past.length > 0 && (
                <details className="mt-6">
                    <summary className="text-xs text-slate-500 cursor-pointer">Eventos passados ({past.length})</summary>
                    <ul className="space-y-2 mt-2 opacity-60">
                        {past.map(e => (
                            <EventRow key={e.id} event={e} onEdit={() => { setEditing(e); setShowForm(true); }} onDelete={() => handleDelete(e.id)} />
                        ))}
                    </ul>
                </details>
            )}

            {showForm && (
                <EventFormModal
                    event={editing}
                    campaignId={user?.campaignId || ''}
                    onClose={() => { setShowForm(false); setEditing(null); }}
                />
            )}
        </div>
    );
};

const EventRow: React.FC<{ event: AgendaEvent; onEdit: () => void; onDelete: () => void }> = ({ event, onEdit, onDelete }) => {
    const dt = new Date(event.startsAt);
    const dateStr = dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    const timeStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const cat = CATEGORIES.find(c => c.value === event.category)?.label;
    const prio = PRIORITY_OPTIONS.find(p => p.value === event.priority);
    return (
        <li className="bg-slate-800/50 rounded-xl p-3 flex items-start justify-between gap-3 hover:bg-slate-800">
            <div className="flex-1 min-w-0">
                <div className="flex items-baseline flex-wrap gap-2 mb-1">
                    <span className="text-xs font-mono text-emerald-400">{dateStr} · {timeStr}</span>
                    {cat && <span className="text-[10px] uppercase tracking-wider text-slate-500">{cat}</span>}
                    {prio && (
                        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${prio.color}`}>
                            {prio.label}
                        </span>
                    )}
                </div>
                <p className="text-sm font-bold text-slate-200 truncate">{event.title}</p>
                {event.withWhom && (
                    <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                        <User className="w-3 h-3" /> {event.withWhom}
                    </p>
                )}
                {event.location && (
                    <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3" /> {event.location}
                    </p>
                )}
                {event.description && (
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{event.description}</p>
                )}
            </div>
            <div className="flex flex-col gap-1 flex-shrink-0">
                <button onClick={onEdit} className="text-slate-400 hover:text-blue-400 p-1.5"><Edit2 className="w-4 h-4" /></button>
                <button onClick={onDelete} className="text-slate-400 hover:text-red-400 p-1.5"><Trash2 className="w-4 h-4" /></button>
            </div>
        </li>
    );
};

interface FormProps { event: AgendaEvent | null; campaignId: string; onClose: () => void; }

const EventFormModal: React.FC<FormProps> = ({ event, campaignId, onClose }) => {
    const [title, setTitle] = React.useState(event?.title || '');
    const [startsAt, setStartsAt] = React.useState(event?.startsAt ? toLocalInput(event.startsAt) : toLocalInput(new Date().toISOString()));
    const [endsAt, setEndsAt] = React.useState(event?.endsAt ? toLocalInput(event.endsAt) : '');
    const [location, setLocation] = React.useState(event?.location || '');
    const [withWhom, setWithWhom] = React.useState(event?.withWhom || '');
    const [priority, setPriority] = React.useState<AgendaEvent['priority']>(event?.priority || 'media');
    const [category, setCategory] = React.useState(event?.category || 'reuniao');
    const [description, setDescription] = React.useState(event?.description || '');
    const [reminderMinutes, setReminderMinutes] = React.useState(event?.reminderMinutesBefore || 30);
    const [saving, setSaving] = React.useState(false);

    const save = async () => {
        if (!title.trim()) { alert('Título obrigatório.'); return; }
        if (!startsAt) { alert('Data e hora obrigatórias.'); return; }
        if (!location.trim()) { alert('Local obrigatório.'); return; }
        if (!withWhom.trim()) { alert('"Com quem" obrigatório.'); return; }
        setSaving(true);
        const payload: any = {
            campaignId,
            title: title.trim(),
            startsAt: new Date(startsAt).toISOString(),
            endsAt: endsAt ? new Date(endsAt).toISOString() : null,
            location: location.trim(),
            withWhom: withWhom.trim(),
            priority,
            category,
            description: description.trim() || null,
            reminderMinutesBefore: reminderMinutes,
        };
        const op = event
            ? supabase.from('agenda_events').update({ ...payload, reminderDispatched: false }).eq('id', event.id)
            : supabase.from('agenda_events').insert(payload);
        const { error } = await op;
        setSaving(false);
        if (error) { alert('Erro ao salvar: ' + error.message); return; }
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#161b22] border border-white/10 rounded-3xl w-full max-w-xl shadow-2xl">
                <div className="p-5 border-b border-white/5 flex justify-between items-center">
                    <h3 className="text-lg font-bold flex items-center gap-2"><Calendar className="w-5 h-5 text-emerald-400" /> {event ? 'Editar evento' : 'Novo evento'}</h3>
                    <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-5 space-y-3">
                    <div>
                        <label className="text-xs text-slate-400 block mb-1">Título *</label>
                        <input value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3" placeholder="Ex: Reunião com lideranças do bairro X" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-slate-400 block mb-1">Início *</label>
                            <input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3" />
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 block mb-1">Fim (opcional)</label>
                            <input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3" />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-slate-400 block mb-1">Local *</label>
                            <input value={location} onChange={e => setLocation(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3" placeholder="Ex: Praça Saens Peña - Tijuca" />
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 block mb-1">Com quem *</label>
                            <input value={withWhom} onChange={e => setWithWhom(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3" placeholder="Ex: Marcelo Silva, Equipe de Mídia" />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label className="text-xs text-slate-400 block mb-1">Prioridade *</label>
                            <select value={priority} onChange={e => setPriority(e.target.value as AgendaEvent['priority'])} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                                {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 block mb-1">Categoria</label>
                            <select value={category} onChange={e => setCategory(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 block mb-1 flex items-center gap-1"><Clock className="w-3 h-3" /> Lembrar (min)</label>
                            <select value={reminderMinutes} onChange={e => setReminderMinutes(Number(e.target.value))} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                                <option value={5}>5 min</option>
                                <option value={15}>15 min</option>
                                <option value={30}>30 min</option>
                                <option value={60}>1 hora</option>
                                <option value={120}>2 horas</option>
                                <option value={1440}>1 dia antes</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-slate-400 block mb-1">Descrição (opcional)</label>
                        <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3" />
                    </div>
                </div>
                <div className="p-5 border-t border-white/5 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700">Cancelar</button>
                    <button onClick={save} disabled={saving} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50">
                        {saving ? 'Salvando...' : event ? 'Atualizar' : 'Criar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// Converte ISO timestamp pra valor aceitável em <input type="datetime-local"> (sem timezone)
const toLocalInput = (iso: string): string => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default AgendaPanel;
