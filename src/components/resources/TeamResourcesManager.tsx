import * as React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTeam } from '../../contexts/TeamContext';
import { TeamResource, ResourceType, ResourceStatus } from '../../types/resources';
import {
    fetchTeamResources,
    createTeamResource,
    updateTeamResource,
    deleteTeamResource,
} from '../../services/teamResourcesService';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';

const RESOURCE_TYPES: ResourceType[] = [
    'panfleto', 'camiseta', 'kit_rua', 'equipamento',
    'veiculo', 'celular', 'material_digital',
    'verba', 'combustivel', 'outro',
];

const STATUS_LIST: ResourceStatus[] = [
    'available', 'allocated', 'in_use', 'returned', 'lost', 'damaged', 'blocked',
];

const STATUS_LABELS: Record<ResourceStatus, string> = {
    available:  'Disponível',
    allocated:  'Alocado',
    in_use:     'Em uso',
    returned:   'Devolvido',
    lost:       'Perdido',
    damaged:    'Danificado',
    blocked:    'Bloqueado',
};

const TYPE_LABELS: Record<ResourceType, string> = {
    panfleto:        'Panfleto',
    camiseta:        'Camiseta',
    kit_rua:         'Kit de Rua',
    equipamento:     'Equipamento',
    veiculo:         'Veículo',
    celular:         'Celular',
    material_digital:'Material Digital',
    verba:           'Verba',
    combustivel:     'Combustível',
    outro:           'Outro',
};

const TeamResourcesManager: React.FC = () => {
    const { user } = useAuth();
    const { teamMembers } = useTeam();
    const [resources, setResources] = React.useState<TeamResource[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isModalOpen, setIsModalOpen] = React.useState(false);
    const [editing, setEditing] = React.useState<TeamResource | null>(null);

    const leaderNameById = React.useMemo(() => {
        const map = new Map<string, string>();
        teamMembers.filter(m => m.role === 'Líder').forEach(m => map.set(String(m.id), m.name));
        return map;
    }, [teamMembers]);

    const canManage =
        user?.type === 'Admin' ||
        user?.type === 'Coordenador' ||
        user?.type === 'Candidato';

    const reload = React.useCallback(async () => {
        if (!user?.campaignId) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        const data = await fetchTeamResources(user.campaignId);
        setResources(data);
        setIsLoading(false);
    }, [user?.campaignId]);

    React.useEffect(() => {
        reload();
    }, [reload]);

    const openAdd = () => {
        setEditing(null);
        setIsModalOpen(true);
    };

    const openEdit = (r: TeamResource) => {
        setEditing(r);
        setIsModalOpen(true);
    };

    const handleSave = async (
        form: Omit<TeamResource, 'id' | 'createdAt' | 'updatedAt'>
    ) => {
        if (editing) {
            await updateTeamResource(editing.id, form);
        } else {
            await createTeamResource({ ...form, createdBy: user?.uid });
        }
        setIsModalOpen(false);
        await reload();
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Tem certeza que deseja remover este recurso?')) return;
        await deleteTeamResource(id);
        await reload();
    };

    return (
        <Card className="bg-slate-800 p-4">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-slate-200">Recursos Materiais da Equipe</h2>
                {canManage && (
                    <Button onClick={openAdd}>+ Novo Recurso</Button>
                )}
            </div>

            {isLoading ? (
                <p className="text-slate-400 text-sm">Carregando...</p>
            ) : resources.length === 0 ? (
                <p className="text-slate-400 text-sm">Nenhum recurso cadastrado ainda.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-400 border-b border-slate-700">
                                <th className="py-2 pr-4">Nome</th>
                                <th className="py-2 pr-4">Tipo</th>
                                <th className="py-2 pr-4 text-right">Qtd</th>
                                <th className="py-2 pr-4">Status</th>
                                <th className="py-2 pr-4">Líder</th>
                                {canManage && <th className="py-2 text-right">Ações</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {resources.map(r => (
                                <tr key={r.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                                    <td className="py-2 pr-4 text-slate-200">{r.name}</td>
                                    <td className="py-2 pr-4 text-slate-400">{TYPE_LABELS[r.resourceType] || r.resourceType}</td>
                                    <td className="py-2 pr-4 text-right">{r.quantity}{r.unit ? ` ${r.unit}` : ''}</td>
                                    <td className="py-2 pr-4">
                                        <span className={
                                            r.status === 'available' ? 'text-emerald-400' :
                                            r.status === 'in_use'    ? 'text-indigo-400'  :
                                            r.status === 'lost' || r.status === 'damaged' ? 'text-red-400' :
                                            'text-slate-400'
                                        }>
                                            {STATUS_LABELS[r.status] || r.status}
                                        </span>
                                    </td>
                                    <td className="py-2 pr-4 text-slate-400 text-xs">
                                        {r.leaderId ? (leaderNameById.get(String(r.leaderId)) || 'Líder removido') : '—'}
                                    </td>
                                    {canManage && (
                                        <td className="py-2 text-right space-x-3">
                                            <button
                                                onClick={() => openEdit(r)}
                                                className="text-indigo-400 hover:text-indigo-300 text-xs"
                                            >
                                                Editar
                                            </button>
                                            <button
                                                onClick={() => handleDelete(r.id)}
                                                className="text-red-400 hover:text-red-300 text-xs"
                                            >
                                                Remover
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {isModalOpen && (
                <ResourceFormModal
                    initial={editing}
                    onSave={handleSave}
                    onClose={() => setIsModalOpen(false)}
                    campaignId={user?.campaignId || ''}
                />
            )}
        </Card>
    );
};

interface ResourceFormModalProps {
    initial: TeamResource | null;
    onSave: (form: Omit<TeamResource, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    onClose: () => void;
    campaignId: string;
}

const ResourceFormModal: React.FC<ResourceFormModalProps> = ({
    initial,
    onSave,
    onClose,
    campaignId,
}) => {
    const { teamMembers } = useTeam();
    const [name, setName]               = React.useState(initial?.name || '');
    const [resourceType, setResourceType] = React.useState<ResourceType>(initial?.resourceType || 'panfleto');
    // Quantidade como string pra placeholder funcionar (vazio em vez de "0").
    const [quantity, setQuantity]       = React.useState<string>(
        initial?.quantity != null ? String(initial.quantity) : ''
    );
    const [unit, setUnit]               = React.useState(initial?.unit || '');
    const [status, setStatus]           = React.useState<ResourceStatus>(initial?.status || 'available');
    const [description, setDescription] = React.useState(initial?.description || '');
    const [notes, setNotes]             = React.useState(initial?.notes || '');
    const [leaderId, setLeaderId]       = React.useState(initial?.leaderId || '');
    const [saving, setSaving]           = React.useState(false);

    const leaders = React.useMemo(
        () => teamMembers.filter(m => m.role === 'Líder'),
        [teamMembers]
    );

    const handleSubmit = async () => {
        if (!name.trim()) {
            alert('Nome é obrigatório');
            return;
        }
        setSaving(true);
        await onSave({
            campaignId,
            name: name.trim(),
            resourceType,
            quantity: Number(quantity) || 0,
            unit: unit.trim() || undefined,
            status,
            description: description.trim() || undefined,
            notes: notes.trim() || undefined,
            leaderId: leaderId.trim() || null,
        });
        setSaving(false);
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={initial ? 'Editar Recurso' : 'Novo Recurso'}
        >
            <div className="space-y-3">
                <Input
                    label="Nome *"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Ex: Camisetas azuis tamanho M"
                />

                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Tipo</label>
                    <select
                        value={resourceType}
                        onChange={e => setResourceType(e.target.value as ResourceType)}
                        className="w-full p-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500"
                    >
                        {RESOURCE_TYPES.map(t => (
                            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                        ))}
                    </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <Input
                        label="Quantidade"
                        type="number"
                        min="0"
                        value={quantity}
                        onChange={e => setQuantity(e.target.value)}
                        placeholder="Ex: 1000"
                    />
                    <Input
                        label="Unidade (opcional)"
                        value={unit}
                        onChange={e => setUnit(e.target.value)}
                        placeholder="Ex: un, kg, caixas"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Status</label>
                    <select
                        value={status}
                        onChange={e => setStatus(e.target.value as ResourceStatus)}
                        className="w-full p-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500"
                    >
                        {STATUS_LIST.map(s => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                    </select>
                </div>

                <Input
                    label="Descrição (opcional)"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                />

                <Input
                    label="Notas (opcional)"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                />

                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                        Líder responsável (opcional)
                    </label>
                    <select
                        value={leaderId}
                        onChange={e => setLeaderId(e.target.value)}
                        className="w-full p-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500"
                    >
                        <option value="">— Nenhum —</option>
                        {leaders.length === 0 ? (
                            <option value="" disabled>
                                Nenhum líder cadastrado em Equipes
                            </option>
                        ) : (
                            leaders.map(l => (
                                <option key={l.id} value={String(l.id)}>{l.name}</option>
                            ))
                        )}
                    </select>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" onClick={onClose}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSubmit} disabled={saving}>
                        {saving ? 'Salvando...' : initial ? 'Salvar' : 'Criar'}
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

export default TeamResourcesManager;
