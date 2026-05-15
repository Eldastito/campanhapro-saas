import * as React from 'react';
import { EngagementAction, EngagementType, Sentiment } from '../../types/engagement';
import { useTeam } from '../../contexts/TeamContext';
import { useVisits } from '../../contexts/VisitsContext';
import { useAuth } from '../../contexts/AuthContext';
import Input from '../ui/Input';
import Button from '../ui/Button';

interface EngagementFormProps {
    onSave: (action: Omit<EngagementAction, 'id'>) => void;
    onCancel: () => void;
    initialData: Omit<EngagementAction, 'id'>;
}

const engagementTypes: EngagementType[] = ['Abordagem Rápida', 'Distribuição de Material', 'Evento'];
const sentiments: Sentiment[] = ['Positivo', 'Neutro', 'Negativo'];

const EngagementForm = ({ onSave, onCancel, initialData }: EngagementFormProps) => {
    const { user } = useAuth();
    const { teamMembers } = useTeam();
    const { visits } = useVisits();
    const [formData, setFormData] = React.useState(initialData);

    const supporters = React.useMemo(() => {
        console.log("[EngagementForm] Calculando apoiadores. Membros na equipe:", teamMembers.length);
        const fromTeam = teamMembers.filter(m => 
            m.role?.toLowerCase() === 'apoiador' || 
            m.role?.toLowerCase() === 'colaborador'
        ).map(m => m.name);
        const fromVisits = visits.map(v => v.apoiador).filter(Boolean) as string[];
        let combined = [...new Set([...fromTeam, ...fromVisits])].sort();
        
        // Fallback para o usuário logado se a lista estiver vazia
        if (combined.length === 0 && user?.name) {
            combined = [user.name];
        }
        
        console.log("[EngagementForm] Apoiadores encontrados:", combined.length);
        return combined;
    }, [teamMembers, visits, user?.name]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        const parsedValue = type === 'number' ? parseFloat(value) || 0 : value;
        setFormData(prev => ({ ...prev, [name]: parsedValue }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="Data" type="date" name="data" value={formData.data} onChange={handleChange} required />
                <div>
                    <label htmlFor="apoiador" className="block text-sm font-medium text-slate-300 mb-1">Apoiador Responsável</label>
                    <select id="apoiador" name="apoiador" value={formData.apoiador} onChange={handleChange} required className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                        {supporters.length === 0 ? (
                            <option value="" disabled>Nenhum apoiador cadastrado</option>
                        ) : (
                            <option value="" disabled>Selecione um apoiador</option>
                        )}
                        {supporters.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                </div>
            </div>
            <div>
                <label htmlFor="tipo" className="block text-sm font-medium text-slate-300 mb-1">Tipo de Ação</label>
                <select id="tipo" name="tipo" value={formData.tipo} onChange={handleChange} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                    {engagementTypes.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
            </div>

            {formData.tipo === 'Abordagem Rápida' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input label="Local da Abordagem" name="local" value={formData.local || ''} onChange={handleChange} />
                    <div>
                        <label htmlFor="sentimento" className="block text-sm font-medium text-slate-300 mb-1">Sentimento</label>
                        <select id="sentimento" name="sentimento" value={formData.sentimento || 'Neutro'} onChange={handleChange} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                            {sentiments.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                </div>
            )}
            {formData.tipo === 'Distribuição de Material' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input label="Local da Distribuição" name="local" value={formData.local || ''} onChange={handleChange} />
                    <Input label="Material Distribuído (Qtd)" type="number" name="materialDistribuido" value={formData.materialDistribuido || ''} onChange={handleChange} min="0" />
                </div>
            )}
            {formData.tipo === 'Evento' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input label="Nome do Evento" name="eventoNome" value={formData.eventoNome || ''} onChange={handleChange} />
                    <Input label="Pessoas Contatadas (Aprox.)" type="number" name="pessoasContatadas" value={formData.pessoasContatadas || ''} onChange={handleChange} min="0" />
                </div>
            )}

            <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
                <Button type="submit">Salvar Ação</Button>
            </div>
        </form>
    );
};

export default EngagementForm;