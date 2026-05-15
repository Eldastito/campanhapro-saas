// TODO (Fase 2):
// - Tarefas por liderado (precisa tabela team_tasks)
// - Reuniões da equipe (precisa tabela team_meetings)
// - Bloqueios / pedidos de apoio
// - Custos por liderado (precisa permissão específica)
// - Filtros por bairro/cidade
// - Indicadores de votos planejados vs estimados

import * as React from 'react';
import Header from '../components/Header';
import Card from '../components/ui/Card';
import { ResourceType, ResourceStatus } from '../types/resources';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useVisits } from '../contexts/VisitsContext';
import { useSettings } from '../contexts/SettingsContext';
import { fetchTeamResources } from '../services/teamResourcesService';
import { TeamResource } from '../types/resources';
import ShareLocationButton from '../components/team/ShareLocationButton';

const TYPE_LABELS: Record<ResourceType, string> = {
    panfleto: 'Panfleto', camiseta: 'Camiseta', kit_rua: 'Kit de Rua',
    equipamento: 'Equipamento', veiculo: 'Veículo', celular: 'Celular',
    material_digital: 'Material Digital', verba: 'Verba',
    combustivel: 'Combustível', outro: 'Outro',
};

const STATUS_LABELS: Record<ResourceStatus, string> = {
    available: 'Disponível', allocated: 'Alocado', in_use: 'Em uso',
    returned: 'Devolvido', lost: 'Perdido', damaged: 'Danificado', blocked: 'Bloqueado',
};

const LeaderDashboardPage: React.FC = () => {
    const { user, logout } = useAuth();
    const { teamMembers } = useTeam();
    const { visits, engagementActions } = useVisits();
    const { headerLogo } = useSettings();
    const [resources, setResources] = React.useState<TeamResource[]>([]);
    const [resourcesLoading, setResourcesLoading] = React.useState(true);

    // teamMembers JÁ vem filtrado pelo TeamContext:
    // se user.type === 'Líder', filtra por assignedLeaderId === user.uid
    const myLideratos = teamMembers;

    // visits JÁ vem filtrado pelo VisitsContext:
    // se user.type === 'Líder', filtra por leaderId === user.uid
    const myTeamVisits = visits;

    // Engajamentos: filtro client-side (VisitsContext não filtra engagementActions por líder)
    const myTeamEngagements = React.useMemo(() => {
        const teamNames = new Set(myLideratos.map(m => m.name));
        return engagementActions.filter(e => teamNames.has(e.apoiador || ''));
    }, [engagementActions, myLideratos]);

    // Recursos materiais (RLS no banco já filtra pelo líder)
    React.useEffect(() => {
        if (!user?.campaignId) {
            setResourcesLoading(false);
            return;
        }
        let cancelled = false;
        const load = async () => {
            const data = await fetchTeamResources(user.campaignId!);
            if (!cancelled) {
                setResources(data);
                setResourcesLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [user?.campaignId]);

    // KPIs
    const lideradosAtivos = myLideratos.filter(m => m.role !== 'blocked').length;
    const totalVisitsRealizadas = myTeamVisits.filter(v => v.realizada === 'sim').length;
    const totalVisitsPendentes = myTeamVisits.filter(v => v.realizada === 'nao').length;
    const totalVotosEstimados = myTeamVisits
        .filter(v => v.realizada === 'sim')
        .reduce((acc, v) => acc + (v.votos || 0), 0);
    const recursosDisponiveis = resources.filter(r => r.status === 'available').length;

    // Produtividade por liderado
    const produtividade = React.useMemo(() => {
        return myLideratos.map(m => {
            const visitas = myTeamVisits.filter(v => v.apoiador === m.name);
            const realizadas = visitas.filter(v => v.realizada === 'sim').length;
            const pendentes = visitas.filter(v => v.realizada === 'nao').length;
            const engajamentos = myTeamEngagements.filter(e => e.apoiador === m.name).length;
            return {
                ...m,
                visitasRealizadas: realizadas,
                visitasPendentes: pendentes,
                engajamentos,
                total: realizadas + engajamentos,
            };
        }).sort((a, b) => b.total - a.total);
    }, [myLideratos, myTeamVisits, myTeamEngagements]);

    return (
        <div className="min-h-screen bg-slate-900 text-slate-200">
            <Header logoUrl={headerLogo} />

            <main className="max-w-7xl mx-auto p-6 space-y-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold">Painel do Líder</h1>
                        <p className="text-slate-400">Olá, {user?.name}. Gestão da sua equipe.</p>
                    </div>
                    <button
                        onClick={logout}
                        className="px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors"
                    >
                        Sair
                    </button>
                </div>

                <ShareLocationButton />

                {/* KPIs principais */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card className="bg-slate-800 p-4">
                        <p className="text-sm text-slate-400">Liderados</p>
                        <p className="text-3xl font-black">{myLideratos.length}</p>
                        <p className="text-xs text-slate-500">{lideradosAtivos} ativos</p>
                    </Card>
                    <Card className="bg-slate-800 p-4">
                        <p className="text-sm text-slate-400">Visitas Realizadas</p>
                        <p className="text-3xl font-black text-emerald-400">{totalVisitsRealizadas}</p>
                        <p className="text-xs text-slate-500">{totalVisitsPendentes} pendentes</p>
                    </Card>
                    <Card className="bg-slate-800 p-4">
                        <p className="text-sm text-slate-400">Votos Estimados</p>
                        <p className="text-3xl font-black text-indigo-400">{totalVotosEstimados}</p>
                    </Card>
                    <Card className="bg-slate-800 p-4">
                        <p className="text-sm text-slate-400">Engajamentos</p>
                        <p className="text-3xl font-black">{myTeamEngagements.length}</p>
                    </Card>
                </div>

                {/* KPIs secundários */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card className="bg-slate-800 p-4">
                        <p className="text-sm text-slate-400">Recursos Materiais</p>
                        <p className="text-2xl font-black text-amber-400">{resources.length}</p>
                        <p className="text-xs text-slate-500">{recursosDisponiveis} disponíveis</p>
                    </Card>
                </div>

                {/* Liderados com produtividade */}
                <Card className="bg-slate-800 p-4">
                    <h2 className="text-lg font-bold mb-4">Meus Liderados — Produtividade</h2>
                    {produtividade.length === 0 ? (
                        <p className="text-slate-400 text-sm">Nenhum liderado atribuído ainda.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-slate-400 border-b border-slate-700">
                                        <th className="py-2">Nome</th>
                                        <th className="py-2">Função</th>
                                        <th className="py-2">Telefone</th>
                                        <th className="py-2 text-right">Visitas ✓</th>
                                        <th className="py-2 text-right">Visitas ⏳</th>
                                        <th className="py-2 text-right">Engaj.</th>
                                        <th className="py-2 text-right">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {produtividade.map(m => (
                                        <tr key={m.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                                            <td className="py-2">{m.name}</td>
                                            <td className="py-2 text-slate-400">{m.role}</td>
                                            <td className="py-2 text-slate-400">{m.phone || '—'}</td>
                                            <td className="py-2 text-right text-emerald-400">{m.visitasRealizadas}</td>
                                            <td className="py-2 text-right text-amber-400">{m.visitasPendentes}</td>
                                            <td className="py-2 text-right">{m.engajamentos}</td>
                                            <td className="py-2 text-right font-bold">{m.total}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>

                {/* Recursos materiais */}
                <Card className="bg-slate-800 p-4">
                    <h2 className="text-lg font-bold mb-4">Recursos Materiais da Equipe</h2>
                    {resourcesLoading ? (
                        <p className="text-slate-400 text-sm">Carregando...</p>
                    ) : resources.length === 0 ? (
                        <p className="text-slate-400 text-sm">Nenhum recurso atribuído à sua equipe ainda.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-slate-400 border-b border-slate-700">
                                        <th className="py-2">Recurso</th>
                                        <th className="py-2">Tipo</th>
                                        <th className="py-2 text-right">Qtd</th>
                                        <th className="py-2">Status</th>
                                        <th className="py-2">Notas</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {resources.map(r => (
                                        <tr key={r.id} className="border-b border-slate-800">
                                            <td className="py-2">{r.name}</td>
                                            <td className="py-2 text-slate-400">{TYPE_LABELS[r.resourceType] || r.resourceType}</td>
                                            <td className="py-2 text-right">{r.quantity}{r.unit ? ` ${r.unit}` : ''}</td>
                                            <td className="py-2">
                                                <span className={
                                                    r.status === 'available' ? 'text-emerald-400' :
                                                    r.status === 'in_use' ? 'text-indigo-400' :
                                                    r.status === 'lost' || r.status === 'damaged' ? 'text-red-400' :
                                                    'text-slate-400'
                                                }>
                                                    {STATUS_LABELS[r.status] || r.status}
                                                </span>
                                            </td>
                                            <td className="py-2 text-slate-500 text-xs">{r.notes || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>
            </main>
        </div>
    );
};

export default LeaderDashboardPage;
