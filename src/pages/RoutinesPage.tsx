import * as React from 'react';
import { RefreshCw, Plus, Play, Pause, Archive, Trash2, Loader2, Clock, Webhook, Hand, CheckCircle, XCircle, SkipForward } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { useAuth } from '../contexts/AuthContext';
import { authedFetch } from '../lib/authedFetch';

type RoutineStatus = 'active' | 'paused' | 'archived';
type RunStatus = 'received' | 'running' | 'completed' | 'failed' | 'skipped';

interface Routine {
  id: string;
  campaignId: string;
  title: string;
  description: string | null;
  status: RoutineStatus;
  concurrencyPolicy: string;
  catchUpPolicy: string;
  lastTriggeredAt: string | null;
  createdAt: string;
}

interface Trigger {
  id: string;
  routineId: string;
  kind: 'cron' | 'webhook' | 'manual';
  label: string | null;
  enabled: boolean;
  cronExpression: string | null;
  timezone: string;
  nextRunAt: string | null;
  lastFiredAt: string | null;
}

interface RoutineRun {
  id: string;
  routineId: string;
  source: string;
  status: RunStatus;
  failureReason: string | null;
  triggeredAt: string;
  completedAt: string | null;
}

const RUN_STATUS_ICON: Record<RunStatus, React.ReactNode> = {
  received: <Clock className="w-3.5 h-3.5 text-slate-400" />,
  running: <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />,
  completed: <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />,
  failed: <XCircle className="w-3.5 h-3.5 text-red-400" />,
  skipped: <SkipForward className="w-3.5 h-3.5 text-slate-500" />,
};

const KIND_ICON: Record<string, React.ReactNode> = {
  cron: <Clock className="w-3.5 h-3.5" />,
  webhook: <Webhook className="w-3.5 h-3.5" />,
  manual: <Hand className="w-3.5 h-3.5" />,
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

const defaultRoutineForm = () => ({
  title: '',
  description: '',
  concurrencyPolicy: 'coalesce_if_active',
  catchUpPolicy: 'skip_missed',
});

const defaultTriggerForm = () => ({
  kind: 'cron' as 'cron' | 'webhook' | 'manual',
  label: '',
  cronExpression: '0 8 * * *',
  timezone: 'America/Sao_Paulo',
});

const RoutinesPage: React.FC = () => {
  const { user } = useAuth();
  const [routines, setRoutines] = React.useState<Routine[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<Routine | null>(null);
  const [triggers, setTriggers] = React.useState<Trigger[]>([]);
  const [runs, setRuns] = React.useState<RoutineRun[]>([]);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const [showRoutineModal, setShowRoutineModal] = React.useState(false);
  const [routineForm, setRoutineForm] = React.useState(defaultRoutineForm());
  const [showTriggerModal, setShowTriggerModal] = React.useState(false);
  const [triggerForm, setTriggerForm] = React.useState(defaultTriggerForm());
  const [saving, setSaving] = React.useState(false);
  const [dispatching, setDispatching] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!user?.campaignId) return;
    setLoading(true);
    try {
      const res = await authedFetch(`/api/v1/routines/routines?campaignId=${user.campaignId}`);
      const json = await res.json();
      setRoutines(json.routines ?? []);
    } finally {
      setLoading(false);
    }
  }, [user?.campaignId]);

  const loadDetail = React.useCallback(async (r: Routine) => {
    setDetailLoading(true);
    try {
      const [tRes, rRes] = await Promise.all([
        authedFetch(`/api/v1/routines/routines/${r.id}/triggers?campaignId=${user?.campaignId}`),
        authedFetch(`/api/v1/routines/routines/${r.id}/runs?campaignId=${user?.campaignId}`),
      ]);
      const [tJson, rJson] = await Promise.all([tRes.json(), rRes.json()]);
      setTriggers(tJson.triggers ?? []);
      setRuns(rJson.runs ?? []);
    } finally {
      setDetailLoading(false);
    }
  }, [user?.campaignId]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    if (selected) loadDetail(selected);
    else { setTriggers([]); setRuns([]); }
  }, [selected, loadDetail]);

  const selectRoutine = (r: Routine) => {
    setSelected(prev => prev?.id === r.id ? null : r);
  };

  const saveRoutine = async () => {
    if (!routineForm.title.trim() || !user?.campaignId) return;
    setSaving(true);
    try {
      await authedFetch('/api/v1/routines/routines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...routineForm, campaignId: user.campaignId }),
      });
      setShowRoutineModal(false);
      setRoutineForm(defaultRoutineForm());
      await load();
    } finally {
      setSaving(false);
    }
  };

  const patchStatus = async (r: Routine, status: RoutineStatus) => {
    await authedFetch(`/api/v1/routines/routines/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await load();
    if (selected?.id === r.id) setSelected(prev => prev ? { ...prev, status } : null);
  };

  const deleteRoutine = async (r: Routine) => {
    if (!confirm('Remover esta rotina?')) return;
    await authedFetch(`/api/v1/routines/routines/${r.id}`, { method: 'DELETE' });
    if (selected?.id === r.id) setSelected(null);
    await load();
  };

  const saveTrigger = async () => {
    if (!selected || !user?.campaignId) return;
    setSaving(true);
    try {
      await authedFetch(`/api/v1/routines/routines/${selected.id}/triggers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...triggerForm, campaignId: user.campaignId }),
      });
      setShowTriggerModal(false);
      setTriggerForm(defaultTriggerForm());
      await loadDetail(selected);
    } finally {
      setSaving(false);
    }
  };

  const toggleTrigger = async (t: Trigger) => {
    await authedFetch(`/api/v1/routines/triggers/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !t.enabled }),
    });
    if (selected) await loadDetail(selected);
  };

  const deleteTrigger = async (t: Trigger) => {
    await authedFetch(`/api/v1/routines/triggers/${t.id}`, { method: 'DELETE' });
    if (selected) await loadDetail(selected);
  };

  const manualRun = async (r: Routine) => {
    setDispatching(true);
    try {
      const res = await authedFetch(`/api/v1/routines/routines/${r.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: user?.campaignId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao disparar');
      await load();
      if (selected?.id === r.id) await loadDetail(r);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setDispatching(false);
    }
  };

  const STATUS_COLOR: Record<RoutineStatus, string> = {
    active: 'text-emerald-400',
    paused: 'text-amber-400',
    archived: 'text-slate-500',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-6 h-6 text-violet-400" />
          <h2 className="text-2xl font-bold text-slate-200">Rotinas de Agentes</h2>
        </div>
        <Button variant="primary" className="text-xs px-3 py-1.5" onClick={() => setShowRoutineModal(true)}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Nova Rotina
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
        </div>
      ) : routines.length === 0 ? (
        <Card>
          <p className="text-slate-500 text-sm text-center py-8">
            Nenhuma rotina criada. Rotinas automatizam tarefas recorrentes dos agentes.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
          {/* List */}
          <div className="space-y-2">
            {routines.map(r => (
              <div
                key={r.id}
                onClick={() => selectRoutine(r)}
                className={`p-3 rounded-xl border cursor-pointer transition-colors ${
                  selected?.id === r.id
                    ? 'border-violet-500/60 bg-violet-500/10'
                    : 'border-slate-700 hover:border-slate-600 bg-slate-800'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{r.title}</p>
                    {r.description && (
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{r.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`text-xs font-medium ${STATUS_COLOR[r.status]}`}>
                        {r.status === 'active' ? 'Ativa' : r.status === 'paused' ? 'Pausada' : 'Arquivada'}
                      </span>
                      {r.lastTriggeredAt && (
                        <span className="text-xs text-slate-500">{timeAgo(r.lastTriggeredAt)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => manualRun(r)}
                      disabled={dispatching || r.status === 'archived'}
                      title="Disparar manualmente"
                      className="p-1 text-slate-400 hover:text-violet-400 disabled:opacity-40"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                    {r.status === 'active' && (
                      <button onClick={() => patchStatus(r, 'paused')} title="Pausar" className="p-1 text-slate-400 hover:text-amber-400">
                        <Pause className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {r.status === 'paused' && (
                      <button onClick={() => patchStatus(r, 'active')} title="Ativar" className="p-1 text-slate-400 hover:text-emerald-400">
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {r.status !== 'archived' && (
                      <button onClick={() => patchStatus(r, 'archived')} title="Arquivar" className="p-1 text-slate-400 hover:text-slate-300">
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button onClick={() => deleteRoutine(r)} title="Remover" className="p-1 text-slate-400 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Detail */}
          {selected && (
            <div className="space-y-4">
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-300">Triggers</h3>
                  <Button variant="secondary" className="text-xs px-2 py-1" onClick={() => setShowTriggerModal(true)}>
                    <Plus className="w-3 h-3 mr-1" /> Adicionar
                  </Button>
                </div>
                {detailLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-slate-500 mx-auto" />
                ) : triggers.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">Sem triggers. Adicione um cron, webhook ou manual.</p>
                ) : (
                  <div className="space-y-2">
                    {triggers.map(t => (
                      <div key={t.id} className="flex items-center gap-3 p-2 rounded-lg bg-slate-700/40">
                        <span className={`text-slate-400 ${t.enabled ? '' : 'opacity-40'}`}>
                          {KIND_ICON[t.kind]}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-200">
                            {t.label ?? t.kind}
                            {t.cronExpression && (
                              <span className="text-slate-500 ml-2 font-mono">{t.cronExpression}</span>
                            )}
                          </p>
                          {t.nextRunAt && (
                            <p className="text-xs text-slate-500">próxima: {new Date(t.nextRunAt).toLocaleString('pt-BR')}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => toggleTrigger(t)}
                            className={`text-xs px-2 py-0.5 rounded ${t.enabled ? 'text-emerald-400 hover:text-amber-400' : 'text-slate-500 hover:text-emerald-400'}`}
                          >
                            {t.enabled ? 'On' : 'Off'}
                          </button>
                          <button onClick={() => deleteTrigger(t)} className="p-1 text-slate-500 hover:text-red-400">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <h3 className="text-sm font-semibold text-slate-300 mb-3">Execuções recentes</h3>
                {detailLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-slate-500 mx-auto" />
                ) : runs.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">Nenhuma execução registrada ainda.</p>
                ) : (
                  <div className="space-y-1.5">
                    {runs.map(run => (
                      <div key={run.id} className="flex items-center gap-3 py-1.5 border-b border-slate-700/50 last:border-0">
                        {RUN_STATUS_ICON[run.status]}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-300">{run.source} · {timeAgo(run.triggeredAt)}</p>
                          {run.failureReason && (
                            <p className="text-xs text-red-400 truncate">{run.failureReason}</p>
                          )}
                        </div>
                        <span className="text-xs text-slate-500">{run.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      )}

      {/* New Routine Modal */}
      {showRoutineModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold text-slate-100">Nova Rotina</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Título *</label>
                <input
                  value={routineForm.title}
                  onChange={e => setRoutineForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:border-violet-500"
                  placeholder="Ex: Relatório diário de engajamento"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Descrição</label>
                <textarea
                  value={routineForm.description}
                  onChange={e => setRoutineForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:border-violet-500 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Concorrência</label>
                  <select
                    value={routineForm.concurrencyPolicy}
                    onChange={e => setRoutineForm(f => ({ ...f, concurrencyPolicy: e.target.value }))}
                    className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600"
                  >
                    <option value="coalesce_if_active">Coalescência</option>
                    <option value="skip_if_active">Pular se ativa</option>
                    <option value="allow_parallel">Paralela</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Recuperação</label>
                  <select
                    value={routineForm.catchUpPolicy}
                    onChange={e => setRoutineForm(f => ({ ...f, catchUpPolicy: e.target.value }))}
                    className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600"
                  >
                    <option value="skip_missed">Pular perdidos</option>
                    <option value="run_once">Executar uma vez</option>
                    <option value="run_all">Executar todos</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="secondary" onClick={() => setShowRoutineModal(false)}>Cancelar</Button>
              <Button variant="primary" onClick={saveRoutine} disabled={saving || !routineForm.title.trim()}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Criar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* New Trigger Modal */}
      {showTriggerModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-lg font-semibold text-slate-100">Adicionar Trigger</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Tipo</label>
                <select
                  value={triggerForm.kind}
                  onChange={e => setTriggerForm(f => ({ ...f, kind: e.target.value as 'cron' | 'webhook' | 'manual' }))}
                  className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600"
                >
                  <option value="cron">Cron (agendado)</option>
                  <option value="webhook">Webhook</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Label</label>
                <input
                  value={triggerForm.label}
                  onChange={e => setTriggerForm(f => ({ ...f, label: e.target.value }))}
                  className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:border-violet-500"
                  placeholder="Ex: Diariamente às 8h"
                />
              </div>
              {triggerForm.kind === 'cron' && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Expressão Cron</label>
                  <input
                    value={triggerForm.cronExpression}
                    onChange={e => setTriggerForm(f => ({ ...f, cronExpression: e.target.value }))}
                    className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600 font-mono focus:outline-none focus:border-violet-500"
                    placeholder="0 8 * * *"
                  />
                  <p className="text-xs text-slate-500 mt-1">Formato: minuto hora dia-mês mês dia-semana</p>
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="secondary" onClick={() => setShowTriggerModal(false)}>Cancelar</Button>
              <Button variant="primary" onClick={saveTrigger} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Adicionar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoutinesPage;
