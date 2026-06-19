import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import {
  ShieldCheck, AlertTriangle, CheckCircle, Activity,
  Clock, Users, FileWarning, Webhook, RefreshCw, Loader2
} from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';

interface ComplianceSummary {
  consents: { total: number; granted: number; revoked: number; expired: number };
  outboundMessages: { total24h: number; blockedNoConsent: number };
  pendingApprovals: { dossiers: number; agentTasks: number };
  webhooks: { last24hReceived: number; signatureFailures24h: number; lastReceivedAt: string | null };
  audit: { total24h: number; critical24h: number; error24h: number };
  generatedAt: string;
}

interface IntegrationHealth {
  name: string; configured: boolean; status: 'ok' | 'unconfigured' | 'degraded' | 'down'; detail?: string;
}

interface HealthResponse {
  status: 'ok' | 'degraded';
  db: boolean;
  integrations: IntegrationHealth[];
  uptime: number;
}

const statusColors: Record<string, string> = {
  ok: 'text-emerald-300 bg-emerald-500/20',
  unconfigured: 'text-slate-400 bg-slate-500/20',
  degraded: 'text-amber-300 bg-amber-500/20',
  down: 'text-red-300 bg-red-500/20',
};

const statusLabels: Record<string, string> = {
  ok: 'Operacional',
  unconfigured: 'Não configurado',
  degraded: 'Degradado',
  down: 'Indisponível',
};

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'warn' | 'critical';
}> = ({ icon, label, value, hint, tone = 'default' }) => {
  const toneColor =
    tone === 'critical' ? 'text-red-400' : tone === 'warn' ? 'text-amber-400' : 'text-slate-200';
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500 mb-1">{label}</p>
          <p className={`text-2xl font-bold ${toneColor}`}>{value}</p>
          {hint && <p className="text-[10px] text-slate-500 mt-1">{hint}</p>}
        </div>
        <div className="text-slate-600">{icon}</div>
      </div>
    </Card>
  );
};

export const ComplianceOverview: React.FC = () => {
  const [summary, setSummary] = React.useState<ComplianceSummary | null>(null);
  const [health, setHealth] = React.useState<HealthResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  const fetchAll = React.useCallback(async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([
        authedFetch('/api/v1/observability/compliance').then(r => r.ok ? r.json() : null),
        authedFetch('/api/v1/observability/health').then(r => r.ok ? r.json() : null),
      ]);
      setSummary(s);
      setHealth(h);
    } catch {
      // empty state
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) {
    return <div className="flex justify-center py-8 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={fetchAll} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* System Health */}
      {health && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-slate-200">Saúde do Sistema</h3>
            </div>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              health.status === 'ok' ? statusColors.ok : statusColors.degraded
            }`}>
              {health.status === 'ok' ? 'Operacional' : 'Degradado'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {health.integrations.map(i => (
              <div key={i.name} className="border border-slate-700 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-slate-200 font-medium">{i.name}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${statusColors[i.status]}`}>
                    {statusLabels[i.status]}
                  </span>
                </div>
                {i.detail && <p className="text-xs text-slate-500">{i.detail}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Compliance KPIs */}
      {summary && (
        <>
          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              LGPD — Consentimentos
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon={<Users className="w-5 h-5" />} label="Total" value={summary.consents.total} />
              <StatCard icon={<CheckCircle className="w-5 h-5" />} label="Granted" value={summary.consents.granted} />
              <StatCard icon={<AlertTriangle className="w-5 h-5" />} label="Revogados" value={summary.consents.revoked} tone="warn" />
              <StatCard icon={<Clock className="w-5 h-5" />} label="Expirados" value={summary.consents.expired} tone="warn" />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">Mensageria (24h)</h3>
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={<Activity className="w-5 h-5" />}
                label="Saídas processadas"
                value={summary.outboundMessages.total24h}
              />
              <StatCard
                icon={<FileWarning className="w-5 h-5" />}
                label="Bloqueadas (sem consentimento)"
                value={summary.outboundMessages.blockedNoConsent}
                tone={summary.outboundMessages.blockedNoConsent > 0 ? 'warn' : 'default'}
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">Aprovações Pendentes</h3>
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={<FileWarning className="w-5 h-5" />}
                label="Dossiês"
                value={summary.pendingApprovals.dossiers}
                tone={summary.pendingApprovals.dossiers > 0 ? 'warn' : 'default'}
                hint="Conteúdo político precisa de revisão humana"
              />
              <StatCard
                icon={<FileWarning className="w-5 h-5" />}
                label="Tarefas de Agentes"
                value={summary.pendingApprovals.agentTasks}
                tone={summary.pendingApprovals.agentTasks > 0 ? 'warn' : 'default'}
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">Webhooks (24h)</h3>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <StatCard icon={<Webhook className="w-5 h-5" />} label="Recebidos" value={summary.webhooks.last24hReceived} />
              <StatCard
                icon={<AlertTriangle className="w-5 h-5" />}
                label="Falha de assinatura"
                value={summary.webhooks.signatureFailures24h}
                tone={summary.webhooks.signatureFailures24h > 0 ? 'critical' : 'default'}
                hint={summary.webhooks.signatureFailures24h > 0 ? 'Tentativa de spoofing detectada' : undefined}
              />
              <StatCard
                icon={<Clock className="w-5 h-5" />}
                label="Último recebido"
                value={summary.webhooks.lastReceivedAt ? new Date(summary.webhooks.lastReceivedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">Auditoria (24h)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatCard icon={<Activity className="w-5 h-5" />} label="Eventos" value={summary.audit.total24h} />
              <StatCard
                icon={<AlertTriangle className="w-5 h-5" />}
                label="Erros"
                value={summary.audit.error24h}
                tone={summary.audit.error24h > 0 ? 'warn' : 'default'}
              />
              <StatCard
                icon={<AlertTriangle className="w-5 h-5" />}
                label="Críticos"
                value={summary.audit.critical24h}
                tone={summary.audit.critical24h > 0 ? 'critical' : 'default'}
              />
            </div>
          </div>

          <p className="text-[10px] text-slate-500 text-right">
            Atualizado em {new Date(summary.generatedAt).toLocaleString('pt-BR')}
          </p>
        </>
      )}
    </div>
  );
};

export default ComplianceOverview;
