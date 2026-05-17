import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import {
  Loader2, Plus, Pencil, Trash2, ShieldAlert, Save, X, AlertTriangle,
} from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { supabase } from '../../lib/supabaseClient';

interface Plan {
  id: string;
  name: string;
  monthly_cents: number;
  features: string[];
  limits: {
    contacts?: number;
    ai_budget_cents?: number;
    team_users?: number;
    messages_per_month?: number;
  };
  active: boolean;
  created_at?: string;
}

const ALL_FEATURES = [
  'dashboard', 'crm', 'help', 'ai_agents', 'visits', 'engagement',
  'tools', 'resources', 'training', 'analytics', 'team', 'financial',
  'election_day', 'intelligence', 'scenarios',
];

const FEATURE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  crm: 'CRM',
  help: 'Ajuda',
  ai_agents: 'Agentes de IA',
  visits: 'Visitas',
  engagement: 'Engajamento',
  tools: 'Ferramentas',
  resources: 'Recursos',
  training: 'Treinamento',
  analytics: 'Analytics',
  team: 'Equipes',
  financial: 'Financeiro',
  election_day: 'Dia das eleições',
  intelligence: 'Inteligência',
  scenarios: 'Cenários',
};

const LIMITS = [
  { key: 'contacts', label: 'Contatos' },
  { key: 'team_users', label: 'Usuários da equipe' },
  { key: 'messages_per_month', label: 'Mensagens/mês' },
  { key: 'ai_budget_cents', label: 'Orçamento IA (centavos)' },
] as const;

const emptyPlan: Plan = {
  id: '',
  name: '',
  monthly_cents: 0,
  features: ['dashboard'],
  limits: { contacts: 100, team_users: 1, messages_per_month: 0, ai_budget_cents: 0 },
  active: true,
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

const formatBRL = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const AdminPlansPanel: React.FC = () => {
  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<Plan | null>(null);
  const [isNew, setIsNew] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch('/api/v1/billing/admin/plans', { headers: await authHeaders() });
      if (res.status === 403) {
        setError('Acesso restrito: somente Supreme Admin pode editar o catálogo de planos.');
        setPlans([]);
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao carregar planos');
      setPlans(json.plans ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);

  const startEdit = (p: Plan) => { setEditing({ ...p, limits: { ...p.limits } }); setIsNew(false); setError(null); };
  const startCreate = () => { setEditing({ ...emptyPlan, limits: { ...emptyPlan.limits } }); setIsNew(true); setError(null); };
  const cancel = () => { setEditing(null); setError(null); };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const url = isNew
        ? '/api/v1/billing/admin/plans'
        : `/api/v1/billing/admin/plans/${editing.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const body = JSON.stringify({
        id: editing.id,
        name: editing.name,
        monthly_cents: editing.monthly_cents,
        features: editing.features,
        limits: editing.limits,
        active: editing.active,
      });
      const res = await fetch(url, { method, headers: await authHeaders(), body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao salvar');
      setEditing(null);
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (planId: string) => {
    if (!confirm(`Desativar o plano "${planId}"? Ele não aparecerá mais para novos clientes.`)) return;
    setError(null);
    try {
      const res = await authedFetch(`/api/v1/billing/admin/plans/${planId}`, {
        method: 'DELETE', headers: await authHeaders(),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.error === 'plan_in_use') {
          throw new Error(`Não é possível desativar: ${json.activeSubscriptions} assinatura(s) ativa(s) usando este plano.`);
        }
        throw new Error(json.error ?? 'Erro ao desativar');
      }
      await refresh();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) return <div className="flex justify-center py-8 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  if (error && plans.length === 0) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-amber-300">
          <ShieldAlert className="w-5 h-5" />
          <p className="text-sm">{error}</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-200">Catálogo de planos</h3>
          <p className="text-xs text-slate-500 mt-0.5">Mudanças não afetam assinaturas ativas — só novas e renovações.</p>
        </div>
        <Button variant="primary" className="text-sm" onClick={startCreate}>
          <Plus className="w-4 h-4 mr-1" /> Novo plano
        </Button>
      </div>

      {error && (
        <p className="text-sm bg-red-500/10 text-red-300 border border-red-500/30 rounded-lg p-3">{error}</p>
      )}

      <Card>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-slate-500 border-b border-slate-700">
            <tr>
              <th className="text-left py-2 px-2">ID</th>
              <th className="text-left py-2 px-2">Nome</th>
              <th className="text-right py-2 px-2">Preço/mês</th>
              <th className="text-right py-2 px-2">Funcionalidades</th>
              <th className="text-center py-2 px-2">Status</th>
              <th className="text-right py-2 px-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {plans.map(p => (
              <tr key={p.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                <td className="py-2 px-2 font-mono text-xs text-slate-400">{p.id}</td>
                <td className="py-2 px-2 text-slate-200 font-medium">{p.name}</td>
                <td className="py-2 px-2 text-right font-mono text-slate-200">{formatBRL(p.monthly_cents)}</td>
                <td className="py-2 px-2 text-right text-xs text-slate-400">{p.features.length}</td>
                <td className="py-2 px-2 text-center">
                  {p.active
                    ? <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">ativo</span>
                    : <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-400">inativo</span>
                  }
                </td>
                <td className="py-2 px-2 text-right">
                  <button onClick={() => startEdit(p)} className="text-slate-400 hover:text-indigo-400 mr-2">
                    <Pencil className="w-4 h-4 inline" />
                  </button>
                  <button onClick={() => deactivate(p.id)} className="text-slate-400 hover:text-red-400">
                    <Trash2 className="w-4 h-4 inline" />
                  </button>
                </td>
              </tr>
            ))}
            {plans.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-slate-500">Nenhum plano cadastrado.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={cancel}>
          <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-100">
                {isNew ? 'Novo plano' : `Editar plano: ${editing.id}`}
              </h3>
              <button onClick={cancel} className="text-slate-500 hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">ID do plano *</label>
                  <input
                    className="w-full text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200 font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                    value={editing.id}
                    onChange={e => setEditing({ ...editing, id: e.target.value.toLowerCase() })}
                    disabled={!isNew}
                    placeholder="ex: pro_anual"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Nome exibido *</label>
                  <input
                    className="w-full text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                    value={editing.name}
                    onChange={e => setEditing({ ...editing, name: e.target.value })}
                    placeholder="ex: Pro Anual"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Preço mensal (em centavos) *</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="w-full text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  value={editing.monthly_cents}
                  onChange={e => setEditing({ ...editing, monthly_cents: parseInt(e.target.value, 10) || 0 })}
                />
                <p className="text-[10px] text-slate-500 mt-1">{formatBRL(editing.monthly_cents)}/mês</p>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-2 block">Funcionalidades incluídas</label>
                <div className="grid grid-cols-3 gap-2">
                  {ALL_FEATURES.map(f => (
                    <label key={f} className={`cursor-pointer border rounded-lg px-2 py-1.5 text-xs transition-colors ${
                      editing.features.includes(f)
                        ? 'border-indigo-500/60 bg-indigo-500/10 text-slate-200'
                        : 'border-slate-700 text-slate-400 hover:border-slate-600'
                    }`}>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={editing.features.includes(f)}
                        onChange={() => {
                          const isOn = editing.features.includes(f);
                          setEditing({
                            ...editing,
                            features: isOn ? editing.features.filter(x => x !== f) : [...editing.features, f],
                          });
                        }}
                      />
                      {FEATURE_LABELS[f] ?? f}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-2 block">Limites (use -1 para ilimitado)</label>
                <div className="grid grid-cols-2 gap-3">
                  {LIMITS.map(l => (
                    <div key={l.key}>
                      <label className="text-[10px] text-slate-500 block mb-0.5">{l.label}</label>
                      <input
                        type="number"
                        min={-1}
                        step={1}
                        className="w-full text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                        value={(editing.limits as any)[l.key] ?? 0}
                        onChange={e => setEditing({
                          ...editing,
                          limits: { ...editing.limits, [l.key]: parseInt(e.target.value, 10) || 0 },
                        })}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-indigo-500"
                  checked={editing.active}
                  onChange={e => setEditing({ ...editing, active: e.target.checked })}
                />
                Plano ativo (visível para novos clientes)
              </label>

              {error && (
                <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded p-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2 border-t border-slate-700">
                <Button variant="secondary" className="text-sm" onClick={cancel} disabled={saving}>
                  Cancelar
                </Button>
                <Button variant="primary" className="text-sm" onClick={save} disabled={saving}>
                  {saving
                    ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Salvando...</>
                    : <><Save className="w-4 h-4 mr-1" />Salvar</>}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPlansPanel;
