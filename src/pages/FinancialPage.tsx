import { usePermissions } from '../hooks/usePermissions';
import Tabs from '../components/Tabs';
import FinancialDashboard from '../components/financial/FinancialDashboard';
import IncomesList from '../components/financial/IncomesList';
import ExpensesList from '../components/financial/ExpensesList';
import BudgetCEOPanel from '../components/financial/BudgetCEOPanel';

const FinancialPage = () => {
  const permissions = usePermissions();

  if (permissions.canUseTeamPanels) {
    const tabs = ['Resumo', 'CEO Orçamento', 'Receitas', 'Despesas'];
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-200">Gestão Financeira</h2>
        <Tabs tabs={tabs} mode="state">
          <FinancialDashboard />
          <BudgetCEOPanel />
          <IncomesList />
          <ExpensesList />
        </Tabs>
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
