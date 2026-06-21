import * as React from 'react';
import { useFinancial } from '../../contexts/FinancialContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useTeam } from '../../contexts/TeamContext';
import { useCalculator } from '../../contexts/CalculatorContext';
import { usePrintIsolation } from '../../hooks/usePrintIsolation';
import Card from '../ui/Card';
import { PrintIcon, FileTextIcon, AlertTriangleIcon, CheckCircleIcon } from '../icons';
import Button from '../ui/Button';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { calculateDaysRemaining, exportToCsv, downloadFile } from '../../utils/helpers';
import { buildSpcePlanilha } from '../../lib/spceExport';

const COLORS = ['#4ac7f0', '#1abc9c', '#f1c40f', '#e67e22', '#e74c3c', '#9b59b6', '#3498db', '#2ecc71'];

const FinancialDashboard = () => {
    const { incomes, expenses } = useFinancial();
    const { teamMembers } = useTeam();
    const { campaignDetails, footerLogo } = useSettings();
    const { calcState } = useCalculator();

    usePrintIsolation();

    const totalTeamCosts = React.useMemo(() => teamMembers.reduce((sum, member) => sum + (member.cost || 0), 0), [teamMembers]);
    const totalIncomes = React.useMemo(() => incomes.reduce((sum, item) => sum + item.valor, 0), [incomes]);
    const totalExpenses = React.useMemo(() => expenses.reduce((sum, item) => sum + item.valor, 0) + totalTeamCosts, [expenses, totalTeamCosts]);
    const balance = totalIncomes - totalExpenses;
    const budget = campaignDetails.orcamento || 0;
    const budgetUsage = budget > 0 ? (totalExpenses / budget) * 100 : 0;

    // Métricas de Planejamento (Runway)
    const daysRemaining = React.useMemo(() => calculateDaysRemaining(calcState.eleicao), [calcState.eleicao]);
    const dailySpend = React.useMemo(() => {
        if (expenses.length === 0 && totalTeamCosts === 0) return 0;
        const total = expenses.reduce((s, e) => s + e.valor, 0) + totalTeamCosts;
        
        if (expenses.length === 0) return total / 30; // Se só tem custo fixo (equipe), aproxima para gasto mensal / 30

        const sortedExpenses = [...expenses].sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());
        const firstDate = new Date(sortedExpenses[0].data);
        const lastDate = new Date(sortedExpenses[sortedExpenses.length - 1].data);
        const periodDays = Math.max(1, Math.ceil((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)));
        
        return total / periodDays;
    }, [expenses, totalTeamCosts]);
    
    const runwayDays = balance > 0 && dailySpend > 0 ? Math.floor(balance / dailySpend) : 0;

    // Métricas de Conformidade Contábil (TRE)
    const complianceStats = React.useMemo(() => {
        const totalEntries = incomes.length + expenses.length;
        if (totalEntries === 0) return { score: 100, missingDocs: 0, missingTaxIds: 0 };
        
        const incomeCompliance = incomes.length > 0 
          ? incomes.filter(i => i.documentoDoador).length / incomes.length 
          : 1;
        const expenseCompliance = expenses.length > 0
          ? expenses.filter(e => e.notaFiscalUrl && e.documentoFornecedor).length / expenses.length
          : 1;
        const score = Math.round(((incomeCompliance + expenseCompliance) / 2) * 100);
        
        return {
            score,
            missingDocs: expenses.filter(e => !e.notaFiscalUrl).length,
            missingTaxIds: (incomes.filter(i => !i.documentoDoador).length + expenses.filter(e => !e.documentoFornecedor).length)
        };
    }, [incomes, expenses]);

    const expensesByCategory = React.useMemo(() => {
        const data: { [key: string]: number } = {};
        expenses.forEach(expense => {
            data[expense.categoria] = (data[expense.categoria] || 0) + expense.valor;
        });
        if (totalTeamCosts > 0) {
            data['Pessoal (Equipe)'] = (data['Pessoal (Equipe)'] || 0) + totalTeamCosts;
        }
        return Object.entries(data).map(([name, value]) => ({ name, value }));
    }, [expenses, totalTeamCosts]);

    const recentTransactions = React.useMemo(() => {
        const all = [
            ...incomes.map(i => ({ ...i, type: 'income' as const })),
            ...expenses.map(e => ({ ...e, type: 'expense' as const }))
        ];
        return all.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()).slice(0, 10);
    }, [incomes, expenses]);
    
    const handleExportAccounting = () => {
        const data = [
            ...incomes.map(i => ({ Data: i.data, Tipo: 'Receita', Origem: i.origem, Nome: i.doador, Documento: i.documentoDoador, Descricao: i.descricao, Valor: i.valor, Comprovante: i.tipoDocumento })),
            ...expenses.map(e => ({ Data: e.data, Tipo: 'Despesa', Origem: e.categoria, Nome: e.fornecedor, Documento: e.documentoFornecedor, Descricao: e.descricao, Valor: e.valor * -1, Comprovante: e.tipoDocumento, Situacao: e.statusDocumento }))
        ];
        exportToCsv(data, `Contas_Campanha_${new Date().toISOString().split('T')[0]}.csv`);
    };

    // Export SPCE: planilha do contador (Receitas + Despesas separadas, com
    // todos os campos TSE). Gera os dois arquivos prontos pra prestação de contas.
    const handleExportSpce = () => {
        if (incomes.length === 0 && expenses.length === 0) {
            alert('Não há receitas ou despesas para exportar.');
            return;
        }
        for (const file of buildSpcePlanilha(incomes, expenses)) {
            downloadFile(file.filename, file.content, file.mimeType);
        }
    };

    const handlePrint = () => {
        // Ensure browser focus is on the frame and trigger standard print dialog
        window.focus();
        window.print();
    };

    const formatCurrency = (value: number) => `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return (
        <div className="space-y-6 text-slate-200 print-root">
            <div className="print-footer hidden text-[9px] text-slate-500 text-center">
                {campaignDetails?.cnpj
                    ? `CNPJ da campanha: ${campaignDetails.cnpj} · ${campaignDetails?.nomeUrna || ''} · Gerado por CampanhaPro`
                    : '⚠ CNPJ da campanha não cadastrado (obrigatório TSE) · CampanhaPro'}
            </div>
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 no-print">
                <div>
                    <h3 className="text-xl font-bold text-slate-300">Resumo Estratégico</h3>
                    <p className="text-sm text-slate-400">Controle de fluxo de caixa e conformidade eleitoral.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={handleExportAccounting}><FileTextIcon className="w-4 h-4" /> Exportar (Contador)</Button>
                    <Button variant="secondary" onClick={handleExportSpce}><FileTextIcon className="w-4 h-4" /> Exportar SPCE (TSE)</Button>
                    <Button variant="secondary" onClick={handlePrint}><PrintIcon className="w-4 h-4" /> Imprimir</Button>
                </div>
            </div>
            
            <div className="print-page-title hidden print:block">Relatório Consolidado de Prestação de Contas</div>
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <Card className="print-card border-l-4 border-sky-500">
                    <div className="text-sm text-slate-400">Saldo Atual</div>
                    <div className={`text-2xl font-bold ${balance >= 0 ? 'text-sky-400' : 'text-orange-400'}`}>{formatCurrency(balance)}</div>
                    <div className="text-xs text-slate-500 mt-1">Entradas - Saídas</div>
                </Card>
                <Card className="print-card border-l-4 border-emerald-500">
                    <div className="text-sm text-slate-400">Uso do Orçamento</div>
                    <div className="text-2xl font-bold text-emerald-400">{budgetUsage.toFixed(1)}%</div>
                    <div className="w-full bg-slate-700 h-1.5 mt-2 rounded-full overflow-hidden">
                        <div className="bg-emerald-500 h-full" style={{ width: `${Math.min(budgetUsage, 100)}%` }}></div>
                    </div>
                </Card>
                <Card className="print-card border-l-4 border-purple-500">
                    <div className="text-sm text-slate-400">Conformidade TRE</div>
                    <div className="text-2xl font-bold text-purple-400">{complianceStats.score}%</div>
                    <div className="text-xs text-slate-500 mt-1">Documentação Validada</div>
                </Card>
                <Card className="print-card border-l-4 border-amber-500">
                    <div className="text-sm text-slate-400">Runway (Estimativa)</div>
                    <div className="text-2xl font-bold text-amber-500">{runwayDays === Infinity ? '∞' : runwayDays} dias</div>
                    <div className="text-xs text-slate-500 mt-1">Até esgotar saldo</div>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2">
                    <div className="flex justify-between items-center mb-6">
                        <h4 className="font-semibold text-slate-300">Alertas de Auditoria (TRE)</h4>
                        <span className="text-xs text-slate-500 uppercase tracking-wider">Atenção Prioritária</span>
                    </div>
                    <div className="space-y-4">
                        {complianceStats.missingDocs > 0 && (
                            <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                                <AlertTriangleIcon className="text-red-400 shrink-0 w-6 h-6" />
                                <div className="flex-1">
                                    <div className="text-sm font-medium text-red-200">{complianceStats.missingDocs} despesas sem Nota Fiscal anexada</div>
                                    <div className="text-xs text-red-400/80">Obrigatório para prestação de contas final.</div>
                                </div>
                                <Button variant="secondary">Resolver</Button>
                            </div>
                        )}
                        {complianceStats.missingTaxIds > 0 && (
                            <div className="flex items-center gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                                <AlertTriangleIcon className="text-amber-400 shrink-0 w-6 h-6" />
                                <div className="flex-1">
                                    <div className="text-sm font-medium text-amber-200">{complianceStats.missingTaxIds} registros sem CPF/CNPJ</div>
                                    <div className="text-xs text-amber-400/80">Necessário identificar doadores e fornecedores.</div>
                                </div>
                                <Button variant="secondary">Corrigir</Button>
                            </div>
                        )}
                        {complianceStats.missingDocs === 0 && complianceStats.missingTaxIds === 0 && (
                            <div className="flex items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                                <CheckCircleIcon className="text-emerald-400 shrink-0 w-6 h-6" />
                                <div className="text-sm font-medium text-emerald-200">Todos os registros possuem documentação básica.</div>
                            </div>
                        )}
                        
                        <div className="mt-6">
                            <h5 className="text-xs font-bold text-slate-500 uppercase mb-3">Dias Restantes de Campanha</h5>
                            <div className="flex items-end gap-1">
                                <span className="text-4xl font-bold text-slate-200">{daysRemaining}</span>
                                <span className="text-slate-500 mb-1">dias até a eleição</span>
                            </div>
                            <p className="text-xs text-slate-500 mt-2">Gasto médio diário ideal para o saldo atual: <strong>{formatCurrency(balance / Math.max(daysRemaining, 1))}</strong></p>
                        </div>
                    </div>
                </Card>

                <Card>
                    <h4 className="font-semibold text-slate-300 mb-4">Divisão de Gastos</h4>
                    <div className="h-64 w-full">
                        <ResponsiveContainer>
                            <PieChart>
                                <Pie data={expensesByCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5}>
                                    {expensesByCategory.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                </Pie>
                                <Tooltip formatter={(value: any) => formatCurrency(Number(value))} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="mt-4 space-y-2">
                        {expensesByCategory.map((item, index) => (
                            <div key={item.name} className="flex justify-between items-center text-xs">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                                    <span className="text-slate-400">{item.name}</span>
                                </div>
                                <span className="text-slate-300 font-medium">{formatCurrency(item.value)}</span>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>
            
            <Card className="print-card print-break-inside-avoid">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-slate-300 print-text-black">Consolidação de Contas</h3>
                    <div className="text-xs text-slate-500">Exibindo registros recentes</div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-slate-300">
                         <thead className="text-xs text-slate-400 uppercase bg-slate-700/50 print-bg-transparent">
                            <tr>
                                <th className="px-4 py-3">Data</th>
                                <th className="px-4 py-3">Tipo</th>
                                <th className="px-4 py-3">Nome / CPF-CNPJ</th>
                                <th className="px-4 py-3">Comprovante</th>
                                <th className="px-4 py-3 text-right">Valor</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recentTransactions.map((tx) => (
                                <tr key={`${tx.type}-${tx.id}`} className="hover:bg-slate-700/30 border-b border-slate-700/50 print-bg-transparent transition-colors">
                                    <td className="px-4 py-3">{tx.data}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-col">
                                            <span className={`text-xs font-bold ${tx.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>
                                                {tx.type === 'income' ? 'RECEITA' : 'DESPESA'}
                                            </span>
                                            <span className="text-[10px] text-slate-500">{(tx as any).origem || (tx as any).categoria}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-col">
                                            <span className="font-medium">{(tx as any).doador || (tx as any).fornecedor || '-'}</span>
                                            <span className="text-[10px] text-slate-500">{(tx as any).documentoDoador || (tx as any).documentoFornecedor || 'Documento faltante'}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs">{(tx as any).tipoDocumento || 'S/ Doc'}</span>
                                            {(tx as any).notaFiscalUrl && <CheckCircleIcon className="w-3 h-3 text-emerald-500" />}
                                            {tx.type === 'expense' && !(tx as any).notaFiscalUrl && <AlertTriangleIcon className="w-3 h-3 text-red-500" />}
                                        </div>
                                    </td>
                                    <td className={`px-4 py-3 text-right font-mono font-bold ${tx.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(tx.valor)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

             <div className="print-footer hidden print:block border-t border-slate-700 pt-8 mt-8">
                <div className="flex justify-between items-end">
                    <div>
                        <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-2">Autenticação do Sistema</p>
                        <p className="text-xs text-slate-400">Relatório consolidado de transparência v1.0</p>
                        <p className="text-xs text-slate-400">Gerado em {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}</p>
                    </div>
                    {footerLogo && <img src={footerLogo} alt="Logo Rodapé" className="max-h-16 grayscale opacity-50" />}
                </div>
            </div>
        </div>
    );
};

export default FinancialDashboard;
