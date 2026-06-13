import * as React from 'react';
import { EngagementAction, EngagementType, Sentiment, IdentifiedPerson } from '../../types/engagement';
import { useTeam } from '../../contexts/TeamContext';
import { useVisits } from '../../contexts/VisitsContext';
import { useAuth } from '../../contexts/AuthContext';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { Plus, Trash2, UserPlus } from 'lucide-react';

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

            {/* Resultado / conversões geradas — alimenta o funil */}
            <div className="p-4 bg-blue-900/10 border border-blue-500/20 rounded-lg">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-3">Resultado da Ação (conversões)</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input label="Novos apoiadores (qtd)" type="number" name="novosApoiadores" value={formData.novosApoiadores ?? ''} onChange={handleChange} min="0" />
                    <Input label="Contatos coletados (qtd)" type="number" name="contatosColetados" value={formData.contatosColetados ?? ''} onChange={handleChange} min="0" />
                </div>
                <p className="text-[11px] text-blue-300/70 mt-2">Conta agregada da ação. Se quiser que essas pessoas virem CONTATOS no CRM (pra serem trabalhadas depois), preencha a seção abaixo.</p>
            </div>

            {/* Bridge engajamento→CRM (#53) — pessoas com nome viram contato real */}
            <IdentifiedPeopleSection
                items={formData.pessoasIdentificadas || []}
                onChange={(list) => setFormData(prev => ({ ...prev, pessoasIdentificadas: list }))}
            />

            <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
                <Button type="submit">Salvar Ação</Button>
            </div>
        </form>
    );
};

/**
 * Subseção opcional: lista de pessoas identificadas (nome + telefone + bairro).
 * Cada linha preenchida vira UM contato no CRM ao salvar a ação (#53).
 * Linhas sem nome são ignoradas — não criam contato fantasma.
 */
const IdentifiedPeopleSection: React.FC<{
    items: IdentifiedPerson[];
    onChange: (next: IdentifiedPerson[]) => void;
}> = ({ items, onChange }) => {
    const [open, setOpen] = React.useState(items.length > 0);

    const add = () => onChange([...items, { nome: '', phone: '', bairro: '', tipo: 'apoiador' }]);
    const upd = (i: number, patch: Partial<IdentifiedPerson>) =>
        onChange(items.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
    const del = (i: number) => onChange(items.filter((_, idx) => idx !== i));

    return (
        <div className="border border-emerald-500/20 bg-emerald-500/5 rounded-lg p-4">
            <button type="button" onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 text-left">
                <div className="flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-emerald-400" />
                    <p className="text-sm font-bold text-emerald-300">Cadastrar pessoas identificadas no CRM (opcional)</p>
                </div>
                <span className="text-[11px] text-emerald-400/80 font-bold shrink-0">
                    {items.filter(p => p.nome.trim()).length} pessoa(s) · {open ? 'recolher' : 'expandir'}
                </span>
            </button>

            {open && (
                <div className="mt-3 space-y-2">
                    {items.length === 0 && (
                        <p className="text-[11px] text-emerald-200/70">
                            Clique em <b>Adicionar pessoa</b> abaixo. Quem tiver nome preenchido vira um contato no CRM com a tag <code>engajamento</code>.
                        </p>
                    )}

                    {items.map((p, i) => (
                        <div key={i} className="grid grid-cols-12 gap-2 items-center bg-slate-900/60 border border-white/5 rounded-lg p-2">
                            <input value={p.nome} onChange={(e) => upd(i, { nome: e.target.value })} placeholder="Nome*"
                                className="col-span-12 sm:col-span-4 bg-slate-800 border border-white/10 rounded px-2 py-1.5 text-sm text-white placeholder:text-slate-500" />
                            <input value={p.phone || ''} onChange={(e) => upd(i, { phone: e.target.value })} placeholder="Telefone"
                                className="col-span-7 sm:col-span-3 bg-slate-800 border border-white/10 rounded px-2 py-1.5 text-sm text-white placeholder:text-slate-500" />
                            <input value={p.bairro || ''} onChange={(e) => upd(i, { bairro: e.target.value })} placeholder="Bairro"
                                className="col-span-12 sm:col-span-3 bg-slate-800 border border-white/10 rounded px-2 py-1.5 text-sm text-white placeholder:text-slate-500" />
                            <select value={p.tipo} onChange={(e) => upd(i, { tipo: e.target.value as 'apoiador' | 'indeciso' })}
                                className="col-span-3 sm:col-span-1 bg-slate-800 border border-white/10 rounded px-1.5 py-1.5 text-xs text-white">
                                <option value="apoiador">🟢</option>
                                <option value="indeciso">🟡</option>
                            </select>
                            <button type="button" onClick={() => del(i)} title="Remover linha"
                                className="col-span-2 sm:col-span-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 rounded p-1.5 flex items-center justify-center">
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ))}

                    <button type="button" onClick={add}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold py-2 rounded-lg flex items-center justify-center gap-2">
                        <Plus className="w-4 h-4" /> Adicionar pessoa
                    </button>
                </div>
            )}
        </div>
    );
};

export default EngagementForm;