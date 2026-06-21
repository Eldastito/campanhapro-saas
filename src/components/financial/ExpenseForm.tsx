import * as React from 'react';
import { Expense, ExpenseCategory, FormaPagamento, TipoGastoTSE } from '../../types/financial';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { fileToBase64 } from '../../utils/helpers';

interface ExpenseFormProps {
    onSave: (expense: Omit<Expense, 'id'>) => void;
    onCancel: () => void;
}

const expenseCategories: ExpenseCategory[] = ['Alimentação', 'Combustível', 'Aluguel de Carro', 'Aluguel de Espaço', 'Material Gráfico', 'Pessoal (Ajuda de Custo)', 'Pessoal (Salário)', 'Advogado', 'Contador', 'Eventos', 'Marketing Digital', 'Outra'];
const documentTypes: Expense['tipoDocumento'][] = ['Nota Fiscal', 'Cupom Fiscal', 'Recibo', 'Contrato', 'Outro'];
const formasPagamento: FormaPagamento[] = ['Dinheiro', 'Cheque', 'Transferência bancária', 'Cartão de débito', 'Cartão de crédito', 'PIX', 'Boleto', 'Outro'];
const tiposGasto: TipoGastoTSE[] = ['Pessoal', 'Material de campanha (gráfico)', 'Comícios/eventos', 'Propaganda (rádio/TV/internet)', 'Impulsionamento de conteúdo na internet', 'Combustível e lubrificantes', 'Locação/aquisição de veículos', 'Locação de bens móveis/imóveis', 'Serviços advocatícios/contábeis', 'Alimentação', 'Diárias/hospedagem/viagens', 'Tributos e encargos', 'Outras despesas'];

const ExpenseForm: React.FC<ExpenseFormProps> = ({ onSave, onCancel }) => {
    const [formData, setFormData] = React.useState({
        data: new Date().toISOString().split('T')[0],
        categoria: 'Outra' as ExpenseCategory,
        fornecedor: '',
        documentoFornecedor: '',
        descricao: '',
        valor: '',
        tipoDocumento: 'Nota Fiscal' as Expense['tipoDocumento'],
        notaFiscalUrl: undefined as string | undefined,
        statusDocumento: 'Pendente' as Expense['statusDocumento'],
        canal: '',
        regiao: '',
        // Prestação de contas (TSE/SPCE)
        formaPagamento: 'Transferência bancária' as FormaPagamento,
        tipoGasto: 'Outras despesas' as TipoGastoTSE,
        dataPagamento: '',
    });
    const [fileName, setFileName] = React.useState('');

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const base64 = await fileToBase64(file);
                setFormData(prev => ({ ...prev, notaFiscalUrl: base64 }));
                setFileName(file.name);
            } catch (error) {
                console.error("Error converting file to base64", error);
                alert("Erro ao carregar o arquivo.");
            }
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            ...formData,
            valor: parseFloat(formData.valor.replace(',', '.')) || 0,
            // coluna date não aceita '' — manda undefined quando em branco.
            dataPagamento: formData.dataPagamento || undefined,
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="Data" type="date" name="data" value={formData.data} onChange={handleChange} required />
                <Input label="Valor (R$)" name="valor" value={formData.valor} onChange={handleChange} required placeholder="50.00" />
            </div>
            <div>
                <label htmlFor="categoria" className="block text-sm font-medium text-slate-300 mb-1">Categoria da Despesa</label>
                <select id="categoria" name="categoria" value={formData.categoria} onChange={handleChange} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                    {expenseCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="Fornecedor" name="fornecedor" value={formData.fornecedor} onChange={handleChange} required placeholder="Ex: Posto de Gasolina X" />
                <Input label="CPF/CNPJ do Fornecedor" name="documentoFornecedor" value={formData.documentoFornecedor} onChange={handleChange} required placeholder="00.000.000/0000-00" />
            </div>
            
            <Input label="Descrição" name="descricao" value={formData.descricao} onChange={handleChange} required placeholder="Ex: Abastecimento carro da equipe" />

            {/* Atribuição p/ ROI (custo por lead/voto) — alimenta a IA */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label htmlFor="canal" className="block text-sm font-medium text-slate-300 mb-1">Canal / Origem (p/ ROI)</label>
                    <select id="canal" name="canal" value={formData.canal} onChange={handleChange} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                        <option value="">— (sem atribuição)</option>
                        <option value="visita">Visita / Porta a porta</option>
                        <option value="evento">Evento</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="redes_sociais">Redes Sociais</option>
                        <option value="marketing_digital">Marketing Digital (ads)</option>
                        <option value="material_grafico">Material Gráfico</option>
                        <option value="radio_tv">Rádio / TV</option>
                        <option value="estrutura">Estrutura / Operação</option>
                        <option value="outro">Outro</option>
                    </select>
                </div>
                <Input label="Região / Bairro (opcional)" name="regiao" value={formData.regiao} onChange={handleChange} placeholder="Ex: Zona Norte" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label htmlFor="tipoDocumento" className="block text-sm font-medium text-slate-300 mb-1">Tipo de Comprovante</label>
                    <select id="tipoDocumento" name="tipoDocumento" value={formData.tipoDocumento} onChange={handleChange} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                        {documentTypes.map(type => <option key={type} value={type}>{type}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Nota Fiscal/Anexo (Opcional)</label>
                    <label htmlFor="receipt-upload" className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-slate-300 cursor-pointer flex items-center justify-between">
                        <span className="truncate">{fileName || 'Escolher arquivo...'}</span>
                        <input id="receipt-upload" type="file" className="hidden" onChange={handleFileChange} accept="image/*,.pdf" />
                    </label>
                </div>
            </div>


            {/* Prestação de contas (TSE/SPCE) — campos exigidos no SPCE */}
            <fieldset className="border border-slate-700 rounded-lg p-4 space-y-4">
                <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-indigo-300">Prestação de contas (TSE)</legend>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="tipoGasto" className="block text-sm font-medium text-slate-300 mb-1">Tipo de gasto (TSE)</label>
                        <select id="tipoGasto" name="tipoGasto" value={formData.tipoGasto} onChange={handleChange} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                            {tiposGasto.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="formaPagamento" className="block text-sm font-medium text-slate-300 mb-1">Forma de pagamento</label>
                        <select id="formaPagamento" name="formaPagamento" value={formData.formaPagamento} onChange={handleChange} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                            {formasPagamento.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                    </div>
                </div>
                <Input label="Data do pagamento (se diferente da data do fato)" type="date" name="dataPagamento" value={formData.dataPagamento} onChange={handleChange} />
            </fieldset>

            <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
                <Button type="submit">Adicionar Despesa</Button>
            </div>
        </form>
    );
};

export default ExpenseForm;
