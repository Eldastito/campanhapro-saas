import * as React from 'react';
import { Check, Loader2, Sparkles } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';

interface PlanLimits {
  contacts: number;
  ai_budget_cents: number;
  team_users: number;
  messages_per_month: number;
}

export interface Plan {
  id: string;
  name: string;
  monthlyCents: number;
  features: string[];
  limits: PlanLimits;
}

interface Props {
  plan: Plan;
  currentPlanId: string | null;
  recommended?: boolean;
  onSubscribe: (planId: string) => void;
  loading?: boolean;
}

const FEATURE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  crm: 'CRM de eleitores',
  help: 'Central de ajuda',
  ai_agents: 'Agentes de IA',
  visits: 'Gestão de visitas',
  engagement: 'Engajamento',
  tools: 'Ferramentas',
  resources: 'Recursos',
  training: 'Treinamento',
  analytics: 'Analytics',
  team: 'Equipes',
  financial: 'Financeiro',
  election_day: 'Dia das eleições',
  intelligence: 'Inteligência (CenÁrios)',
  scenarios: 'Cenários avançados',
};

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatLimit(value: number, suffix: string): string {
  if (value === -1) return `Ilimitado ${suffix}`.trim();
  return `${value.toLocaleString('pt-BR')} ${suffix}`.trim();
}

const PlanCard: React.FC<Props> = ({ plan, currentPlanId, recommended, onSubscribe, loading }) => {
  const isCurrent = plan.id === currentPlanId;

  return (
    <Card>
      <div className={`relative ${recommended ? 'ring-2 ring-indigo-500/50 rounded-xl -m-2 p-2' : ''}`}>
        {recommended && (
          <span className="absolute -top-1 right-2 text-[10px] font-bold text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Recomendado
          </span>
        )}

        <h3 className="text-lg font-bold text-slate-200">{plan.name}</h3>
        <p className="mt-2">
          <span className="text-3xl font-bold text-slate-100">{formatBRL(plan.monthlyCents)}</span>
          {plan.monthlyCents > 0 && <span className="text-xs text-slate-500 ml-1">/mês</span>}
        </p>

        <div className="mt-4 space-y-1.5 text-xs text-slate-300">
          <p className="text-slate-400 font-medium mb-1">Limites</p>
          <p>· {formatLimit(plan.limits.contacts, 'contatos')}</p>
          <p>· {formatLimit(plan.limits.team_users, 'usuários da equipe')}</p>
          <p>· {formatLimit(plan.limits.messages_per_month, 'mensagens/mês')}</p>
          <p>· {plan.limits.ai_budget_cents === -1
            ? 'Orçamento IA ilimitado'
            : `${formatBRL(plan.limits.ai_budget_cents)} de IA/mês`}</p>
        </div>

        <div className="mt-4 space-y-1 text-xs text-slate-300">
          <p className="text-slate-400 font-medium mb-1">Inclui</p>
          {plan.features.map(f => (
            <div key={f} className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-emerald-400 shrink-0" />
              <span>{FEATURE_LABELS[f] ?? f}</span>
            </div>
          ))}
        </div>

        <Button
          variant={isCurrent ? 'secondary' : 'primary'}
          className="w-full mt-5"
          disabled={isCurrent || loading}
          onClick={() => onSubscribe(plan.id)}
        >
          {loading
            ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            : isCurrent ? 'Plano atual' : 'Assinar'}
        </Button>
      </div>
    </Card>
  );
};

export default PlanCard;
