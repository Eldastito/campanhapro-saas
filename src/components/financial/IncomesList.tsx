import * as React from 'react';
import { useFinancial } from '../../contexts/FinancialContext';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { Income } from '../../types/financial';
import IncomeForm from './IncomeForm';
import { TrashIcon } from '../icons';

const IncomesList: React.FC = () => {
    const { incomes, addIncome, deleteIncome } = useFinancial();
    const [isModalOpen, setIsModalOpen] = React.useState(false);

    const handleSave = async (incomeData: Omit<Income, 'id'>) => {
        try {
            await addIncome(incomeData);
            alert('Receita registrada com sucesso!');
            setIsModalOpen(false);
        } catch (error) {
            // Error is handled and alerted by handleSupabaseError inside the context
        }
    };
    
    const handleDelete = (id: string | number) => {
        if (window.confirm('Tem certeza que deseja excluir esta receita?')) {
            deleteIncome(id);
        }
    };

    const formatCurrency = (value: number) => `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-slate-300">Registro de Receitas</h3>
                <Button onClick={() => setIsModalOpen(true)}>Adicionar Receita</Button>
            </div>
            <Card>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-slate-300">
                        <thead className="text-xs text-slate-400 uppercase bg-slate-700">
                            <tr>
                                <th className="px-4 py-3">Data</th>
                                <th className="px-4 py-3">Origem</th>
                                <th className="px-4 py-3">Descrição</th>
                                <th className="px-4 py-3">Doador</th>
                                <th className="px-4 py-3 text-right">Valor</th>
                                <th className="px-4 py-3 text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {incomes.map(income => (
                                <tr key={income.id} className="bg-slate-800 border-b border-slate-700 hover:bg-slate-700/50">
                                    <td className="px-4 py-3">{income.data}</td>
                                    <td className="px-4 py-3">{income.origem}</td>
                                    <td className="px-4 py-3">{income.descricao}</td>
                                    <td className="px-4 py-3">{income.doador || 'N/A'}</td>
                                    <td className="px-4 py-3 text-right font-semibold text-green-400">{formatCurrency(income.valor)}</td>
                                    <td className="px-4 py-3 text-center">
                                        <button onClick={() => handleDelete(income.id)} className="text-red-400 hover:text-red-300"><TrashIcon className="h-4 w-4"/></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                     {incomes.length === 0 && <p className="text-center py-8 text-slate-400">Nenhuma receita registrada.</p>}
                </div>
            </Card>

            {isModalOpen && (
                <Modal 
                    isOpen={isModalOpen} 
                    onClose={() => setIsModalOpen(false)} 
                    title="Adicionar Nova Receita"
                >
                    <IncomeForm 
                        onSave={handleSave}
                        onCancel={() => setIsModalOpen(false)}
                    />
                </Modal>
            )}
        </div>
    );
};

export default IncomesList;