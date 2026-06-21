import * as React from 'react';
import { Loader2, ArrowLeft, Calculator, Scale, ExternalLink } from 'lucide-react';
import Card from '../ui/Card';
import { authedFetch } from '../../lib/authedFetch';
import { riskBadge } from './risk';

interface Citation {
  id: string; source: string | null; sourceOrg: string | null;
  sourceUrl: string | null; electionYear: number | null; excerpt: string | null;
}
interface Opinion {
  id: string; title: string; subjectType: string; riskLevel: string | null;
  accountingText: string | null; legalText: string | null; disclaimer: string | null;
  provider: string | null; modelUsed: string | null; createdAt: string;
}

const OpinionDetail: React.FC<{ id: string; onBack: () => void }> = ({ id, onBack }) => {
  const [opinion, setOpinion] = React.useState<Opinion | null>(null);
  const [citations, setCitations] = React.useState<Citation[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await authedFetch(`/api/v1/legal-shield/opinions/${id}`);
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || 'Falha ao carregar');
        if (alive) { setOpinion(json.opinion); setCitations(json.citations || []); }
      } catch (err: any) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!opinion) return null;

  const b = riskBadge(opinion.riskLevel);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
        <ArrowLeft className="w-3 h-3" /> Voltar
      </button>

      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-slate-100">{opinion.title}</h3>
        <span className={`shrink-0 px-2 py-1 rounded-full text-xs border ${b.cls}`}>Risco {b.label}</span>
      </div>

      <Card>
        <div className="flex items-center gap-2 mb-2">
          <Calculator className="w-4 h-4 text-teal-400" />
          <h4 className="text-sm font-semibold text-slate-200">Achados Contábeis</h4>
        </div>
        <p className="text-sm text-slate-300 whitespace-pre-wrap">{opinion.accountingText || '—'}</p>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-2">
          <Scale className="w-4 h-4 text-indigo-400" />
          <h4 className="text-sm font-semibold text-slate-200">Parecer Jurídico & Tese de Defesa</h4>
        </div>
        <p className="text-sm text-slate-300 whitespace-pre-wrap">{opinion.legalText || '—'}</p>
      </Card>

      {citations.length > 0 && (
        <Card>
          <h4 className="text-sm font-semibold text-slate-200 mb-2">Fontes citadas</h4>
          <ul className="space-y-2">
            {citations.map((c) => (
              <li key={c.id} className="text-xs text-slate-400 border-l-2 border-slate-700 pl-3">
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="font-medium">{[c.sourceOrg, c.source, c.electionYear].filter(Boolean).join(' · ') || 'Fonte'}</span>
                  {c.sourceUrl && (
                    <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline inline-flex items-center gap-0.5">
                      abrir <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                {c.excerpt && <p className="mt-0.5 line-clamp-3">{c.excerpt}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-[11px] text-slate-500 italic border-t border-slate-800 pt-3">
        {opinion.disclaimer}
        {opinion.provider && <span className="not-italic"> · gerado por {opinion.provider}/{opinion.modelUsed}</span>}
      </p>
    </div>
  );
};

export default OpinionDetail;
