import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import { GitBranch, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import Card from '../ui/Card';
import { useAuth } from '../../contexts/AuthContext';

interface ScenarioProjection {
  id: string;
  name: string;
  probability: number;
  projectedVotes: number;
  description: string;
  requiredActions: string[];
}

const ProbabilityBar: React.FC<{ value: number }> = ({ value }) => {
  const color = value >= 60 ? 'bg-emerald-500' : value >= 30 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-slate-700 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-slate-300 w-8 text-right font-medium">{value}%</span>
    </div>
  );
};

const ScenarioCard: React.FC<{ scenario: ScenarioProjection }> = ({ scenario }) => {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className="bg-slate-700/40 rounded-xl border border-slate-700 overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-700/60 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <GitBranch className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="font-semibold text-slate-100 truncate">{scenario.name}</span>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-2">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Probabilidade</p>
              <ProbabilityBar value={scenario.probability} />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Votos Projetados</p>
              <p className="text-sm font-bold text-slate-200">{scenario.projectedVotes.toLocaleString('pt-BR')}</p>
            </div>
          </div>
        </div>
        <div className="ml-4 text-slate-400 shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-700/50 pt-3 space-y-3">
          <p className="text-sm text-slate-300">{scenario.description}</p>
          {scenario.requiredActions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-indigo-400 mb-2">Ações Necessárias</p>
              <ul className="space-y-1">
                {scenario.requiredActions.map((action, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                    <span className="text-indigo-400 shrink-0 mt-0.5">→</span>
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const IntelligenceScenarios: React.FC = () => {
  const { user } = useAuth();
  const [scenarios, setScenarios] = React.useState<ScenarioProjection[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    if (!user?.campaignId) return;
    authedFetch('/api/v1/intelligence/scenarios')
      .then(r => r.ok ? r.json() : { scenarios: [] })
      .then(json => setScenarios(json.scenarios || []))
      .catch(() => setScenarios([]))
      .finally(() => setIsLoading(false));
  }, [user?.campaignId]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16 text-slate-500">
        <RefreshCw className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-200">Projeções de Cenário</h3>
        {scenarios.length > 0 && (
          <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded-full font-medium">
            {scenarios.length} cenário{scenarios.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {scenarios.length === 0 ? (
        <Card>
          <div className="text-center py-10 text-slate-500">
            <GitBranch className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nenhum cenário projetado</p>
            <p className="text-sm mt-1 max-w-sm mx-auto">
              Os cenários são gerados pelo CampanhaProCenários após a sincronização do snapshot.
              Certifique-se que o serviço externo está configurado.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {scenarios
            .sort((a, b) => b.probability - a.probability)
            .map(s => <ScenarioCard key={s.id} scenario={s} />)}
        </div>
      )}
    </div>
  );
};

export default IntelligenceScenarios;
