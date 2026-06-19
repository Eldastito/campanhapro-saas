import * as React from 'react';
import { FlaskConical } from 'lucide-react';
import Tabs from '../components/Tabs';
import ErrorBoundary from '../components/dev/ErrorBoundary';

const MonteCarloChart = React.lazy(() => import('../components/scenarios/MonteCarloChart'));
const ScenarioSimulator = React.lazy(() => import('../components/scenarios/ScenarioSimulator'));
const DossierPanel = React.lazy(() => import('../components/scenarios/DossierPanel'));
const SimulationHistory = React.lazy(() => import('../components/scenarios/SimulationHistory'));

// "Simulação" funde o antigo Grafo Político + Debate IA: o grafo animado é o
// palco onde os agentes (dados reais) debatem o cenário ao vivo.
const SUBTABS = ['Simulação', 'Monte Carlo', 'Dossiês', 'Histórico'];

const ScenariosPage: React.FC = () => (
  <div className="space-y-6">
    <div className="flex items-center gap-2">
      <FlaskConical className="w-6 h-6 text-indigo-400" />
      <h2 className="text-2xl font-bold text-slate-200">Cenários Avançados</h2>
    </div>

    <Tabs tabs={SUBTABS} mode="state">
      <ErrorBoundary label="Simulação">
        <React.Suspense fallback={<div className="py-8 text-center text-slate-500 text-sm">Carregando...</div>}>
          <ScenarioSimulator />
        </React.Suspense>
      </ErrorBoundary>

      <ErrorBoundary label="Monte Carlo">
        <React.Suspense fallback={<div className="py-8 text-center text-slate-500 text-sm">Carregando...</div>}>
          <MonteCarloChart />
        </React.Suspense>
      </ErrorBoundary>

      <ErrorBoundary label="Dossiês">
        <React.Suspense fallback={<div className="py-8 text-center text-slate-500 text-sm">Carregando...</div>}>
          <DossierPanel />
        </React.Suspense>
      </ErrorBoundary>

      <ErrorBoundary label="Histórico">
        <React.Suspense fallback={<div className="py-8 text-center text-slate-500 text-sm">Carregando...</div>}>
          <SimulationHistory />
        </React.Suspense>
      </ErrorBoundary>
    </Tabs>
  </div>
);

export default ScenariosPage;
