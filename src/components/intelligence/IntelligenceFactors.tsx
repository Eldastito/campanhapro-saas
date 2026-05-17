import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import { TrendingUp, AlertCircle, Zap, ShieldAlert, RefreshCw } from 'lucide-react';
import Card from '../ui/Card';
import { useAuth } from '../../contexts/AuthContext';

interface FactorData {
  score: number;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  opportunities: string[];
  syncedAt: string;
}

interface Quadrant {
  key: keyof Pick<FactorData, 'strengths' | 'weaknesses' | 'opportunities' | 'risks'>;
  label: string;
  icon: React.ReactNode;
  bg: string;
  border: string;
  text: string;
  badge: string;
}

const QUADRANTS: Quadrant[] = [
  {
    key: 'strengths',
    label: 'Forças',
    icon: <TrendingUp className="w-4 h-4" />,
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    text: 'text-emerald-300',
    badge: 'bg-emerald-500/20 text-emerald-300',
  },
  {
    key: 'weaknesses',
    label: 'Fraquezas',
    icon: <AlertCircle className="w-4 h-4" />,
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    text: 'text-amber-300',
    badge: 'bg-amber-500/20 text-amber-300',
  },
  {
    key: 'opportunities',
    label: 'Oportunidades',
    icon: <Zap className="w-4 h-4" />,
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/30',
    text: 'text-sky-300',
    badge: 'bg-sky-500/20 text-sky-300',
  },
  {
    key: 'risks',
    label: 'Riscos',
    icon: <ShieldAlert className="w-4 h-4" />,
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    text: 'text-red-300',
    badge: 'bg-red-500/20 text-red-300',
  },
];

const IntelligenceFactors: React.FC = () => {
  const { user } = useAuth();
  const [factors, setFactors] = React.useState<FactorData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    if (!user?.campaignId) return;
    authedFetch('/api/v1/intelligence/factors')
      .then(r => r.ok ? r.json() : null)
      .then(json => { if (json?.factors) setFactors(json.factors); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [user?.campaignId]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16 text-slate-500">
        <RefreshCw className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!factors) {
    return (
      <Card>
        <div className="text-center py-10 text-slate-500">
          <p className="font-medium">Nenhum fator disponível.</p>
          <p className="text-sm mt-1">Realize uma sincronização na aba Visão Geral para gerar fatores.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-200">Análise SWOT Detalhada</h3>
        <span className="text-xs text-slate-500">
          Gerado em {new Date(factors.syncedAt).toLocaleString('pt-BR')}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {QUADRANTS.map(({ key, label, icon, bg, border, text, badge }) => {
          const items: string[] = factors[key] as string[];
          return (
            <div key={key} className={`rounded-xl border p-4 ${bg} ${border}`}>
              <div className={`flex items-center gap-2 font-semibold mb-3 ${text}`}>
                {icon}
                <span>{label}</span>
                <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-bold ${badge}`}>
                  {items.length}
                </span>
              </div>
              {items.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Nenhum item identificado.</p>
              ) : (
                <ul className="space-y-1.5">
                  {items.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                      <span className={`mt-0.5 shrink-0 text-xs font-bold ${text}`}>{i + 1}.</span>
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default IntelligenceFactors;
