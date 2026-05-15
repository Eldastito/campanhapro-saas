import { usePermissions } from '../hooks/usePermissions';
import { CurrencyDollarIcon } from '../components/icons';
import Tabs from '../components/Tabs';
import FinancialDashboard from '../components/financial/FinancialDashboard';
import IncomesList from '../components/financial/IncomesList';
import ExpensesList from '../components/financial/ExpensesList';

const FinancialPage = () => {
  const permissions = usePermissions();

  if (!permissions.canUseTeamPanels) { // Assuming 'canUseTeamPanels' is for "Plano Total" features
    return (
      <div className="flex flex-col items-center justify-center text-center h-64">
        <CurrencyDollarIcon className="h-16 w-16 text-slate-500" />
        <h2 className="mt-4 text-2xl font-bold text-slate-300">Painel Financeiro</h2>
        <p className="mt-2 max-w-md text-slate-400">
          Este recurso está disponível apenas no plano <strong>Campanha Total</strong>.
          Ele permite que você controle o orçamento, despesas e receitas da sua campanha.
        </p>
      </div>
    );
  }

  const tabs = ['Resumo', 'Receitas', 'Despesas'];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-slate-200">Gestão Financeira</h2>
      <Tabs tabs={tabs} mode="state">
        <FinancialDashboard />
        <IncomesList />
        <ExpensesList />
      </Tabs>
    </div>
  );
};

export default FinancialPage;
