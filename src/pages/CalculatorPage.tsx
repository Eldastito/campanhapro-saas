import * as React from 'react';
import { useCalculator } from '../contexts/CalculatorContext';
import { SCENARIO_VOTES } from '../constants';
import { Scenario } from '../types/calculator';
import { calculateDaysRemaining, getNextElectionDate } from '../utils/helpers';
import CalculatorForm from '../components/calculator/CalculatorForm';
import CalculatorSummary from '../components/calculator/CalculatorSummary';
import SavedScenariosList from '../components/calculator/SavedScenariosList';
import CalculatorRealityCard from '../components/calculator/CalculatorRealityCard';
import CalculatorAnalysisCard from '../components/calculator/CalculatorAnalysisCard';

const CalculatorPage = () => {
  const {
    calcState,
    setCalcState: setGlobalCalcState,
    scenarios,
    addScenario,
    idealScenarioId,
    setIdealScenarioId,
    deleteScenario,
  } = useCalculator();

  const daysRemaining = React.useMemo(() => calculateDaysRemaining(calcState.eleicao), [calcState.eleicao]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    const newState = { ...calcState, [name]: type === 'number' ? parseFloat(value) || 0 : value };
    setGlobalCalcState(newState);
  };

  const setElectionToNextYear = () => {
    setGlobalCalcState({ ...calcState, eleicao: getNextElectionDate() });
  };

  const handleSaveScenario = () => {
    const name = prompt("Nome para este cenário:", `Cenário ${scenarios.length + 1}`);
    if (name) {
      const newScenario: Omit<Scenario, 'id'> = { ...calcState, name };
      addScenario(newScenario);
    }
  };

  const scenariosToCompare = React.useMemo(() => [
    { vpf: calcState.vpf, label: "Base Personalizada" },
    ...SCENARIO_VOTES.map(v => ({ vpf: v, label: `${v} Votos/Família` }))
  ], [calcState.vpf]);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-slate-200">Calculadora de Metas</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <CalculatorForm
          calcState={calcState}
          onChange={handleChange}
          onSetElection={setElectionToNextYear}
          onSaveScenario={handleSaveScenario}
        />
        <div className="md:col-span-2 space-y-6">
          <CalculatorSummary
            calcState={calcState}
            daysRemaining={daysRemaining}
            scenariosToCompare={scenariosToCompare}
          />
        </div>
      </div>

      {/* NOVO #134: Realidade (dados de campo) + Recomendação IA */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <CalculatorRealityCard planned={{ vpf: calcState.vpf, cap: calcState.cap, meta: calcState.meta }} />
        <CalculatorAnalysisCard />
      </div>

      {scenarios.length > 0 && (
        <SavedScenariosList
          scenarios={scenarios}
          idealScenarioId={idealScenarioId}
          onSetIdeal={setIdealScenarioId}
          onDelete={deleteScenario}
        />
      )}
    </div>
  );
};

export default CalculatorPage;