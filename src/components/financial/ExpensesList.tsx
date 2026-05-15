import * as React from 'react';
import { useFinancial } from '../../contexts/FinancialContext';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { Expense } from '../../types/financial';
import ExpenseForm from './ExpenseForm';
import { TrashIcon } from '../icons';

const ExpensesList: React.FC = () => {
    const { expenses, addExpense, deleteExpense } = useFinancial();
    const [isModalOpen, setIsModalOpen] = React.useState(false);

    const handleSave = async (expenseData: Omit<Expense, 'id'>) => {
        try {
            await addExpense(expenseData);
            alert('Despesa registrada com sucesso!');
            setIsModalOpen(false);
        } catch (error) {
            // Error handled by context
        }
    };

    const handleDelete = (id: string | number) => {
        if (window.confirm('Tem certeza que deseja excluir esta despesa?')) {
            deleteExpense(id);
        }
    };

    const formatCurrency = (value: number) => `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-slate-300">Registro de Despesas</h3>
                <Button onClick={() => setIsModalOpen(true)}>Adicionar Despesa</Button>
            </div>
            <Card>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-slate-300">
                        <thead className="text-xs text-slate-400 uppercase bg-slate-700">
                            <tr>
                                <th className="px-4 py-3">Data</th>
                                <th className="px-4 py-3">Categoria</th>
                                <th className="px-4 py-3">Descrição</th>
                                <th className="px-4 py-3">Fornecedor</th>
                                <th className="px-4 py-3 text-right">Valor</th>
                                <th className="px-4 py-3 text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {expenses.map(expense => (
                                <tr key={expense.id} className="bg-slate-800 border-b border-slate-700 hover:bg-slate-700/50">
                                    <td className="px-4 py-3">{expense.data}</td>
                                    <td className="px-4 py-3">{expense.categoria}</td>
                                    <td className="px-4 py-3">{expense.descricao}</td>
                                    <td className="px-4 py-3">{expense.fornecedor || 'N/A'}</td>
                                    <td className="px-4 py-3 text-right font-semibold text-red-400">{formatCurrency(expense.valor)}</td>
                                    <td className="px-4 py-3 text-center">
                                         <div className="flex items-center justify-center gap-2">
                                            {expense.notaFiscalUrl && (
                                                <a href={expense.notaFiscalUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 text-xs">Ver NF</a>
                                            )}
                                            <button onClick={() => handleDelete(expense.id)} className="text-red-400 hover:text-red-300"><TrashIcon className="h-4 w-4"/></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                     {expenses.length === 0 && <p className="text-center py-8 text-slate-400">Nenhuma despesa registrada.</p>}
                </div>
            </Card>

            {isModalOpen && (
                <Modal 
                    isOpen={isModalOpen} 
                    onClose={() => setIsModalOpen(false)} 
                    title="Adicionar Nova Despesa"
                >
                    <ExpenseForm 
                        onSave={handleSave}
                        onCancel={() => setIsModalOpen(false)}
                    />
                </Modal>
            )}
        </div>
    );
};

export default ExpensesList;