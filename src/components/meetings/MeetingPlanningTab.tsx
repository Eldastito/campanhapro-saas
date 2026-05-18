import * as React from 'react';
import {
  Plus, Trash2, Mic, Square, Loader2, X,
  Sparkles, FileText, CheckCircle2, Clock, ChevronRight,
  AlertCircle, RefreshCw, ClipboardList, Wand2, CheckCheck,
  Calendar, Users, Target, Zap
} from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';
import { supabase } from '../../lib/supabaseClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MeetingStatus = 'draft' | 'transcribed' | 'analyzed';

interface AgendaItem { topic: string; description: string }
interface ActionItem {
  title: string;
  assignee: string | null;
  dueDate: string | null;
  bucket: string;
  priority: 'alta' | 'media' | 'baixa';
  approved: boolean;
  agentTaskId: string | null;
}

interface Meeting {
  id: string;
  title: string;
  status: MeetingStatus;
  scheduledAt: string | null;
  recordedAt: string | null;
  duration: number | null;
  createdAt: string;
  updatedAt: string;
  agenda?: AgendaItem[] | null;
  transcript?: string | null;
  summary?: string | null;
  highlights?: string[] | null;
  actions?: ActionItem[] | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<MeetingStatus, string> = {
  draft: 'Rascunho',
  transcribed: 'Transcrita',
  analyzed: 'Analisada',
};
const STATUS_COLOR: Record<MeetingStatus, string> = {
  draft: 'text-slate-400 bg-slate-800 border-slate-700',
  transcribed: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  analyzed: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
};
const PRIORITY_COLOR: Record<string, string> = {
  alta: 'text-red-400 bg-red-500/10',
  media: 'text-amber-400 bg-amber-500/10',
  baixa: 'text-slate-400 bg-slate-800',
};

function fmtDuration(secs: number | null): string {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const MeetingPlanningTab: React.FC = () => {
  const [meetings, setMeetings] = React.useState<Meeting[]>([]);
  const [selected, setSelected] = React.useState<Meeting | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // New meeting modal
  const [showNew, setShowNew] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState('');
  const [newScheduledAt, setNewScheduledAt] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  // Recording state
  const [recording, setRecording] = React.useState(false);
  const [recSeconds, setRecSeconds] = React.useState(0);
  const recTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);

  // Transcript editing
  const [transcript, setTranscript] = React.useState('');
  const [transcribing, setTranscribing] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [savingTranscript, setSavingTranscript] = React.useState(false);

  // Action approval
  const [approvingIdx, setApprovingIdx] = React.useState<number | null>(null);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadMeetings = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch('/api/v1/meetings');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao carregar reuniões');
      setMeetings(json.meetings ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { loadMeetings(); }, [loadMeetings]);

  const loadMeeting = React.useCallback(async (id: string) => {
    try {
      const res = await authedFetch(`/api/v1/meetings/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSelected(json.meeting);
      setTranscript(json.meeting.transcript ?? '');
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const selectMeeting = React.useCallback((m: Meeting) => {
    loadMeeting(m.id);
  }, [loadMeeting]);

  // ---------------------------------------------------------------------------
  // Create meeting
  // ---------------------------------------------------------------------------

  const createMeeting = async () => {
    if (newTitle.trim().length < 2) return;
    setCreating(true);
    setError(null);
    try {
      const res = await authedFetch('/api/v1/meetings', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle.trim(),
          scheduledAt: newScheduledAt || undefined,
          generateAgenda: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao criar reunião');
      setShowNew(false);
      setNewTitle('');
      setNewScheduledAt('');
      await loadMeetings();
      setSelected(json.meeting);
      setTranscript('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete meeting
  // ---------------------------------------------------------------------------

  const deleteMeeting = async (id: string) => {
    if (!confirm('Excluir esta reunião permanentemente?')) return;
    try {
      await authedFetch(`/api/v1/meetings/${id}`, { method: 'DELETE' });
      if (selected?.id === id) setSelected(null);
      await loadMeetings();
    } catch (e: any) {
      setError(e.message);
    }
  };

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => { stream.getTracks().forEach(t => t.stop()); };
      mr.start(1000); // collect every second
      mediaRecorderRef.current = mr;
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch (e: any) {
      setError('Microfone não acessível: ' + e.message);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    setRecording(false);
  };

  // When recording stops, auto-upload to transcribe
  React.useEffect(() => {
    if (recording || audioChunksRef.current.length === 0 || !selected) return;
    const chunks = [...audioChunksRef.current];
    audioChunksRef.current = [];
    if (chunks.length === 0) return;

    const blob = new Blob(chunks, { type: 'audio/webm' });
    const durationSecs = recSeconds;

    setTranscribing(true);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/v1/meetings/${selected.id}/transcribe`, {
          method: 'POST',
          headers: {
            'Content-Type': 'audio/webm',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: blob,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Erro na transcrição');
        setTranscript(json.transcript ?? '');
        // Update duration
        if (durationSecs > 0) {
          await authedFetch(`/api/v1/meetings/${selected.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ duration: durationSecs }),
          });
        }
        await loadMeeting(selected.id);
      } catch (e: any) {
        setError('Transcrição falhou: ' + e.message);
      } finally {
        setTranscribing(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  // Cleanup timer on unmount
  React.useEffect(() => () => {
    if (recTimerRef.current) clearInterval(recTimerRef.current);
  }, []);

  // ---------------------------------------------------------------------------
  // Save transcript manually
  // ---------------------------------------------------------------------------

  const saveTranscript = async () => {
    if (!selected) return;
    setSavingTranscript(true);
    try {
      await authedFetch(`/api/v1/meetings/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ transcript, status: 'transcribed' }),
      });
      await loadMeeting(selected.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingTranscript(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Analyze
  // ---------------------------------------------------------------------------

  const analyze = async () => {
    if (!selected) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/v1/meetings/${selected.id}/analyze`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro na análise');
      await loadMeeting(selected.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Approve action
  // ---------------------------------------------------------------------------

  const approveAction = async (idx: number) => {
    if (!selected) return;
    setApprovingIdx(idx);
    setError(null);
    try {
      const res = await authedFetch(`/api/v1/meetings/${selected.id}/actions/${idx}/approve`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao aprovar ação');
      await loadMeeting(selected.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setApprovingIdx(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderAgenda = (agenda: AgendaItem[] | null | undefined) => {
    if (!agenda?.length) return (
      <p className="text-sm text-slate-500 italic">Pauta não gerada ainda.</p>
    );
    return (
      <ol className="space-y-2">
        {agenda.map((item, i) => (
          <li key={i} className="flex gap-3 p-3 rounded-lg bg-slate-800/60 border border-slate-700/60">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600/30 text-indigo-300 text-xs font-bold flex items-center justify-center">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-medium text-slate-200">{item.topic}</p>
              {item.description && (
                <p className="text-xs text-slate-400 mt-0.5">{item.description}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    );
  };

  const renderActions = (actions: ActionItem[] | null | undefined) => {
    if (!actions?.length) return null;
    return (
      <div className="space-y-2">
        {actions.map((action, i) => (
          <div
            key={i}
            className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
              action.approved
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : 'border-slate-700 bg-slate-900/60'
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${action.approved ? 'text-emerald-300' : 'text-slate-200'}`}>
                {action.title}
              </p>
              <div className="flex flex-wrap gap-2 mt-1">
                {action.assignee && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                    <Users className="w-3 h-3" />{action.assignee}
                  </span>
                )}
                {action.dueDate && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                    <Calendar className="w-3 h-3" />{action.dueDate}
                  </span>
                )}
                {action.bucket && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                    <Target className="w-3 h-3" />{action.bucket}
                  </span>
                )}
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_COLOR[action.priority] ?? PRIORITY_COLOR.media}`}>
                  {action.priority}
                </span>
              </div>
              {action.approved && action.agentTaskId && (
                <p className="text-[10px] text-emerald-500/70 mt-1">
                  Tarefa criada: {action.agentTaskId.slice(0, 8)}…
                </p>
              )}
            </div>
            {action.approved ? (
              <CheckCheck className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            ) : (
              <button
                onClick={() => approveAction(i)}
                disabled={approvingIdx === i}
                className="flex-shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
              >
                {approvingIdx === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                Aprovar
              </button>
            )}
          </div>
        ))}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Meeting detail panel
  // ---------------------------------------------------------------------------

  const renderDetail = () => {
    if (!selected) return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-center">
        <ClipboardList className="w-12 h-12 text-slate-600 mb-4" />
        <p className="text-slate-400 text-sm">Selecione uma reunião ou crie uma nova</p>
        <button
          onClick={() => setShowNew(true)}
          className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
        >
          <Plus className="w-4 h-4" />
          Nova Reunião
        </button>
      </div>
    );

    const hasTranscript = !!(selected.transcript || transcript.trim());
    const hasAnalysis = selected.status === 'analyzed' && !!selected.summary;

    return (
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">{selected.title}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_COLOR[selected.status]}`}>
                {STATUS_LABEL[selected.status]}
              </span>
              {selected.scheduledAt && (
                <span className="text-xs text-slate-500">{fmtDate(selected.scheduledAt)}</span>
              )}
              {selected.duration && (
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" />{fmtDuration(selected.duration)}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => deleteMeeting(selected.id)}
            className="p-1.5 rounded text-red-400 hover:bg-red-500/20"
            title="Excluir reunião"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Agenda */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <ClipboardList className="w-4 h-4 text-indigo-400" />
            <h4 className="text-sm font-semibold text-slate-300">Pauta Sugerida pela IA</h4>
          </div>
          {renderAgenda(selected.agenda)}
        </section>

        {/* Recording */}
        <section className="border border-slate-700/60 rounded-xl p-4 bg-slate-900/40">
          <div className="flex items-center gap-2 mb-3">
            <Mic className="w-4 h-4 text-rose-400" />
            <h4 className="text-sm font-semibold text-slate-300">Gravação da Reunião</h4>
          </div>

          {recording ? (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-rose-400">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-sm font-mono">{fmtDuration(recSeconds)}</span>
                <span className="text-xs text-rose-300/70">Gravando…</span>
              </div>
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm"
              >
                <Square className="w-3.5 h-3.5" />
                Parar e Transcrever
              </button>
            </div>
          ) : transcribing ? (
            <div className="flex items-center gap-2 text-amber-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Transcrevendo com Whisper…</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={startRecording}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-600/20 border border-rose-500/30 hover:bg-rose-500/20 text-rose-300 text-sm"
              >
                <Mic className="w-3.5 h-3.5" />
                Iniciar Gravação
              </button>
              <span className="text-xs text-slate-500">ou cole a ata manualmente abaixo</span>
            </div>
          )}
        </section>

        {/* Transcript */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-sky-400" />
              <h4 className="text-sm font-semibold text-slate-300">Ata / Transcrição</h4>
            </div>
            {transcript !== (selected.transcript ?? '') && (
              <button
                onClick={saveTranscript}
                disabled={savingTranscript}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50"
              >
                {savingTranscript ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Salvar
              </button>
            )}
          </div>
          <textarea
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
            placeholder="Cole ou edite a ata aqui…"
            rows={8}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-600 resize-y font-mono leading-relaxed"
          />
        </section>

        {/* Analyze button */}
        {hasTranscript && !hasAnalysis && (
          <button
            onClick={analyze}
            disabled={analyzing}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-medium text-sm disabled:opacity-50"
          >
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {analyzing ? 'Analisando com IA…' : 'Gerar Resumo & Ações com IA'}
          </button>
        )}

        {/* Analysis results */}
        {hasAnalysis && (
          <>
            {/* Summary */}
            <section className="border border-indigo-500/20 rounded-xl p-4 bg-indigo-500/5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <h4 className="text-sm font-semibold text-indigo-300">Resumo Executivo</h4>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">{selected.summary}</p>

              {selected.highlights && selected.highlights.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {selected.highlights.map((h, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-slate-400">
                      <ChevronRight className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
                      {h}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Actions */}
            {selected.actions && selected.actions.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-sm font-semibold text-slate-300">
                    Ações Sugeridas
                    <span className="text-xs text-slate-500 font-normal ml-2">
                      Aprove para criar tarefas de agente
                    </span>
                  </h4>
                </div>
                {renderActions(selected.actions)}
              </section>
            )}

            {/* Re-analyze button */}
            <button
              onClick={analyze}
              disabled={analyzing}
              className="flex items-center justify-center gap-2 w-full py-2 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 text-xs disabled:opacity-50"
            >
              {analyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Re-analisar
            </button>
          </>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Root render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Reuniões de Planejamento</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            IA gera a pauta, grava a reunião, transcreve e sugere ações.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Nova Reunião
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Meeting list */}
        <div className="lg:col-span-1 bg-slate-900/50 border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <span className="text-sm font-semibold text-slate-300">Histórico</span>
            <button onClick={loadMeetings} disabled={loading} className="text-slate-500 hover:text-slate-300">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
            </div>
          ) : meetings.length === 0 ? (
            <div className="text-center py-10 px-4">
              <ClipboardList className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nenhuma reunião ainda.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {meetings.map(m => (
                <li key={m.id}>
                  <button
                    onClick={() => selectMeeting(m)}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-800/60 transition-colors ${
                      selected?.id === m.id ? 'bg-slate-800/80' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-200 truncate flex-1">{m.title}</p>
                      <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full border flex-shrink-0 ${STATUS_COLOR[m.status]}`}>
                        {STATUS_LABEL[m.status]}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{fmtDate(m.scheduledAt ?? m.createdAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Meeting detail */}
        <div className="lg:col-span-2 bg-slate-900/50 border border-slate-700/50 rounded-xl p-5">
          {renderDetail()}
        </div>
      </div>

      {/* New meeting modal */}
      {showNew && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => !creating && setShowNew(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold text-slate-200 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                Nova Reunião de Planejamento
              </h4>
              <button onClick={() => !creating && setShowNew(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 mb-4">
              A IA vai gerar automaticamente a pauta com base nas metas, orçamento e agenda da campanha.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Título da reunião</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="ex: Reunião Semanal de Coordenação"
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  onKeyDown={e => e.key === 'Enter' && createMeeting()}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Data agendada (opcional)</label>
                <input
                  type="datetime-local"
                  value={newScheduledAt}
                  onChange={e => setNewScheduledAt(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowNew(false)}
                disabled={creating}
                className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
              >
                Cancelar
              </button>
              <button
                onClick={createMeeting}
                disabled={creating || newTitle.trim().length < 2}
                className="flex items-center gap-2 px-4 py-1.5 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
              >
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {creating ? 'Criando pauta…' : 'Criar com Pauta IA'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingPlanningTab;
