import * as React from 'react';
import {
  Calendar, Plus, Edit2, Trash2, MapPin, BellRing, X, Clock, User,
  ChevronLeft, ChevronRight, Check,
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

export interface AgendaEvent {
    id: string;
    campaignId: string;
    title: string;
    description: string | null;
    startsAt: string;
    endsAt: string | null;
    location: string | null;
    withWhom: string | null;
    priority: 'critica' | 'alta' | 'media' | 'baixa';
    category: string | null;
    status: 'pendente' | 'confirmado' | 'aguardando_ok' | 'concluido' | 'cancelado';
    reminderMinutesBefore: number;
    reminderDispatched: boolean;
    createdAt: string;
}

const PRIORITY_OPTIONS: { value: AgendaEvent['priority']; label: string; dot: string; badge: string }[] = [
    { value: 'critica', label: 'Crítica', dot: 'bg-red-500',    badge: 'text-red-400 bg-red-500/10 border-red-500/30' },
    { value: 'alta',    label: 'Alta',    dot: 'bg-orange-500', badge: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
    { value: 'media',   label: 'Média',   dot: 'bg-amber-500',  badge: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
    { value: 'baixa',   label: 'Baixa',   dot: 'bg-slate-500',  badge: 'text-slate-400 bg-slate-500/10 border-slate-500/30' },
];

const STATUS_OPTIONS: { value: AgendaEvent['status']; label: string; color: string }[] = [
    { value: 'pendente',      label: 'Pendente',        color: 'text-slate-400' },
    { value: 'confirmado',    label: 'Confirmado ✅',   color: 'text-emerald-400' },
    { value: 'aguardando_ok', label: 'Aguardando OK ⏳', color: 'text-amber-400' },
    { value: 'concluido',     label: 'Concluído',       color: 'text-indigo-400' },
    { value: 'cancelado',     label: 'Cancelado ❌',    color: 'text-red-400' },
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
    voiceSlot?: React.ReactNode;
}

const AgendaPanel: React.FC<AgendaPanelProps> = ({ voiceSlot }) => {
    const { user } = useAuth();
    const [events, setEvents] = React.useState<AgendaEvent[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [editing, setEditing] = React.useState<AgendaEvent | null>(null);
    const [showForm, setShowForm] = React.useState(false);
    const [notifPermission, setNotifPermission] = React.useState<NotificationPermission>('default');
    const [selectedDate, setSelectedDate] = React.useState<string>(todayStr());
    const [currentMonth, setCurrentMonth] = React.useState(new Date());

    const fetchEvents = React.useCallback(async () => {
        if (!user?.campaignId) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('agenda_events')
            .select('*')
            .eq('campaignId', user.campaignId)
            .order('startsAt', { ascending: true });
        setLoading(false);
        if (error) { console.error('[Agenda] fetch error:', error); return; }
        setEvents((data as AgendaEvent[]) || []);
    }, [user?.campaignId]);

    React.useEffect(() => {
        fetchEvents();
        if (!user?.campaignId) return;
        const ch = supabase
            .channel(`agenda-${user.campaignId}-${Date.now()}`)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'agenda_events',
                filter: `campaignId=eq.${user.campaignId}`,
            }, () => fetchEvents())
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [user?.campaignId, fetchEvents]);

    React.useEffect(() => {
        if (typeof Notification !== 'undefined') setNotifPermission(Notification.permission);
    }, []);

    // Browser notification reminders
    React.useEffect(() => {
        if (notifPermission !== 'granted' || events.length === 0) return;
        const intv = setInterval(() => {
            const now = Date.now();
            for (const e of events) {
                if (e.reminderDispatched || e.status === 'cancelado') continue;
                const triggerAt = new Date(e.startsAt).getTime() - e.reminderMinutesBefore * 60_000;
                if (now < triggerAt || now > triggerAt + 60_000) continue;
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
                    console.warn('[Agenda] notif error:', err);
                }
            }
        }, 30_000);
        return () => clearInterval(intv);
    }, [events, notifPermission, fetchEvents]);

    const requestNotifs = async () => {
        if (typeof Notification === 'undefined') { alert('Seu navegador não suporta notificações.'); return; }
        const result = await Notification.requestPermission();
        setNotifPermission(result);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Remover este evento da agenda?')) return;
        const { error } = await supabase.from('agenda_events').delete().eq('id', id);
        if (error) alert('Erro ao remover: ' + error.message);
    };

    const handleStatusUpdate = async (id: string, status: AgendaEvent['status']) => {
        await supabase.from('agenda_events').update({ status }).eq('id', id);
    };

    // Calendar helpers
    const today = todayStr();
    const datesWithEvents = React.useMemo(() => {
        const s = new Set<string>();
        for (const e of events) {
            if (e.status !== 'cancelado') s.add(e.startsAt.slice(0, 10));
        }
        return s;
    }, [events]);

    const dayEvents = React.useMemo(() =>
        events
            .filter(e => e.startsAt.slice(0, 10) === selectedDate && e.status !== 'cancelado')
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
        [events, selectedDate]);

    const calDays = React.useMemo(() => getDaysInMonth(currentMonth), [currentMonth]);
    const monthLabel = currentMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    const toDateStr = (day: number) => {
        const y = currentMonth.getFullYear();
        const m = String(currentMonth.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}-${String(day).padStart(2, '0')}`;
    };

    const totalActive = events.filter(e => e.status !== 'cancelado').length;
    const totalHigh = events.filter(e => (e.priority === 'critica' || e.priority === 'alta') && e.status !== 'cancelado').length;
    const totalToday = events.filter(e => e.startsAt.slice(0, 10) === today && e.status !== 'cancelado').length;
    const totalAwaiting = events.filter(e => e.status === 'aguardando_ok').length;

    return (
        <div className="flex bg-[#161b22] border border-white/5 rounded-3xl overflow-hidden" style={{ minHeight: 520 }}>

            {/* ── Left: calendar + mini stats ── */}
            <div className="w-72 flex-shrink-0 border-r border-white/5 flex flex-col bg-slate-900/30">

                {/* Calendar */}
                <div className="p-5 border-b border-white/5">
                    <div className="flex items-center justify-between mb-4">
                        <button onClick={() => setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() - 1))}
                            className="p-1 hover:bg-slate-800 rounded transition-colors">
                            <ChevronLeft className="w-4 h-4 text-slate-400" />
                        </button>
                        <span className="text-sm font-semibold text-slate-200 capitalize">{monthLabel}</span>
                        <button onClick={() => setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() + 1))}
                            className="p-1 hover:bg-slate-800 rounded transition-colors">
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                        </button>
                    </div>
                    <div className="grid grid-cols-7 gap-0.5 mb-1">
                        {['D','S','T','Q','Q','S','S'].map((d, i) => (
                            <div key={i} className="text-center text-[10px] font-medium text-slate-600 py-1">{d}</div>
                        ))}
                    </div>
                    <div className="grid grid-cols-7 gap-0.5">
                        {calDays.map((day, i) => {
                            if (!day) return <div key={i} />;
                            const ds = toDateStr(day);
                            const isToday = ds === today;
                            const isSelected = ds === selectedDate;
                            const hasEv = datesWithEvents.has(ds);
                            return (
                                <button key={i} onClick={() => setSelectedDate(ds)}
                                    className={`relative h-8 w-full rounded text-xs font-medium transition-all
                                        ${isSelected ? 'bg-emerald-600 text-white' : isToday ? 'bg-emerald-600/20 text-emerald-400' : 'text-slate-400 hover:bg-slate-800'}`}>
                                    {day}
                                    {hasEv && !isSelected && (
                                        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-500" />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Mini stats */}
                <div className="p-5 space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Resumo</p>
                    {[
                        { label: 'Total de eventos', value: totalActive },
                        { label: 'Alta prioridade',  value: totalHigh },
                        { label: 'Hoje',             value: totalToday },
                        { label: 'Aguardando OK',    value: totalAwaiting },
                    ].map(s => (
                        <div key={s.label} className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">{s.label}</span>
                            <span className="text-sm font-bold text-slate-200">{s.value}</span>
                        </div>
                    ))}
                </div>

                {/* Actions */}
                <div className="p-5 pt-0 space-y-2 mt-auto">
                    {notifPermission !== 'granted' && (
                        <button onClick={requestNotifs}
                            className="w-full text-xs px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/20 flex items-center justify-center gap-1">
                            <BellRing className="w-3 h-3" /> Ativar lembretes
                        </button>
                    )}
                </div>
            </div>

            {/* ── Right: event list ── */}
            <div className="flex-1 flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-slate-900/20">
                    <div>
                        <h2 className="text-lg font-bold text-slate-100">
                            {new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', {
                                weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
                            })}
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                            {dayEvents.length} compromisso(s) · {totalActive} total
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {voiceSlot}
                        <button
                            onClick={() => { setEditing(null); setShowForm(true); }}
                            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded-xl text-sm font-bold transition-colors">
                            <Plus className="w-4 h-4" /> Novo evento
                        </button>
                    </div>
                </div>

                {/* Event list */}
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-slate-400">Carregando...</div>
                    ) : dayEvents.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                            <Calendar className="w-12 h-12 text-slate-700 mb-3" />
                            <p className="text-slate-500 text-sm">Nenhum compromisso para este dia.</p>
                            <button onClick={() => { setEditing(null); setShowForm(true); }}
                                className="mt-3 text-emerald-400 text-sm hover:text-emerald-300 transition-colors">
                                + Adicionar compromisso
                            </button>
                        </div>
                    ) : dayEvents.map(ev => (
                        <EventCard
                            key={ev.id}
                            event={ev}
                            onEdit={() => { setEditing(ev); setShowForm(true); }}
                            onDelete={() => handleDelete(ev.id)}
                            onStatusChange={s => handleStatusUpdate(ev.id, s)}
                        />
                    ))}
                </div>
            </div>

            {showForm && (
                <EventFormModal
                    event={editing}
                    campaignId={user?.campaignId || ''}
                    onClose={() => { setShowForm(false); setEditing(null); }}
                    defaultDate={selectedDate}
                />
            )}
        </div>
    );
};

interface EventCardProps {
    event: AgendaEvent;
    onEdit: () => void;
    onDelete: () => void;
    onStatusChange: (s: AgendaEvent['status']) => void;
}

const EventCard: React.FC<EventCardProps> = ({ event, onEdit, onDelete, onStatusChange }) => {
    const dt = new Date(event.startsAt);
    const timeStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const cat = CATEGORIES.find(c => c.value === event.category)?.label;
    const prio = PRIORITY_OPTIONS.find(p => p.value === event.priority);
    const status = STATUS_OPTIONS.find(s => s.value === event.status);

    return (
        <div className={`group bg-slate-900/60 border rounded-xl p-4 transition-all hover:border-slate-600
            ${event.priority === 'critica' ? 'border-red-500/30 hover:border-red-500/50' :
              event.priority === 'alta'    ? 'border-orange-500/20 hover:border-orange-500/40' :
              event.priority === 'media'   ? 'border-amber-500/15 hover:border-amber-500/30' :
              'border-slate-800'}`}>

            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                    {prio && <div className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${prio.dot}`} />}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-semibold text-slate-100 text-sm">{event.title}</span>
                            {prio && (
                                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${prio.badge}`}>
                                    {prio.label}
                                </span>
                            )}
                            {cat && <span className="text-[10px] uppercase tracking-wider text-slate-500">{cat}</span>}
                        </div>
                        <div className="space-y-0.5 mt-1">
                            <p className="text-xs text-slate-400 flex items-center gap-1.5">
                                <Clock className="w-3 h-3" /> {timeStr}
                            </p>
                            {event.withWhom && (
                                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                                    <User className="w-3 h-3" /> {event.withWhom}
                                </p>
                            )}
                            {event.location && (
                                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                                    <MapPin className="w-3 h-3" /> {event.location}
                                </p>
                            )}
                            {event.description && (
                                <p className="text-xs text-slate-500 italic mt-1 line-clamp-2">{event.description}</p>
                            )}
                        </div>
                        {status && (
                            <p className={`text-[11px] mt-2 font-medium ${status.color}`}>{status.label}</p>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    {event.status !== 'concluido' && (
                        <button onClick={() => onStatusChange('concluido')} title="Concluir"
                            className="p-1.5 hover:bg-emerald-500/20 text-slate-500 hover:text-emerald-400 rounded-lg transition-colors">
                            <Check className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <button onClick={onEdit}
                        className="p-1.5 hover:bg-blue-500/20 text-slate-500 hover:text-blue-400 rounded-lg transition-colors">
                        <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={onDelete}
                        className="p-1.5 hover:bg-red-500/20 text-slate-500 hover:text-red-400 rounded-lg transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>
        </div>
    );
};

interface FormProps {
    event: AgendaEvent | null;
    campaignId: string;
    onClose: () => void;
    defaultDate?: string;
}

const EventFormModal: React.FC<FormProps> = ({ event, campaignId, onClose, defaultDate }) => {
    const defaultStartsAt = event?.startsAt
        ? toLocalInput(event.startsAt)
        : defaultDate
            ? `${defaultDate}T09:00`
            : toLocalInput(new Date().toISOString());

    const [title, setTitle] = React.useState(event?.title || '');
    const [startsAt, setStartsAt] = React.useState(defaultStartsAt);
    const [endsAt, setEndsAt] = React.useState(event?.endsAt ? toLocalInput(event.endsAt) : '');
    const [location, setLocation] = React.useState(event?.location || '');
    const [withWhom, setWithWhom] = React.useState(event?.withWhom || '');
    const [priority, setPriority] = React.useState<AgendaEvent['priority']>(event?.priority || 'media');
    const [status, setStatus] = React.useState<AgendaEvent['status']>(event?.status || 'pendente');
    const [category, setCategory] = React.useState(event?.category || 'reuniao');
    const [description, setDescription] = React.useState(event?.description || '');
    const [reminderMinutes, setReminderMinutes] = React.useState(event?.reminderMinutesBefore || 30);
    const [saving, setSaving] = React.useState(false);

    const save = async () => {
        if (!title.trim()) { alert('Título obrigatório.'); return; }
        if (!startsAt) { alert('Data e hora obrigatórias.'); return; }
        setSaving(true);
        const payload: Record<string, unknown> = {
            campaignId,
            title: title.trim(),
            startsAt: new Date(startsAt).toISOString(),
            endsAt: endsAt ? new Date(endsAt).toISOString() : null,
            location: location.trim() || null,
            withWhom: withWhom.trim() || null,
            priority,
            status,
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
                    <h3 className="text-lg font-bold flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-emerald-400" />
                        {event ? 'Editar evento' : 'Novo evento'}
                    </h3>
                    <button onClick={onClose} className="text-slate-500 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                    <div>
                        <label className="text-xs text-slate-400 block mb-1">Título *</label>
                        <input value={title} onChange={e => setTitle(e.target.value)}
                            className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-slate-100"
                            placeholder="Ex: Reunião com lideranças do bairro X" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-slate-400 block mb-1">Início *</label>
                            <input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)}
                                className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-slate-100" />
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 block mb-1">Fim (opcional)</label>
                            <input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)}
                                className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-slate-100" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-slate-400 block mb-1">Local</label>
                            <input value={location} onChange={e => setLocation(e.target.value)}
                                className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-slate-100"
                                placeholder="Ex: Praça Central" />
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 block mb-1">Com quem</label>
                            <input value={withWhom} onChange={e => setWithWhom(e.target.value)}
                                className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-slate-100"
                                placeholder="Ex: Equipe de Mídia" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-slate-400 block mb-1">Prioridade</label>
                            <select value={priority} onChange={e => setPriority(e.target.value as AgendaEvent['priority'])}
                                className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-slate-100">
                                {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 block mb-1">Status</label>
                            <select value={status} onChange={e => setStatus(e.target.value as AgendaEvent['status'])}
                                className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-slate-100">
                                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-slate-400 block mb-1">Categoria</label>
                            <select value={category} onChange={e => setCategory(e.target.value)}
                                className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-slate-100">
                                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 block mb-1 flex items-center gap-1">
                                <Clock className="w-3 h-3" /> Lembrar antes
                            </label>
                            <select value={reminderMinutes} onChange={e => setReminderMinutes(Number(e.target.value))}
                                className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-slate-100">
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
                        <label className="text-xs text-slate-400 block mb-1">Descrição / Observações</label>
                        <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
                            className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-slate-100 resize-none" />
                    </div>
                </div>
                <div className="p-5 border-t border-white/5 flex justify-end gap-2">
                    <button onClick={onClose}
                        className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700">
                        Cancelar
                    </button>
                    <button onClick={save} disabled={saving}
                        className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50">
                        {saving ? 'Salvando...' : event ? 'Atualizar' : 'Criar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

function todayStr(): string {
    return new Date().toISOString().slice(0, 10);
}

function getDaysInMonth(d: Date): (number | null)[] {
    const year = d.getFullYear(), month = d.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const total = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = Array(firstDay).fill(null);
    for (let i = 1; i <= total; i++) days.push(i);
    return days;
}

function toLocalInput(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default AgendaPanel;
