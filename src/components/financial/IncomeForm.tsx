import * as React from 'react';
import { Income, IncomeSource } from '../../types/financial';
import Input from '../ui/Input';
import Button from '../ui/Button';

interface IncomeFormProps {
    onSave: (income: Omit<Income, 'id'>) => void;
    onCancel: () => void;
}

const incomeSources: IncomeSource[] = ['Doação Pessoal', 'Recursos Próprios', 'Partido', 'Venda de Material', 'Outra'];
const documentTypes: Income['tipoDocumento'][] = ['Recibo', 'Transferência', 'Depósito', 'Outro'];

const IncomeForm: React.FC<IncomeFormProps> = ({ onSave, onCancel }) => {
    const [formData, setFormData] = React.useState({
        data: new Date().toISOString().split('T')[0],
        origem: 'Doação Pessoal' as IncomeSource,
        doador: '',
        documentoDoador: '',
        descricao: '',
        valor: '',
        tipoDocumento: 'Recibo' as Income['tipoDocumento']
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            ...formData,
            valor: parseFloat(formData.valor.replace(',', '.')) || 0,
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="Data" type="date" name="data" value={formData.data} onChange={handleChange} required />
                <Input label="Valor (R$)" name="valor" value={formData.valor} onChange={handleChange} required placeholder="100.00" />
            </div>
            <div>
                <label htmlFor="origem" className="block text-sm font-medium text-slate-300 mb-1">Origem da Receita</label>
                <select id="origem" name="origem" value={formData.origem} onChange={handleChange} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                    {incomeSources.map(source => <option key={source} value={source}>{source}</option>)}
                </select>
            </div>
            {formData.origem === 'Doação Pessoal' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input label="Nome do Doador" name="doador" value={formData.doador} onChange={handleChange} required placeholder="Nome Completo" />
                    <Input label="CPF do Doador" name="documentoDoador" value={formData.documentoDoador} onChange={handleChange} required placeholder="000.000.000-00" />
                </div>
            )}
            {formData.origem !== 'Doação Pessoal' && formData.origem !== 'Recursos Próprios' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input label="Instituição/Doador" name="doador" value={formData.doador} onChange={handleChange} required placeholder="Nome/Razão Social" />
                    <Input label="CPF/CNPJ" name="documentoDoador" value={formData.documentoDoador} onChange={handleChange} required placeholder="Documento" />
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label htmlFor="tipoDocumento" className="block text-sm font-medium text-slate-300 mb-1">Comprovante</label>
                    <select id="tipoDocumento" name="tipoDocumento" value={formData.tipoDocumento} onChange={handleChange} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                        {documentTypes.map(type => <option key={type} value={type}>{type}</option>)}
                    </select>
                </div>
                <Input label="Descrição" name="descricao" value={formData.descricao} onChange={handleChange} required placeholder="Ex: Doação para material gráfico" />
            </div>

            <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
                <Button type="submit">Adicionar Receita</Button>
            </div>
        </form>
    );
};

export default IncomeForm;
