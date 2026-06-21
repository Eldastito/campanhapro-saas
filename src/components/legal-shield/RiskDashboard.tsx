import * as React from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import Card from '../ui/Card';
import { authedFetch } from '../../lib/authedFetch';
import { riskBadge } from './risk';

interface DashboardData {
  total: number;
  byRisk: Record<string, number>;
  openHighRisk: Array<{ id: string; title: string; riskLevel: string | null; createdAt: string }>;
}

const ORDER = ['crítico', 'alto', 'médio', 'baixo'];

const RiskDashboard: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await authedFetch('/api/v1/legal-shield/dashboard');
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || 'Falha ao carregar');
        if (alive) setData(json);
      } catch (err: any) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="text-center">
          <p className="text-2xl font-bold text-slate-100">{data.total}</p>
          <p className="text-xs text-slate-400">Pareceres</p>
        </Card>
        {ORDER.map((lvl) => {
          const b = riskBadge(lvl);
          return (
            <Card key={lvl} className="text-center">
              <p className="text-2xl font-bold text-slate-100">{data.byRisk?.[lvl] ?? 0}</p>
              <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] border ${b.cls}`}>{b.label}</span>
            </Card>
          );
        })}
      </div>

      <Card>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-orange-400" />
          <h3 className="text-sm font-semibold text-slate-200">Riscos em aberto (alto/crítico)</h3>
        </div>
        {data.openHighRisk.length === 0 ? (
          <p className="text-xs text-slate-500">Nenhum risco alto ou crítico no momento.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {data.openHighRisk.map((o) => {
              const b = riskBadge(o.riskLevel);
              return (
                <li key={o.id} className="py-2 flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-300 truncate">{o.title}</span>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] border ${b.cls}`}>{b.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default RiskDashboard;
