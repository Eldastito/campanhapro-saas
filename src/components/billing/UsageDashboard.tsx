import * as React from 'react';
import { Activity, MessageSquare, Cpu, FileText, AlertTriangle } from 'lucide-react';
import Card from '../ui/Card';

interface UsageSummary {
  periodStart: string;
  periodEnd: string;
  aiCostCents: number;
  aiCalls: number;
  messagesOutbound: number;
  /** Disparos em massa do mês corrente — usado pela barra de cota. */
  blastsThisMonth: number;
  simulations: number;
  embeddings: number;
}

interface Plan {
  limits: {
    contacts: number;
    ai_budget_cents: number;
    team_users: number;
    blasts_per_month: number;
    messages_per_month?: number; // legado pré-#109
  };
}

interface Props {
  usage: UsageSummary;
  plan: Plan | null;
  withinBudget: boolean;
}

const formatBRL = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ProgressBar: React.FC<{
  current: number;
  limit: number;
  label: string;
  formatValue?: (v: number) => string;
}> = ({ current, limit, label, formatValue = (v) => v.toLocaleString('pt-BR') }) => {
  const unlimited = limit === -1;
  const pct = unlimited ? 0 : Math.min((current / Math.max(limit, 1)) * 100, 100);
  const tone = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-indigo-500';

  return (
    <div>
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>{label}</span>
        <span className="font-mono text-slate-300">
          {formatValue(current)} / {unlimited ? '∞' : formatValue(limit)}
        </span>
      </div>
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${unlimited ? 'bg-emerald-500/30' : tone}`}
          style={{ width: unlimited ? '4%' : `${pct}%` }}
        />
      </div>
    </div>
  );
};

const UsageDashboard: React.FC<Props> = ({ usage, plan, withinBudget }) => {
  return (
    <div className="space-y-4">
      {!withinBudget && (
        <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Orçamento de IA excedido neste período — novas chamadas para agentes IA
            retornarão 402 até a renovação do plano ou upgrade.
          </span>
        </div>
      )}

      <Card>
        <h3 className="text-sm font-semibold text-slate-300 mb-4">
          Uso no período atual
        </h3>
        <div className="space-y-4">
          <ProgressBar
            label="Custo de IA"
            current={usage.aiCostCents}
            limit={plan?.limits.ai_budget_cents ?? 0}
            formatValue={formatBRL}
          />
          <ProgressBar
            label="Disparos em massa do mês"
            current={usage.blastsThisMonth ?? 0}
            limit={plan?.limits.blasts_per_month ?? plan?.limits.messages_per_month ?? 0}
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 pt-4 border-t border-slate-700">
          <div>
            <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
              <Cpu className="w-3.5 h-3.5" /> Chamadas IA
            </div>
            <p className="text-xl font-bold text-slate-100">{usage.aiCalls.toLocaleString('pt-BR')}</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
              <MessageSquare className="w-3.5 h-3.5" /> Mensagens
            </div>
            <p className="text-xl font-bold text-slate-100">{usage.messagesOutbound.toLocaleString('pt-BR')}</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
              <Activity className="w-3.5 h-3.5" /> Simulações
            </div>
            <p className="text-xl font-bold text-slate-100">{usage.simulations.toLocaleString('pt-BR')}</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
              <FileText className="w-3.5 h-3.5" /> Embeddings
            </div>
            <p className="text-xl font-bold text-slate-100">{usage.embeddings.toLocaleString('pt-BR')}</p>
          </div>
        </div>

        <p className="text-[10px] text-slate-500 mt-4">
          Período: {new Date(usage.periodStart).toLocaleDateString('pt-BR')} —{' '}
          {new Date(usage.periodEnd).toLocaleDateString('pt-BR')}
        </p>
      </Card>
    </div>
  );
};

export default UsageDashboard;
