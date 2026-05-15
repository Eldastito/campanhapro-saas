import * as React from 'react';
import { FlaskConical } from 'lucide-react';
import Tabs from '../components/Tabs';
import ErrorBoundary from '../components/dev/ErrorBoundary';

const MonteCarloChart = React.lazy(() => import('../components/scenarios/MonteCarloChart'));
const PoliticalGraph = React.lazy(() => import('../components/scenarios/PoliticalGraph'));
const DossierPanel = React.lazy(() => import('../components/scenarios/DossierPanel'));
const SimulationHistory = React.lazy(() => import('../components/scenarios/SimulationHistory'));

const SUBTABS = ['Simulação Monte Carlo', 'Grafo Político', 'Dossiês', 'Histórico'];

const ScenariosPage: React.FC = () => (
  <div className="space-y-6">
    <div className="flex items-center gap-2">
      <FlaskConical className="w-6 h-6 text-indigo-400" />
      <h2 className="text-2xl font-bold text-slate-200">Cenários Avançados</h2>
    </div>

    <Tabs tabs={SUBTABS} mode="state">
      <ErrorBoundary label="Simulação Monte Carlo">
        <React.Suspense fallback={<div className="py-8 text-center text-slate-500 text-sm">Carregando...</div>}>
          <MonteCarloChart />
        </React.Suspense>
      </ErrorBoundary>

      <ErrorBoundary label="Grafo Político">
        <React.Suspense fallback={<div className="py-8 text-center text-slate-500 text-sm">Carregando...</div>}>
          <PoliticalGraph />
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
