import * as React from 'react';
import { RJ_MUNICIPALITIES } from '../../data/rj-locations';
import { useVisits } from '../../contexts/VisitsContext';
import { useTeam } from '../../contexts/TeamContext';
import { useAuth } from '../../contexts/AuthContext';
import { useProfilePermissions, CustomField } from '../../contexts/PermissionsContext';
import { Visit } from '../../types/visits';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Switch from '../ui/Switch';

interface VisitFormProps {
  onSave: (visit: Omit<Visit, 'id'> | Visit) => void;
  onCancel: () => void;
  initialData?: Visit | null;
}

const emptyVisit: Omit<Visit, 'id'> = {
  data: new Date().toISOString().split('T')[0],
  hora: '',
  resp: '',
  tel: '',
  nasc: '',
  municipio: '',
  bairro: '',
  apoiador: '',
  eleitores: 1,
  participantes: 1,
  votos: 0,
  pet: 'nao',
  tipoPet: '',
  criancas: 'nao',
  solicit: '',
  realizada: 'nao',
  lider: '',
  interesse: '',
  nivelEngajamento: 'baixo',
  observacoesQualitativas: '',
  // Funil / jornada (Fase B) — não são colunas de `visits`; viram o contato (voterId)
  voteIntention: '',
  voteCertainty: '',
  objection: '',
  isMultiplier: 'nao',
  influenceCount: 0,
  whatsappOptin: 'nao',
};

const VisitForm = ({ onSave, onCancel, initialData }: VisitFormProps) => {
    const { visits } = useVisits();
    const { locations, teamMembers } = useTeam();
    const { user } = useAuth();
    const { config } = useProfilePermissions();
    const [formData, setFormData] = React.useState(initialData || emptyVisit);

    // Unindo membros cadastrados com nomes que já aparecem nas visitas (fallback de resiliência)
    const leaders = React.useMemo(() => {
        console.log("[VisitForm] Calculando líderes. Membros na equipe:", teamMembers.length);
        const fromTeam = teamMembers.filter(m => m.role === 'Líder').map(m => m.name);
        const fromVisits = visits.map(v => v.lider).filter(Boolean) as string[];
        const combined = [...new Set([...fromTeam, ...fromVisits])].sort();
        console.log("[VisitForm] Líderes encontrados:", combined.length);
        return combined;
    }, [teamMembers, visits]);

    const supporters = React.useMemo(() => {
        console.log("[VisitForm] Calculando apoiadores. Membros na equipe:", teamMembers.length);
        const fromTeam = teamMembers.filter(m => m.role === 'Apoiador' || m.role === 'Colaborador').map(m => m.name);
        const fromVisits = visits.map(v => v.apoiador).filter(Boolean) as string[];
        let combined = [...new Set([...fromTeam, ...fromVisits])].sort();
        
        // Se a lista estiver vazia e o usuário logado for apoiador, adiciona ele como opção padrão
        if (combined.length === 0 && user?.name) {
            combined = [user.name];
        }
        
        console.log("[VisitForm] Apoiadores encontrados:", combined.length);
        return combined;
    }, [teamMembers, visits, user?.name]);

    // Base Global de Municípios do RJ
    const municipios = React.useMemo(() => {
        const list = RJ_MUNICIPALITIES.map(m => m.name).sort();
        console.log("[VisitForm] Municípios RJ carregados:", list.length);
        return list;
    }, []);
    
    // Bairros filtrados pelo município selecionado
    const filteredBairros = React.useMemo(() => {
        if (!formData.municipio) return [];
        
        const selectedMun = RJ_MUNICIPALITIES.find(m => m.name === formData.municipio);
        let neighborhoods: { id: string; name: string }[] = [];
        
        if (selectedMun) {
            neighborhoods = selectedMun.neighborhoods.map(n => ({ id: n, name: n }));
        } else {
            // Fallback para locations cadastradas se o município não estiver na base global
            neighborhoods = (locations || [])
                .filter(l => l.municipality === formData.municipio)
                .map(l => ({ id: String(l.id), name: l.name }));
        }
        
        console.log(`[VisitForm] Bairros para ${formData.municipio}:`, neighborhoods.length);
        return neighborhoods.sort((a, b) => a.name.localeCompare(b.name));
    }, [formData.municipio, locations]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        
        if (e.target.type === 'number') {
            const inputElement = e.target as HTMLInputElement;
            if (inputElement.min && parseFloat(value) < parseFloat(inputElement.min)) {
                setFormData(prev => ({ ...prev, [name]: parseFloat(inputElement.min) }));
            } else {
                setFormData(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
            }
        } else {
            setFormData(prev => {
                const newData = { ...prev, [name]: value };
                // Se mudar o município, limpa o bairro
                if (name === 'municipio') {
                    newData.bairro = '';
                }
                return newData;
            });
        }
    };
    
    const handleSwitchChange = (name: string, checked: boolean) => {
        setFormData(prev => ({ ...prev, [name]: checked ? 'sim' : 'nao' }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
    };

    const customFields: CustomField[] = config?.customFields?.visits || [];

    // Campos nativos ocultados pelo Supreme Admin para esta campanha (Form Builder).
    const hiddenV: string[] = ((config?.customFields as any)?._hidden?.visits) || [];
    const hideV = (k: string) => hiddenV.includes(k);

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Input label="Data da Visita" type="date" name="data" value={formData.data} onChange={handleChange} required />
                {!hideV('hora') && <Input label="Hora" type="time" name="hora" value={formData.hora || ''} onChange={handleChange} />}
                <Input label="Responsável (Família)" name="resp" value={formData.resp} onChange={handleChange} required />
            </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {!hideV('tel') && <Input label="Telefone" type="tel" name="tel" value={formData.tel} onChange={handleChange} />}
                {!hideV('nasc') && <Input label="Data de Nascimento (Resp.)" type="date" name="nasc" value={formData.nasc} onChange={handleChange} />}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label htmlFor="municipio" className="block text-sm font-medium text-slate-300 mb-1">Município</label>
                    <select id="municipio" name="municipio" value={formData.municipio} onChange={handleChange} required className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none">
                        <option value="" disabled>Selecione um município</option>
                        {municipios.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="bairro" className="block text-sm font-medium text-slate-300 mb-1">Bairro</label>
                    <select id="bairro" name="bairro" value={formData.bairro} onChange={handleChange} required className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none">
                        <option value="" disabled>Selecione um bairro</option>
                        {filteredBairros.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                    </select>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label htmlFor="apoiador" className="block text-sm font-medium text-slate-300 mb-1">Apoiador Responsável</label>
                    <select id="apoiador" name="apoiador" value={formData.apoiador} onChange={handleChange} required className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none">
                        <option value="" disabled>Selecione um apoiador</option>
                        {supporters.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                </div>
                {!hideV('lider') && (
                <div>
                    <label htmlFor="lider" className="block text-sm font-medium text-slate-300 mb-1">Líder de Equipe (Opcional)</label>
                    <select id="lider" name="lider" value={formData.lider} onChange={handleChange} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none">
                        <option value="">Nenhum</option>
                        {leaders.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                </div>
                )}
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Input label="Eleitores na casa" type="number" name="eleitores" value={formData.eleitores} onChange={handleChange} min="1" />
                <Input label="Participantes" type="number" name="participantes" value={formData.participantes} onChange={handleChange} min="1" />
                <Input label="Estimativa de Votos" type="number" name="votos" value={formData.votos} onChange={handleChange} min="0"/>
            </div>

            {/* Custom Fields Implementation */}
            {customFields.length > 0 && (
                <div className="p-4 bg-indigo-900/10 border border-indigo-500/20 rounded-lg space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Campos Adicionais da Campanha</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {customFields.map((field) => (
                            <div key={field.id}>
                                {field.type === 'boolean' ? (
                                    <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                                        <label className="text-sm font-medium text-slate-300">{field.label}</label>
                                        <Switch 
                                            checked={formData[field.id] === 'sim'} 
                                            onChange={(c) => handleSwitchChange(field.id, c)} 
                                        />
                                    </div>
                                ) : field.type === 'select' ? (
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-1">{field.label}</label>
                                        <select 
                                            name={field.id}
                                            value={formData[field.id] || ''} 
                                            onChange={handleChange}
                                            required={field.required}
                                            className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none"
                                        >
                                            <option value="">Selecione...</option>
                                            {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                        </select>
                                    </div>
                                ) : (
                                    <Input 
                                        label={field.label}
                                        type={field.type}
                                        name={field.id}
                                        value={formData[field.id] || ''}
                                        onChange={handleChange}
                                        required={field.required}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!hideV('petKids') && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                 <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-slate-300">Tem Crianças?</label>
                    <Switch checked={formData.criancas === 'sim'} onChange={(c) => handleSwitchChange('criancas', c)} />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-slate-300">Tem Pet?</label>
                    <Switch checked={formData.pet === 'sim'} onChange={(c) => handleSwitchChange('pet', c)} />
                </div>
                {formData.pet === 'sim' && <Input label="Qual Pet?" name="tipoPet" value={formData.tipoPet} onChange={handleChange} />}
            </div>
            )}
            {!hideV('solicit') && (
             <div>
                <label htmlFor="solicit" className="block text-sm font-medium text-slate-300 mb-1">Solicitações / Observações</label>
                <textarea id="solicit" name="solicit" value={formData.solicit} onChange={handleChange} rows={2} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none"></textarea>
            </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {!hideV('interesse') && <Input label="Interesse Principal" name="interesse" value={formData.interesse || ''} onChange={handleChange} />}
                {!hideV('nivelEngajamento') && (
                <div>
                    <label htmlFor="nivelEngajamento" className="block text-sm font-medium text-slate-300 mb-1">Nível de Engajamento</label>
                    <select id="nivelEngajamento" name="nivelEngajamento" value={formData.nivelEngajamento || 'baixo'} onChange={handleChange} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none">
                        <option value="baixo">Baixo</option>
                        <option value="medio">Médio</option>
                        <option value="alto">Alto</option>
                    </select>
                </div>
                )}
            </div>
            {!hideV('observacoesQualitativas') && (
            <div>
                <label htmlFor="observacoesQualitativas" className="block text-sm font-medium text-slate-300 mb-1">Observações Qualitativas (para IA)</label>
                <textarea id="observacoesQualitativas" name="observacoesQualitativas" value={formData.observacoesQualitativas || ''} onChange={handleChange} rows={2} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none"></textarea>
            </div>
            )}

            {/* ===== Conversão de voto (alimenta a IA e o contato) ===== */}
            {!hideV('conversao') && (
            <div className="p-4 bg-blue-900/10 border border-blue-500/20 rounded-lg space-y-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-400">Conversão de Voto (alimenta a IA)</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">Intenção de voto</label>
                        <select name="voteIntention" value={formData.voteIntention || ''} onChange={handleChange} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none">
                            <option value="">—</option>
                            <option value="apoia">Já apoia</option>
                            <option value="vai_votar">Vai votar</option>
                            <option value="indeciso">Indeciso</option>
                            <option value="rejeita">Rejeita</option>
                            <option value="nao_disse">Não disse</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">Certeza do voto (0–10)</label>
                        <select name="voteCertainty" value={formData.voteCertainty ?? ''} onChange={handleChange} className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none">
                            <option value="">—</option>
                            {Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                        </select>
                    </div>
                </div>
                {(formData.voteIntention === 'indeciso' || formData.voteIntention === 'rejeita') && (
                    <Input label="Objeção / barreira" name="objection" value={formData.objection || ''} onChange={handleChange} />
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-slate-300">É multiplicador?</label>
                        <Switch checked={formData.isMultiplier === 'sim'} onChange={(c) => handleSwitchChange('isMultiplier', c)} />
                    </div>
                    {formData.isMultiplier === 'sim' && (
                        <Input label="Influencia ~ (pessoas)" type="number" name="influenceCount" value={formData.influenceCount || 0} onChange={handleChange} min="0" />
                    )}
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-slate-300">Autoriza WhatsApp?</label>
                        <Switch checked={formData.whatsappOptin === 'sim'} onChange={(c) => handleSwitchChange('whatsappOptin', c)} />
                    </div>
                </div>
                <p className="text-[10px] text-slate-500">Esses dados criam/atualizam o contato do eleitor (registro mestre da jornada).</p>
            </div>
            )}

            <div className="bg-slate-700/30 p-4 rounded-lg border border-slate-600 mb-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="text-sm font-bold text-slate-200">Status da Visita</h4>
                        <p className="text-[10px] text-slate-400">Marque apenas se a visita já ocorreu.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className={`text-[10px] font-black uppercase ${formData.realizada === 'sim' ? 'text-green-400' : 'text-orange-400'}`}>
                            {formData.realizada === 'sim' ? 'Realizada' : 'Pendente'}
                        </span>
                        <Switch checked={formData.realizada === 'sim'} onChange={(c) => handleSwitchChange('realizada', c)} />
                    </div>
                </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
                <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
                <Button type="submit" className={formData.realizada === 'sim' ? 'bg-[#1abc9c] hover:bg-[#16a085]' : 'bg-[#4ac7f0] hover:bg-[#35b0da]'}>
                    {formData.realizada === 'sim' ? 'Salvar Visita Realizada' : 'Confirmar Agendamento'}
                </Button>
            </div>
        </form>
    );
};

export default VisitForm;
