import * as React from 'react';
import { ShieldAlert } from 'lucide-react';
import Tabs from '../components/Tabs';
import ErrorBoundary from '../components/dev/ErrorBoundary';
import RiskDashboard from '../components/legal-shield/RiskDashboard';
import OpinionsList from '../components/legal-shield/OpinionsList';
import ReviewForm from '../components/legal-shield/ReviewForm';

const SUBTABS = ['Painel de Risco', 'Pareceres', 'Nova Análise'];

const LegalShieldPage: React.FC = () => {
  // bump pra forçar refresh das listas após uma nova análise
  const [refreshKey, setRefreshKey] = React.useState(0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-6 h-6 text-indigo-400" />
        <div>
          <h2 className="text-2xl font-bold text-slate-200">Blindagem Jurídico-Contábil</h2>
          <p className="text-xs text-slate-500">
            Copiloto de conformidade — apoio à decisão, não substitui o responsável técnico.
          </p>
        </div>
      </div>

      <Tabs tabs={SUBTABS} mode="state">
        <ErrorBoundary label="Painel de Risco">
          <RiskDashboard refreshKey={refreshKey} />
        </ErrorBoundary>

        <ErrorBoundary label="Pareceres">
          <OpinionsList refreshKey={refreshKey} />
        </ErrorBoundary>

        <ErrorBoundary label="Nova Análise">
          <ReviewForm onCreated={() => setRefreshKey((k) => k + 1)} />
        </ErrorBoundary>
      </Tabs>
    </div>
  );
};

export default LegalShieldPage;
