import * as React from 'react';
import { Target, Plus, ChevronRight, ChevronDown, Loader2, Pencil, Trash2, FolderKanban } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { useAuth } from '../contexts/AuthContext';
import { authedFetch } from '../lib/authedFetch';

type GoalLevel = 'strategic' | 'tactical' | 'operational' | 'task';
type GoalStatus = 'planned' | 'active' | 'on_hold' | 'completed' | 'cancelled';
type Priority = 'critical' | 'high' | 'medium' | 'low';

interface Goal {
  id: string;
  campaignId: string;
  parentId: string | null;
  title: string;
  description: string | null;
  level: GoalLevel;
  status: GoalStatus;
  priority: Priority;
  ownerAgentId: string | null;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface Project {
  id: string;
  campaignId: string;
  goalId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: Priority;
  ownerAgentId: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
}

const LEVEL_LABELS: Record<GoalLevel, string> = {
  strategic: 'Estratégico',
  tactical: 'Tático',
  operational: 'Operacional',
  task: 'Tarefa',
};

const LEVEL_COLORS: Record<GoalLevel, string> = {
  strategic: 'text-purple-400 border-purple-500/40 bg-purple-500/10',
  tactical: 'text-blue-400 border-blue-500/40 bg-blue-500/10',
  operational: 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10',
  task: 'text-slate-400 border-slate-500/40 bg-slate-500/10',
};

const STATUS_LABELS: Record<GoalStatus, string> = {
  planned: 'Planejado',
  active: 'Ativo',
  on_hold: 'Em espera',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

const STATUS_COLORS: Record<GoalStatus, string> = {
  planned: 'text-slate-400',
  active: 'text-emerald-400',
  on_hold: 'text-amber-400',
  completed: 'text-sky-400',
  cancelled: 'text-red-400',
};

const PRIORITY_DOT: Record<Priority, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-slate-500',
};

interface GoalFormModal {
  open: boolean;
  editing: Goal | null;
  parentId: string | null;
}

interface ProjectFormModal {
  open: boolean;
  editing: Project | null;
}

const defaultGoalForm = () => ({
  title: '',
  description: '',
  level: 'task' as GoalLevel,
  status: 'planned' as GoalStatus,
  priority: 'medium' as Priority,
  parentId: null as string | null,
  dueDate: '',
});

const defaultProjectForm = () => ({
  title: '',
  description: '',
  goalId: '',
  status: 'active',
  priority: 'medium' as Priority,
  endDate: '',
});

const GoalsPage: React.FC = () => {
  const { user } = useAuth();
  const [goals, setGoals] = React.useState<Goal[]>([]);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [goalModal, setGoalModal] = React.useState<GoalFormModal>({ open: false, editing: null, parentId: null });
  const [projectModal, setProjectModal] = React.useState<ProjectFormModal>({ open: false, editing: null });
  const [goalForm, setGoalForm] = React.useState(defaultGoalForm());
  const [projectForm, setProjectForm] = React.useState(defaultProjectForm());
  const [saving, setSaving] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<'goals' | 'projects'>('goals');

  const load = React.useCallback(async () => {
    if (!user?.campaignId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [gRes, pRes] = await Promise.all([
        authedFetch(`/api/v1/goals/goals?campaignId=${user.campaignId}`),
        authedFetch(`/api/v1/goals/projects?campaignId=${user.campaignId}`),
      ]);
      const [gJson, pJson] = await Promise.all([gRes.json(), pRes.json()]);
      setGoals(gJson.goals ?? []);
      setProjects(pJson.projects ?? []);
    } finally {
      setLoading(false);
    }
  }, [user?.campaignId]);

  React.useEffect(() => { load(); }, [load]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openNewGoal = (parentId: string | null = null) => {
    const f = defaultGoalForm();
    f.parentId = parentId;
    if (parentId) {
      const parent = goals.find(g => g.id === parentId);
      if (parent) {
        const levelDown: Record<GoalLevel, GoalLevel> = {
          strategic: 'tactical', tactical: 'operational', operational: 'task', task: 'task',
        };
        f.level = levelDown[parent.level];
      }
    }
    setGoalForm(f);
    setGoalModal({ open: true, editing: null, parentId });
  };

  const openEditGoal = (g: Goal) => {
    setGoalForm({
      title: g.title,
      description: g.description ?? '',
      level: g.level,
      status: g.status,
      priority: g.priority,
      parentId: g.parentId,
      dueDate: g.dueDate ?? '',
    });
    setGoalModal({ open: true, editing: g, parentId: g.parentId });
  };

  const saveGoal = async () => {
    if (!goalForm.title.trim() || !user?.campaignId) return;
    setSaving(true);
    try {
      const body = {
        ...goalForm,
        campaignId: user.campaignId,
        parentId: goalForm.parentId || null,
        dueDate: goalForm.dueDate || null,
      };
      const url = goalModal.editing ? `/api/v1/goals/goals/${goalModal.editing.id}` : '/api/v1/goals/goals';
      await authedFetch(url, {
        method: goalModal.editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setGoalModal({ open: false, editing: null, parentId: null });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const deleteGoal = async (id: string) => {
    if (!confirm('Remover este objetivo?')) return;
    await authedFetch(`/api/v1/goals/goals/${id}`, { method: 'DELETE' });
    await load();
  };

  const openNewProject = () => {
    setProjectForm(defaultProjectForm());
    setProjectModal({ open: true, editing: null });
  };

  const openEditProject = (p: Project) => {
    setProjectForm({
      title: p.title,
      description: p.description ?? '',
      goalId: p.goalId ?? '',
      status: p.status,
      priority: p.priority,
      endDate: p.endDate ?? '',
    });
    setProjectModal({ open: true, editing: p });
  };

  const saveProject = async () => {
    if (!projectForm.title.trim() || !user?.campaignId) return;
    setSaving(true);
    try {
      const body = {
        ...projectForm,
        campaignId: user.campaignId,
        goalId: projectForm.goalId || null,
        endDate: projectForm.endDate || null,
      };
      const url = projectModal.editing ? `/api/v1/goals/projects/${projectModal.editing.id}` : '/api/v1/goals/projects';
      await authedFetch(url, {
        method: projectModal.editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setProjectModal({ open: false, editing: null });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const deleteProject = async (id: string) => {
    if (!confirm('Remover este projeto?')) return;
    await authedFetch(`/api/v1/goals/projects/${id}`, { method: 'DELETE' });
    await load();
  };

  const roots = goals.filter(g => !g.parentId);
  const children = (parentId: string) => goals.filter(g => g.parentId === parentId);

  const renderGoal = (g: Goal, depth = 0) => {
    const kids = children(g.id);
    const isExpanded = expanded.has(g.id);
    return (
      <div key={g.id} style={{ marginLeft: depth * 20 }}>
        <div className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-slate-700/40 group">
          <button
            onClick={() => toggleExpand(g.id)}
            className="w-4 h-4 text-slate-500 flex-shrink-0"
          >
            {kids.length > 0
              ? isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
              : null
            }
          </button>
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[g.priority]}`} />
          <span className={`text-xs px-1.5 py-0.5 rounded border ${LEVEL_COLORS[g.level]} flex-shrink-0`}>
            {LEVEL_LABELS[g.level]}
          </span>
          <span className="text-sm text-slate-200 flex-1 truncate">{g.title}</span>
          <span className={`text-xs ${STATUS_COLORS[g.status]}`}>{STATUS_LABELS[g.status]}</span>
          <div className="hidden group-hover:flex items-center gap-1 ml-2">
            <button
              onClick={() => openNewGoal(g.id)}
              title="Adicionar sub-objetivo"
              className="p-1 text-slate-400 hover:text-emerald-400"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => openEditGoal(g)}
              className="p-1 text-slate-400 hover:text-sky-400"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => deleteGoal(g.id)}
              className="p-1 text-slate-400 hover:text-red-400"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {isExpanded && kids.map(k => renderGoal(k, depth + 1))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="w-6 h-6 text-emerald-400" />
          <h2 className="text-2xl font-bold text-slate-200">Objetivos & Projetos</h2>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-700 pb-1">
        {(['goals', 'projects'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 text-sm rounded-t-md transition-colors ${
              activeTab === tab
                ? 'bg-slate-700 text-slate-100 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab === 'goals' ? 'Objetivos' : 'Projetos'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
        </div>
      ) : activeTab === 'goals' ? (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-300">Árvore de Objetivos</h3>
            <Button variant="primary" className="text-xs px-3 py-1.5" onClick={() => openNewGoal()}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Novo Objetivo
            </Button>
          </div>
          {roots.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">
              Nenhum objetivo criado. Comece com um objetivo estratégico.
            </p>
          ) : (
            <div className="space-y-0.5">{roots.map(g => renderGoal(g))}</div>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button variant="primary" className="text-xs px-3 py-1.5" onClick={openNewProject}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Novo Projeto
            </Button>
          </div>
          {projects.length === 0 ? (
            <Card>
              <p className="text-slate-500 text-sm text-center py-8">Nenhum projeto criado ainda.</p>
            </Card>
          ) : (
            projects.map(p => (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <FolderKanban className="w-4 h-4 text-sky-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-slate-200">{p.title}</p>
                      {p.description && <p className="text-xs text-slate-500 mt-0.5">{p.description}</p>}
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className={`text-xs ${STATUS_COLORS[p.status as GoalStatus] ?? 'text-slate-400'}`}>
                          {p.status}
                        </span>
                        <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[p.priority]}`} />
                        {p.goalId && (
                          <span className="text-xs text-slate-500">
                            Obj: {goals.find(g => g.id === p.goalId)?.title ?? p.goalId.slice(0, 8)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => openEditProject(p)} className="p-1 text-slate-400 hover:text-sky-400">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteProject(p.id)} className="p-1 text-slate-400 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Goal Modal */}
      {goalModal.open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold text-slate-100">
              {goalModal.editing ? 'Editar Objetivo' : 'Novo Objetivo'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Título *</label>
                <input
                  value={goalForm.title}
                  onChange={e => setGoalForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:border-emerald-500"
                  placeholder="Título do objetivo"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Descrição</label>
                <textarea
                  value={goalForm.description}
                  onChange={e => setGoalForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Nível</label>
                  <select
                    value={goalForm.level}
                    onChange={e => setGoalForm(f => ({ ...f, level: e.target.value as GoalLevel }))}
                    className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600"
                  >
                    {Object.entries(LEVEL_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Prioridade</label>
                  <select
                    value={goalForm.priority}
                    onChange={e => setGoalForm(f => ({ ...f, priority: e.target.value as Priority }))}
                    className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600"
                  >
                    <option value="critical">Crítica</option>
                    <option value="high">Alta</option>
                    <option value="medium">Média</option>
                    <option value="low">Baixa</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Status</label>
                  <select
                    value={goalForm.status}
                    onChange={e => setGoalForm(f => ({ ...f, status: e.target.value as GoalStatus }))}
                    className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600"
                  >
                    {Object.entries(STATUS_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Prazo</label>
                  <input
                    type="date"
                    value={goalForm.dueDate}
                    onChange={e => setGoalForm(f => ({ ...f, dueDate: e.target.value }))}
                    className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="secondary" onClick={() => setGoalModal({ open: false, editing: null, parentId: null })}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={saveGoal} disabled={saving || !goalForm.title.trim()}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Project Modal */}
      {projectModal.open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold text-slate-100">
              {projectModal.editing ? 'Editar Projeto' : 'Novo Projeto'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Título *</label>
                <input
                  value={projectForm.title}
                  onChange={e => setProjectForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:border-sky-500"
                  placeholder="Nome do projeto"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Descrição</label>
                <textarea
                  value={projectForm.description}
                  onChange={e => setProjectForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:border-sky-500 resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Objetivo vinculado</label>
                <select
                  value={projectForm.goalId}
                  onChange={e => setProjectForm(f => ({ ...f, goalId: e.target.value }))}
                  className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600"
                >
                  <option value="">— Nenhum —</option>
                  {goals.map(g => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Status</label>
                  <select
                    value={projectForm.status}
                    onChange={e => setProjectForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600"
                  >
                    <option value="active">Ativo</option>
                    <option value="paused">Pausado</option>
                    <option value="completed">Concluído</option>
                    <option value="archived">Arquivado</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Prazo</label>
                  <input
                    type="date"
                    value={projectForm.endDate}
                    onChange={e => setProjectForm(f => ({ ...f, endDate: e.target.value }))}
                    className="w-full bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="secondary" onClick={() => setProjectModal({ open: false, editing: null })}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={saveProject} disabled={saving || !projectForm.title.trim()}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GoalsPage;
