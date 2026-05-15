import * as React from 'react';
import { RefreshCw, TrendingUp, AlertCircle, Zap, ShieldAlert } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';

interface IntelligenceFactors {
  score: number;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  opportunities: string[];
  syncedAt: string;
}

interface LastSync {
  lastSyncAt: string;
  visitCount: number;
  pesquisaCount: number;
}

interface PanelState {
  factors: IntelligenceFactors | null;
  lastSync: LastSync | null;
}

const ScoreBar: React.FC<{ score: number }> = ({ score }) => {
  const color =
    score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 bg-slate-700 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
      <span className="text-sm font-bold text-slate-200 w-8 text-right">{score}</span>
    </div>
  );
};

const FactorList: React.FC<{
  icon: React.ReactNode;
  label: string;
  items: string[];
  colorClass: string;
}> = ({ icon, label, items, colorClass }) => {
  if (!items.length) return null;
  return (
    <div>
      <div className={`flex items-center gap-1.5 text-xs font-semibold mb-1 ${colorClass}`}>
        {icon}
        {label}
      </div>
      <ul className="space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-slate-400 pl-2 before:content-['·'] before:mr-1">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
};

const IntelligencePanel: React.FC = () => {
  const { user } = useAuth();
  const [state, setState] = React.useState<PanelState>({ factors: null, lastSync: null });
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchFactors = React.useCallback(async () => {
    if (!user?.campaignId) return;
    try {
      const res = await fetch('/api/v1/intelligence/factors', {
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const json = await res.json();
        setState({ factors: json.factors, lastSync: json.lastSync });
      }
    } catch {
      // Cenários service unavailable — silent
    } finally {
      setIsLoading(false);
    }
  }, [user?.campaignId]);

  React.useEffect(() => { fetchFactors(); }, [fetchFactors]);

  const handleSync = async () => {
    if (!user?.campaignId || isSyncing) return;
    setIsSyncing(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/intelligence/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: user.campaignId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro ao sincronizar');
      await fetchFactors();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const syncLabel = state.lastSync?.lastSyncAt
    ? `Última sync: ${new Date(state.lastSync.lastSyncAt).toLocaleString('pt-BR')}`
    : 'Nunca sincronizado';

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-200">Inteligência Estratégica</h3>
          <p className="text-xs text-slate-500 mt-0.5">{syncLabel}</p>
        </div>
        <Button
          variant="secondary"
          onClick={handleSync}
          disabled={isSyncing}
          className="text-xs px-3 py-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Atualizando...' : 'Atualizar Inteligência'}
        </Button>
      </div>

      {error && (
        <p className="text-xs text-red-400 mb-3 bg-red-500/10 rounded px-2 py-1">{error}</p>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Carregando fatores...
        </div>
      )}

      {!isLoading && !state.factors && (
        <div className="text-center py-6 text-slate-500 text-sm">
          <p>Nenhum fator disponível.</p>
          <p className="mt-1 text-xs">Clique em "Atualizar Inteligência" para gerar a primeira análise.</p>
        </div>
      )}

      {!isLoading && state.factors && (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Score Estratégico</span>
              <span className="text-[10px]">
                {state.lastSync
                  ? `${state.lastSync.visitCount} visitas · ${state.lastSync.pesquisaCount} pesquisas`
                  : ''}
              </span>
            </div>
            <ScoreBar score={state.factors.score} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FactorList
              icon={<TrendingUp className="w-3 h-3" />}
              label="Forças"
              items={state.factors.strengths}
              colorClass="text-emerald-400"
            />
            <FactorList
              icon={<AlertCircle className="w-3 h-3" />}
              label="Fraquezas"
              items={state.factors.weaknesses}
              colorClass="text-amber-400"
            />
            <FactorList
              icon={<Zap className="w-3 h-3" />}
              label="Oportunidades"
              items={state.factors.opportunities}
              colorClass="text-sky-400"
            />
            <FactorList
              icon={<ShieldAlert className="w-3 h-3" />}
              label="Riscos"
              items={state.factors.risks}
              colorClass="text-red-400"
            />
          </div>
        </div>
      )}
    </Card>
  );
};

export default IntelligencePanel;
