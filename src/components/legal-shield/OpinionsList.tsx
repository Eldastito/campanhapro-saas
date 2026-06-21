import * as React from 'react';
import { Loader2, ChevronRight } from 'lucide-react';
import Card from '../ui/Card';
import { authedFetch } from '../../lib/authedFetch';
import { riskBadge } from './risk';
import OpinionDetail from './OpinionDetail';

interface OpinionRow {
  id: string; title: string; subjectType: string;
  riskLevel: string | null; status: string; createdAt: string;
}

const SUBJECT_LABEL: Record<string, string> = {
  transaction: 'Transação', expense: 'Despesa', donation: 'Doação',
  contract: 'Contrato', free_query: 'Consulta', accounts_rendering: 'Prestação de contas',
};

const OpinionsList: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const [opinions, setOpinions] = React.useState<OpinionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await authedFetch('/api/v1/legal-shield/opinions');
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || 'Falha ao carregar');
        if (alive) setOpinions(json.opinions || []);
      } catch (err: any) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  if (selected) return <OpinionDetail id={selected} onBack={() => setSelected(null)} />;

  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (opinions.length === 0) {
    return <p className="text-sm text-slate-500 py-8 text-center">Nenhum parecer ainda. Rode uma análise na aba "Nova Análise".</p>;
  }

  return (
    <Card className="p-0 overflow-hidden">
      <ul className="divide-y divide-slate-800">
        {opinions.map((o) => {
          const b = riskBadge(o.riskLevel);
          return (
            <li key={o.id}>
              <button
                onClick={() => setSelected(o.id)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-800/60 text-left"
              >
                <div className="min-w-0">
                  <p className="text-sm text-slate-200 truncate">{o.title}</p>
                  <p className="text-[11px] text-slate-500">
                    {SUBJECT_LABEL[o.subjectType] || o.subjectType} · {new Date(o.createdAt).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] border ${b.cls}`}>{b.label}</span>
                  <ChevronRight className="w-4 h-4 text-slate-600" />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};

export default OpinionsList;
