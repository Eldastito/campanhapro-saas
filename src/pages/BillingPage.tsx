import { authedFetch } from '../lib/authedFetch';
import * as React from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Tabs from '../components/Tabs';
import ErrorBoundary from '../components/dev/ErrorBoundary';
import PlanCard, { Plan } from '../components/billing/PlanCard';
import UsageDashboard from '../components/billing/UsageDashboard';
import CheckoutDialog from '../components/billing/CheckoutDialog';
import AdminPlansPanel from '../components/billing/AdminPlansPanel';
import { useAuth } from '../contexts/AuthContext';

interface Subscription {
  id: string;
  planId: string;
  status: string;
  features: string[];
  currentPeriodStart: string;
  currentPeriodEnd: string;
}

interface UsageSummary {
  periodStart: string;
  periodEnd: string;
  aiCostCents: number;
  aiCalls: number;
  messagesOutbound: number;
  simulations: number;
  embeddings: number;
}

const PlansTab: React.FC<{
  plans: Plan[];
  subscription: Subscription | null;
  onSubscribe: (planId: string) => Promise<void>;
}> = ({ plans, subscription, onSubscribe }) => {
  const [loading, setLoading] = React.useState<string | null>(null);

  const handle = async (planId: string) => {
    setLoading(planId);
    try {
      await onSubscribe(planId);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {plans.map(p => (
        <PlanCard
          key={p.id}
          plan={p}
          currentPlanId={subscription?.planId ?? null}
          recommended={p.id === 'pro'}
          onSubscribe={handle}
          loading={loading === p.id}
        />
      ))}
    </div>
  );
};

const HistoryTab: React.FC = () => {
  const [records, setRecords] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await authedFetch('/api/v1/billing/usage?limit=200');
        if (res.ok) {
          const json = await res.json();
          setRecords(json.records ?? []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="flex justify-center py-8 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (records.length === 0) {
    return <div className="text-center py-8 text-slate-500 text-sm">Nenhum registro de uso ainda.</div>;
  }

  return (
    <Card>
      <h3 className="text-sm font-semibold text-slate-300 mb-3">Histórico de uso</h3>
      <div className="space-y-1">
        {records.map(r => (
          <div key={r.id} className="grid grid-cols-[100px_1fr_100px_140px] items-center text-xs px-2 py-1.5 hover:bg-slate-700/40 rounded">
            <span className="font-mono text-slate-300">{r.metric}</span>
            <span className="text-slate-500 truncate">
              {r.metadata?.model ? String(r.metadata.model) : '—'}
            </span>
            <span className="font-mono text-slate-300 text-right">
              {(r.cost_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </span>
            <span className="text-slate-500 text-right">
              {new Date(r.recorded_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
};

const BillingPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = !!user?.isSupremeAdmin;
  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [subscription, setSubscription] = React.useState<Subscription | null>(null);
  const [plan, setPlan] = React.useState<any | null>(null);
  const [usage, setUsage] = React.useState<UsageSummary | null>(null);
  const [withinBudget, setWithinBudget] = React.useState(true);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = React.useState<Plan | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, subRes] = await Promise.all([
        authedFetch('/api/v1/billing/plans'),
        authedFetch('/api/v1/billing/subscription'),
      ]);
      if (plansRes.ok) {
        const j = await plansRes.json();
        setPlans((j.plans ?? []).map((p: any) => ({
          ...p,
          monthlyCents: p.monthlyCents ?? p.monthly_cents ?? 0,
        })));
      }
      if (subRes.ok) {
        const j = await subRes.json();
        setSubscription(j.subscription);
        setPlan(j.plan);
        setUsage(j.usage);
        setWithinBudget(j.withinBudget ?? true);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);

  const subscribe = async (planId: string) => {
    setError(null);
    const target = plans.find(p => p.id === planId);
    // Free plan or no price → no checkout dialog needed
    if (!target || target.monthlyCents === 0) {
      await postCheckout({ planId });
      return;
    }
    setPendingPlan(target);
  };

  const postCheckout = async (body: any) => {
    try {
      const res = await authedFetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao assinar');
      setPendingPlan(null);
      if (json.checkoutUrl) {
        window.location.href = json.checkoutUrl;
        return;
      }
      await refresh();
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const cancel = async () => {
    if (!confirm('Cancelar a assinatura atual? Você perderá acesso a recursos pagos no fim do período.')) return;
    setError(null);
    try {
      const res = await authedFetch('/api/v1/billing/cancel', { method: 'POST' });
      if (!res.ok) throw new Error('Erro ao cancelar');
      await refresh();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <CreditCard className="w-6 h-6 text-indigo-400" />
        <h2 className="text-2xl font-bold text-slate-200">Plano & Faturamento</h2>
      </div>

      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      {subscription && (
        <Card>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs text-slate-500">Plano atual</p>
              <p className="text-lg font-bold text-slate-100 capitalize">
                {plan?.name ?? subscription.planId}
                <span className="ml-2 text-xs font-medium text-slate-400 capitalize">
                  · {subscription.status}
                </span>
              </p>
              <p className="text-[10px] text-slate-500 mt-1">
                Renova em {new Date(subscription.currentPeriodEnd).toLocaleDateString('pt-BR')}
              </p>
            </div>
            <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={cancel}>
              Cancelar assinatura
            </Button>
          </div>
        </Card>
      )}

      <Tabs
        tabs={isAdmin
          ? ['Planos', 'Uso', 'Histórico', 'Admin · Catálogo']
          : ['Planos', 'Uso', 'Histórico']}
        mode="state"
      >
        <ErrorBoundary label="Planos">
          {loading
            ? <div className="flex justify-center py-8 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
            : <PlansTab plans={plans} subscription={subscription} onSubscribe={subscribe} />}
        </ErrorBoundary>
        <ErrorBoundary label="Uso">
          {usage
            ? <UsageDashboard usage={usage} plan={plan} withinBudget={withinBudget} />
            : <div className="text-center py-8 text-slate-500 text-sm">Sem dados de uso.</div>}
        </ErrorBoundary>
        <ErrorBoundary label="Histórico">
          <HistoryTab />
        </ErrorBoundary>
        {isAdmin && (
          <ErrorBoundary label="Admin · Catálogo">
            <AdminPlansPanel />
          </ErrorBoundary>
        )}
      </Tabs>

      <CheckoutDialog
        open={pendingPlan !== null}
        planName={pendingPlan?.name ?? ''}
        monthlyCents={pendingPlan?.monthlyCents ?? 0}
        onClose={() => setPendingPlan(null)}
        onSubmit={async ({ name, email, cpfCnpj, phone, method }) => {
          await postCheckout({
            planId: pendingPlan!.id, name, email, cpfCnpj, phone, method,
          });
        }}
      />
    </div>
  );
};

export default BillingPage;
