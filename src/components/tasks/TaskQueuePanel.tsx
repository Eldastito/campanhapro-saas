import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import {
  Clock, CheckCircle, XCircle, AlertTriangle, Play,
  RefreshCw, ShieldAlert, Loader2
} from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';

interface AgentTask {
  id: string;
  type: string;
  status: 'pending' | 'awaiting_approval' | 'approved' | 'running' | 'completed' | 'failed' | 'rejected';
  requiresApproval: boolean;
  result: string | null;
  costCents: number | null;
  attempts: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  pending: { label: 'Aguardando', icon: <Clock className="w-3.5 h-3.5" />, color: 'text-slate-400 bg-slate-500/20' },
  awaiting_approval: { label: 'Aguarda Aprovação', icon: <ShieldAlert className="w-3.5 h-3.5" />, color: 'text-amber-300 bg-amber-500/20' },
  approved: { label: 'Aprovado', icon: <CheckCircle className="w-3.5 h-3.5" />, color: 'text-sky-300 bg-sky-500/20' },
  running: { label: 'Executando', icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, color: 'text-indigo-300 bg-indigo-500/20' },
  completed: { label: 'Concluído', icon: <CheckCircle className="w-3.5 h-3.5" />, color: 'text-emerald-300 bg-emerald-500/20' },
  failed: { label: 'Falhou', icon: <XCircle className="w-3.5 h-3.5" />, color: 'text-red-300 bg-red-500/20' },
  rejected: { label: 'Rejeitado', icon: <XCircle className="w-3.5 h-3.5" />, color: 'text-slate-400 bg-slate-500/20' },
};

const TYPE_LABELS: Record<string, string> = {
  'strategic-plan': 'Plano Estratégico',
  'engagement-analysis': 'Análise de Engajamento',
  'risk-report': 'Relatório de Risco',
  'compliance-check': 'Verificação de Conformidade',
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>
      {meta.icon} {meta.label}
    </span>
  );
};

interface TaskRowProps {
  task: AgentTask;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRetry: (id: string) => void;
  loading: string | null;
}

const TaskRow: React.FC<TaskRowProps> = ({ task, onApprove, onReject, onRetry, loading }) => {
  const [expanded, setExpanded] = React.useState(false);
  const isWorking = loading === task.id;

  return (
    <div className="border border-slate-700 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-700/40 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <StatusBadge status={task.status} />
          <span className="text-sm font-medium text-slate-200 truncate">
            {TYPE_LABELS[task.type] ?? task.type}
          </span>
        </div>
        <div className="flex items-center gap-3 ml-3 shrink-0">
          {task.costCents != null && (
            <span className="text-xs text-slate-500">R${(task.costCents / 100).toFixed(2)}</span>
          )}
          <span className="text-xs text-slate-500">
            {new Date(task.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-slate-700/60 space-y-3">
          {task.result && (
            <div>
              <p className="text-xs font-semibold text-slate-400 mb-1">Resultado</p>
              <pre className="text-xs text-slate-300 whitespace-pre-wrap bg-slate-800 rounded p-2 max-h-32 overflow-y-auto">
                {(() => { try { return JSON.stringify(JSON.parse(task.result), null, 2); } catch { return task.result; } })()}
              </pre>
            </div>
          )}
          {task.errorMessage && (
            <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 rounded p-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {task.errorMessage}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {task.status === 'awaiting_approval' && (
              <>
                <Button variant="primary" className="text-xs px-3 py-1.5"
                  disabled={isWorking} onClick={() => onApprove(task.id)}>
                  {isWorking ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                  Aprovar e Executar
                </Button>
                <Button variant="secondary" className="text-xs px-3 py-1.5"
                  disabled={isWorking} onClick={() => onReject(task.id)}>
                  Rejeitar
                </Button>
              </>
            )}
            {task.status === 'failed' && (
              <Button variant="secondary" className="text-xs px-3 py-1.5"
                disabled={isWorking} onClick={() => onRetry(task.id)}>
                <RefreshCw className="w-3 h-3 mr-1" /> Tentar Novamente
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const TaskQueuePanel: React.FC = () => {
  const { user } = useAuth();
  const [tasks, setTasks] = React.useState<AgentTask[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);

  const fetchTasks = React.useCallback(async () => {
    if (!user?.campaignId) return;
    setIsLoading(true);
    try {
      const res = await authedFetch('/api/v1/paperclip/tasks');
      if (res.ok) {
        const json = await res.json();
        setTasks(json.tasks ?? []);
      }
    } catch {
      // empty state
    } finally {
      setIsLoading(false);
    }
  }, [user?.campaignId]);

  React.useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const callAction = async (taskId: string, action: 'approve' | 'reject' | 'retry') => {
    setActionLoading(taskId);
    try {
      await authedFetch(`/api/v1/paperclip/tasks/${taskId}/${action}`, { method: 'POST' });
      await fetchTasks();
    } finally {
      setActionLoading(null);
    }
  };

  const pendingApproval = tasks.filter(t => t.status === 'awaiting_approval').length;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-200">Fila de Tarefas de Agentes</h3>
          {pendingApproval > 0 && (
            <p className="text-xs text-amber-400 mt-0.5">
              {pendingApproval} tarefa{pendingApproval !== 1 ? 's' : ''} aguarda{pendingApproval === 1 ? '' : 'm'} aprovação humana
            </p>
          )}
        </div>
        <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={fetchTasks} disabled={isLoading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8 text-slate-500">
          <RefreshCw className="w-5 h-5 animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">
          <Clock className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nenhuma tarefa na fila.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map(t => (
            <TaskRow
              key={t.id}
              task={t}
              onApprove={id => callAction(id, 'approve')}
              onReject={id => callAction(id, 'reject')}
              onRetry={id => callAction(id, 'retry')}
              loading={actionLoading}
            />
          ))}
        </div>
      )}
    </Card>
  );
};

export default TaskQueuePanel;
