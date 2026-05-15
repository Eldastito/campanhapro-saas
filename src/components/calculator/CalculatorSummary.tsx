import { CalculatorState } from '../../types/calculator';
import { calculateScenarioMetrics } from '../../utils/helpers';
import Card from '../ui/Card';

interface CalculatorSummaryProps {
  calcState: CalculatorState;
  daysRemaining: number;
  scenariosToCompare: { vpf: number; label: string }[];
}

const CalculatorSummary = ({ calcState, daysRemaining, scenariosToCompare }: CalculatorSummaryProps) => {
  const mainMetrics = calculateScenarioMetrics(calcState, daysRemaining);

  return (
    <>
      <Card>
        <h3 className="font-bold text-lg text-slate-300 mb-4">Resumo e KPIs</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div className="p-2 bg-slate-700 rounded-lg">
                <div className="text-3xl font-bold text-[#4ac7f0]">{daysRemaining}</div>
                <div className="text-sm text-slate-400">Dias Restantes</div>
            </div>
            <div className="p-2 bg-slate-700 rounded-lg">
                <div className="text-3xl font-bold text-[#4ac7f0]">{mainMetrics.familiesWithBuffer}</div>
                <div className="text-sm text-slate-400">Famílias (+Buffer)</div>
            </div>
            <div className="p-2 bg-slate-700 rounded-lg">
                <div className="text-3xl font-bold text-[#4ac7f0]">{mainMetrics.famPerWeek}</div>
                <div className="text-sm text-slate-400">Famílias / Semana</div>
            </div>
            <div className="p-2 bg-slate-700 rounded-lg">
                <div className="text-3xl font-bold text-[#4ac7f0]">{mainMetrics.famPerDay}</div>
                <div className="text-sm text-slate-400">Famílias / Dia</div>
            </div>
        </div>
      </Card>
      <Card>
        <h3 className="font-bold text-lg text-slate-300 mb-4">Comparativo de Cenários</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-300">
            <thead className="text-xs text-slate-400 uppercase bg-slate-700">
              <tr>
                <th className="px-4 py-3">Cenário</th>
                <th className="px-4 py-3 text-right">Famílias Necessárias</th>
                <th className="px-4 py-3 text-right">/ Semana</th>
                <th className="px-4 py-3 text-right">/ Dia</th>
                <th className="px-4 py-3">Capacidade</th>
              </tr>
            </thead>
            <tbody>
              {scenariosToCompare.map(scen => {
                const metrics = calculateScenarioMetrics({ ...calcState, vpf: scen.vpf }, daysRemaining);
                return (
                  <tr key={scen.label} className="bg-slate-800 border-b border-slate-700 hover:bg-slate-700/50">
                    <td className="px-4 py-3 font-medium">{scen.label}</td>
                    <td className="px-4 py-3 text-right">{metrics.familiesWithBuffer}</td>
                    <td className="px-4 py-3 text-right">{metrics.famPerWeek}</td>
                    <td className="px-4 py-3 text-right">{metrics.famPerDay}</td>
                    <td className={`px-4 py-3 font-semibold ${metrics.capacityColor}`}>{metrics.capacityStatus}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
};

export default CalculatorSummary;