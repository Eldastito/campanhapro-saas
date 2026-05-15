import * as React from 'react';
import { Cpu, Plus, Loader2 } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import TaskQueuePanel from '../components/tasks/TaskQueuePanel';
import { useAuth } from '../contexts/AuthContext';

const TASK_TYPES = [
  { value: 'strategic-plan', label: 'Plano Estratégico', description: 'Análise situacional + diretrizes para os próximos 7 dias' },
  { value: 'engagement-analysis', label: 'Análise de Engajamento', description: 'Diagnóstico do funil de conversão e jornada do eleitor' },
  { value: 'risk-report', label: 'Relatório de Risco', description: 'Identificação de ameaças territoriais e de rejeição' },
  { value: 'compliance-check', label: 'Verificação de Conformidade', description: 'Auditoria de dados contra regras LGPD e TSE' },
];

const AgentTasksPage: React.FC = () => {
  const { user } = useAuth();
  const [selectedType, setSelectedType] = React.useState<string>('strategic-plan');
  const [requiresApproval, setRequiresApproval] = React.useState(true);
  const [dispatching, setDispatching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const handleDispatch = async () => {
    if (!user?.campaignId || dispatching) return;
    setDispatching(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/paperclip/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: user.campaignId,
          type: selectedType,
          payload: { requestedAt: new Date().toISOString() },
          requiresApproval,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao despachar tarefa');
      setRefreshKey(k => k + 1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Cpu className="w-6 h-6 text-indigo-400" />
        <h2 className="text-2xl font-bold text-slate-200">Orquestração de Agentes</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6 items-start">
        <div className="space-y-4">
          <TaskQueuePanel key={refreshKey} />
        </div>

        <Card>
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Despachar Nova Tarefa</h3>
          <div className="space-y-3">
            {TASK_TYPES.map(t => (
              <label
                key={t.value}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  selectedType === t.value
                    ? 'border-indigo-500/60 bg-indigo-500/10'
                    : 'border-slate-700 hover:border-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="taskType"
                  value={t.value}
                  checked={selectedType === t.value}
                  onChange={() => setSelectedType(t.value)}
                  className="mt-0.5 accent-indigo-500"
                />
                <div>
                  <p className="text-sm font-medium text-slate-200">{t.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{t.description}</p>
                </div>
              </label>
            ))}
          </div>

          <label className="flex items-center gap-2 mt-4 cursor-pointer">
            <input
              type="checkbox"
              checked={requiresApproval}
              onChange={e => setRequiresApproval(e.target.checked)}
              className="accent-amber-500"
            />
            <span className="text-sm text-slate-300">
              Requer aprovação humana antes de executar
            </span>
          </label>
          <p className="text-xs text-slate-500 mt-1 ml-5">
            Conteúdo político gerado por IA não pode ser publicado sem aprovação humana.
          </p>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 mt-3">{error}</p>
          )}

          <Button
            variant="primary"
            className="w-full mt-4 bg-gradient-to-r from-indigo-600 to-purple-600 border-none"
            onClick={handleDispatch}
            disabled={dispatching}
          >
            {dispatching
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Despachando...</>
              : <><Plus className="w-4 h-4 mr-2" />Despachar Tarefa</>
            }
          </Button>
        </Card>
      </div>
    </div>
  );
};

export default AgentTasksPage;
