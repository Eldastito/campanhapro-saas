import * as React from 'react';
import { RefreshCw, Activity, Users, ClipboardList } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';

interface FactorData {
  score: number;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  opportunities: string[];
  syncedAt: string;
}

interface SyncLog {
  lastSyncAt: string;
  visitCount: number;
  pesquisaCount: number;
}

interface OverviewState {
  factors: FactorData | null;
  lastSync: SyncLog | null;
}

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string | number }> = ({
  icon, label, value
}) => (
  <div className="bg-slate-700/50 rounded-xl p-4 flex items-center gap-3">
    <div className="text-sky-400">{icon}</div>
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-lg font-bold text-slate-100">{value}</p>
    </div>
  </div>
);

const ScoreGauge: React.FC<{ score: number }> = ({ score }) => {
  const color = score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444';
  const label = score >= 70 ? 'Forte' : score >= 40 ? 'Moderado' : 'Crítico';

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative flex items-center justify-center w-28 h-28 rounded-full border-8"
        style={{ borderColor: color }}
      >
        <div className="text-center">
          <p className="text-3xl font-black text-slate-100">{score}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>
            {label}
          </p>
        </div>
      </div>
      <p className="text-xs text-slate-400">Score Estratégico</p>
    </div>
  );
};

interface IntelligenceOverviewProps {
  onSyncComplete?: () => void;
}

const IntelligenceOverview: React.FC<IntelligenceOverviewProps> = ({ onSyncComplete }) => {
  const { user } = useAuth();
  const [state, setState] = React.useState<OverviewState>({ factors: null, lastSync: null });
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchData = React.useCallback(async () => {
    if (!user?.campaignId) return;
    try {
      const res = await fetch('/api/v1/intelligence/factors');
      if (res.ok) {
        const json = await res.json();
        setState({ factors: json.factors, lastSync: json.lastSync });
      }
    } catch {
      // service unavailable
    } finally {
      setIsLoading(false);
    }
  }, [user?.campaignId]);

  React.useEffect(() => { fetchData(); }, [fetchData]);

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
      await fetchData();
      onSyncComplete?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const syncLabel = state.lastSync?.lastSyncAt
    ? new Date(state.lastSync.lastSyncAt).toLocaleString('pt-BR')
    : 'Nunca sincronizado';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-200">Visão Geral</h3>
          <p className="text-xs text-slate-500">Última sincronização: {syncLabel}</p>
        </div>
        <Button variant="primary" onClick={handleSync} disabled={isSyncing}
          className="bg-gradient-to-r from-sky-600 to-indigo-600 border-none text-sm">
          <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Atualizando...' : 'Atualizar Inteligência'}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16 text-slate-500">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
      ) : !state.factors ? (
        <Card>
          <div className="text-center py-10 text-slate-500">
            <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nenhuma análise disponível</p>
            <p className="text-sm mt-1">Clique em "Atualizar Inteligência" para gerar a primeira análise estratégica.</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard icon={<Activity className="w-5 h-5" />}
              label="Visitas Processadas" value={state.lastSync?.visitCount ?? '—'} />
            <StatCard icon={<ClipboardList className="w-5 h-5" />}
              label="Pesquisas Processadas" value={state.lastSync?.pesquisaCount ?? '—'} />
            <StatCard icon={<Users className="w-5 h-5" />}
              label="Fatores Identificados"
              value={
                state.factors.strengths.length +
                state.factors.weaknesses.length +
                state.factors.risks.length +
                state.factors.opportunities.length
              } />
          </div>

          <Card>
            <div className="flex flex-col sm:flex-row items-center gap-8 p-2">
              <ScoreGauge score={state.factors.score} />
              <div className="flex-1 grid grid-cols-2 gap-4 text-sm">
                {[
                  { label: 'Forças', items: state.factors.strengths, color: 'text-emerald-400' },
                  { label: 'Fraquezas', items: state.factors.weaknesses, color: 'text-amber-400' },
                  { label: 'Oportunidades', items: state.factors.opportunities, color: 'text-sky-400' },
                  { label: 'Riscos', items: state.factors.risks, color: 'text-red-400' },
                ].map(({ label, items, color }) => (
                  <div key={label}>
                    <p className={`text-xs font-semibold mb-1 ${color}`}>{label} ({items.length})</p>
                    <ul className="space-y-0.5">
                      {items.slice(0, 3).map((item, i) => (
                        <li key={i} className="text-xs text-slate-400 truncate">· {item}</li>
                      ))}
                      {items.length > 3 && (
                        <li className="text-xs text-slate-600">+{items.length - 3} mais</li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default IntelligenceOverview;
