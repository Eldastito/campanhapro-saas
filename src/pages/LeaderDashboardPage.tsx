// TODO (Fase 2):
// - Tarefas por liderado (precisa tabela team_tasks)
// - Reuniões da equipe (precisa tabela team_meetings)
// - Bloqueios / pedidos de apoio
// - Custos por liderado (precisa permissão específica)
// - Filtros por bairro/cidade
// - Indicadores de votos planejados vs estimados

import * as React from 'react';
import { UserPlus, MessageCircle, Loader2, Pencil, KeyRound, Trash2, ListChecks, Plus, AlertTriangle, Trophy, Activity } from 'lucide-react';
import { useTeamTasks, TASK_STATUS_LABEL, TeamTask } from '../hooks/useTeamTasks';
import Header from '../components/Header';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import { ResourceType, ResourceStatus } from '../types/resources';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useVisits } from '../contexts/VisitsContext';
import { useSettings } from '../contexts/SettingsContext';
import { fetchTeamResources } from '../services/teamResourcesService';
import { TeamResource } from '../types/resources';
import ShareLocationButton from '../components/team/ShareLocationButton';
import TeamLiveMap from '../components/team/TeamLiveMap';
import FiscalRequestsPanel from '../components/team/FiscalRequestsPanel';

/** Monta link wa.me a partir de um telefone BR (best-effort). */
const waLink = (phone?: string) => {
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) return null;
    const withDdi = digits.length <= 11 ? `55${digits}` : digits;
    return `https://wa.me/${withDdi}`;
};

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
    const { teamMembers, addTeamMember, updateTeamMember, resetMemberPassword, removeMemberAccess } = useTeam();
    const { tasks, createTask, setStatus: setTaskStatus, removeTask } = useTeamTasks();
    const { visits, engagementActions } = useVisits();
    const { headerLogo } = useSettings();
    const [resources, setResources] = React.useState<TeamResource[]>([]);
    const [resourcesLoading, setResourcesLoading] = React.useState(true);

    // Cadastro / edição de liderado (vincula automaticamente via assignedLeaderId).
    const [showAdd, setShowAdd] = React.useState(false);
    const [editingId, setEditingId] = React.useState<string | number | null>(null);
    const [saving, setSaving] = React.useState(false);
    const [formErr, setFormErr] = React.useState<string | null>(null);
    const emptyForm = { name: '', email: '', phone: '', password: '', role: 'Apoiador' as string, visitsTarget: 0, votesTarget: 0 };
    const [form, setForm] = React.useState(emptyForm);

    const openAddModal = () => { setEditingId(null); setForm(emptyForm); setFormErr(null); setShowAdd(true); };
    const openEditModal = (m: any) => {
        setEditingId(m.id);
        setForm({ name: m.name || '', email: m.email || '', phone: m.phone || '', password: '', role: m.role || 'Apoiador', visitsTarget: m.visitsTarget || 0, votesTarget: m.votesTarget || 0 });
        setFormErr(null);
        setShowAdd(true);
    };

    const handleSaveLiderado = async () => {
        setFormErr(null);
        if (!form.name.trim()) { setFormErr('Informe o nome.'); return; }
        setSaving(true);
        try {
            if (editingId) {
                await updateTeamMember({
                    id: editingId,
                    name: form.name.trim(),
                    phone: form.phone.trim(),
                    role: form.role,
                    visitsTarget: Number(form.visitsTarget) || 0,
                    votesTarget: Number(form.votesTarget) || 0,
                } as any);
            } else {
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setFormErr('E-mail inválido.'); setSaving(false); return; }
                if (form.password.length < 6) { setFormErr('A senha precisa ter ao menos 6 caracteres.'); setSaving(false); return; }
                await addTeamMember({
                    name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(),
                    password: form.password, role: form.role, cost: 0,
                    visitsTarget: Number(form.visitsTarget) || 0, votesTarget: Number(form.votesTarget) || 0,
                } as any);
            }
            setShowAdd(false);
            setForm(emptyForm);
            setEditingId(null);
        } catch (e: any) {
            setFormErr(e?.message || 'Não foi possível salvar o liderado.');
        } finally {
            setSaving(false);
        }
    };

    const handleResetPwd = async (m: any) => {
        if (!m.userId) { alert('Este liderado ainda não tem login vinculado. Edite e recadastre com e-mail/senha.'); return; }
        const pwd = prompt(`Nova senha para ${m.name} (mín. 6 caracteres):`);
        if (!pwd) return;
        try {
            await resetMemberPassword(m.userId, pwd);
            alert('Senha redefinida com sucesso.');
        } catch (e: any) {
            alert(e?.message || 'Falha ao redefinir a senha.');
        }
    };

    const handleRemove = async (m: any) => {
        if (!confirm(`Remover ${m.name} da sua equipe? O acesso dele à plataforma também será removido.`)) return;
        try {
            await removeMemberAccess(m);
        } catch (e: any) {
            alert(e?.message || 'Falha ao remover o liderado.');
        }
    };

    // ── Tarefas / roteiros ──────────────────────────────────────────────
    const [newTask, setNewTask] = React.useState({ assignedToUserId: '', title: '', bairro: '', dueDate: '' });
    const [creatingTask, setCreatingTask] = React.useState(false);
    const lideratosComLogin = (teamMembers as any[]).filter(m => m.userId);

    const handleCreateTask = async () => {
        if (!newTask.assignedToUserId) { alert('Selecione o liderado responsável pela tarefa.'); return; }
        if (!newTask.title.trim()) { alert('Descreva a tarefa.'); return; }
        const alvo = lideratosComLogin.find(m => m.userId === newTask.assignedToUserId);
        if (!alvo) { alert('Liderado inválido. Selecione um membro da equipe.'); return; }
        setCreatingTask(true);
        try {
            await createTask({
                title: newTask.title.trim(),
                bairro: newTask.bairro.trim() || undefined,
                dueDate: newTask.dueDate || null,
                assignedToUserId: newTask.assignedToUserId || null,
                assignedToName: alvo?.name || null,
            });
            setNewTask({ assignedToUserId: '', title: '', bairro: '', dueDate: '' });
        } catch (e: any) {
            alert(e?.message || 'Falha ao criar a tarefa.');
        } finally {
            setCreatingTask(false);
        }
    };

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

    // Acompanhamento: inatividade + produção da semana (últimos 7 dias).
    const diasDesde = (d?: string | null) => d ? Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000) : null;
    const acompanhamento = React.useMemo(() => {
        return myLideratos.map((m: any) => {
            const realizadas = myTeamVisits.filter(v => v.apoiador === m.name && v.realizada === 'sim');
            const datas = realizadas.map(v => v.data).filter(Boolean).sort();
            const ultima = datas.length ? datas[datas.length - 1] : null;
            const visSemana = realizadas.filter(v => { const d = diasDesde(v.data); return d !== null && d <= 7; }).length;
            const engSemana = myTeamEngagements.filter(e => e.apoiador === m.name && (() => { const d = diasDesde(e.data); return d !== null && d <= 7; })()).length;
            return { ...m, ultimaVisita: ultima, diasInativo: diasDesde(ultima), semana: visSemana + engSemana };
        });
    }, [myLideratos, myTeamVisits, myTeamEngagements]);

    const INATIVO_DIAS = 5;
    const inativos = acompanhamento.filter((m: any) => m.diasInativo === null || m.diasInativo > INATIVO_DIAS);
    const ranking = [...acompanhamento].filter((m: any) => m.semana > 0).sort((a: any, b: any) => b.semana - a.semana).slice(0, 5);

    // Feed de atividade da equipe (visitas + ações + tarefas concluídas) em tempo real.
    const timeAgo = (ts?: string | null) => {
        if (!ts) return '';
        const min = (Date.now() - new Date(ts).getTime()) / 60000;
        if (min < 1) return 'agora';
        if (min < 60) return `${Math.round(min)} min`;
        if (min < 1440) return `${Math.round(min / 60)} h`;
        return `${Math.round(min / 1440)} d`;
    };
    const feed = React.useMemo(() => {
        const items: { ts: string; kind: 'visit' | 'eng' | 'task'; who: string; text: string }[] = [];
        myTeamVisits.forEach((v: any) => items.push({
            ts: v.createdAt || v.data, kind: 'visit', who: v.apoiador || 'Membro',
            text: `${v.realizada === 'sim' ? 'realizou' : 'agendou'} visita${v.bairro ? ` em ${v.bairro}` : ''}`,
        }));
        myTeamEngagements.forEach((e: any) => items.push({
            ts: e.createdAt || e.data, kind: 'eng', who: e.apoiador || 'Membro', text: `ação: ${e.tipo || 'engajamento'}`,
        }));
        tasks.filter((t: any) => t.status === 'concluida').forEach((t: any) => items.push({
            ts: t.createdAt, kind: 'task', who: t.assignedToName || 'Membro', text: `concluiu: ${t.title}`,
        }));
        return items.filter(i => i.ts).sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, 15);
    }, [myTeamVisits, myTeamEngagements, tasks]);

    return (
        <div className="min-h-screen bg-slate-900 text-slate-200">
            <Header logoUrl={headerLogo} />

            <main className="max-w-7xl mx-auto p-6 space-y-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold">Painel do Líder</h1>
                        <p className="text-slate-400">Olá, {user?.name}. Gestão da sua equipe.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <Button onClick={openAddModal} className="flex items-center gap-2">
                            <UserPlus className="w-4 h-4" /> Cadastrar Liderado
                        </Button>
                        <button
                            onClick={logout}
                            className="px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors"
                        >
                            Sair
                        </button>
                    </div>
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

                {/* Acompanhamento: inatividade + ranking da semana */}
                {acompanhamento.length > 0 && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card className="bg-slate-800 p-4">
                            <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-amber-400" /> Alertas de Inatividade
                                <span className="text-xs font-normal text-slate-500">(sem visita há +{INATIVO_DIAS} dias)</span>
                            </h2>
                            {inativos.length === 0 ? (
                                <p className="text-emerald-400/80 text-sm">Equipe toda ativa nos últimos {INATIVO_DIAS} dias. 🎉</p>
                            ) : (
                                <ul className="space-y-2">
                                    {inativos.map((m: any) => {
                                        const wa = waLink(m.phone);
                                        return (
                                        <li key={m.id} className="flex items-center justify-between gap-3 bg-rose-500/5 border border-rose-500/20 rounded-lg p-3">
                                            <div>
                                                <p className="font-semibold">{m.name}</p>
                                                <p className="text-xs text-amber-400">{m.diasInativo === null ? 'Nunca registrou visita' : `Há ${m.diasInativo} dias sem visita`}</p>
                                            </div>
                                            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 text-xs shrink-0"><MessageCircle className="w-4 h-4" /> Cobrar</a>}
                                        </li>
                                    );})}
                                </ul>
                            )}
                        </Card>

                        <Card className="bg-slate-800 p-4">
                            <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><Trophy className="w-5 h-5 text-yellow-400" /> Ranking da Semana</h2>
                            {ranking.length === 0 ? (
                                <p className="text-slate-400 text-sm">Sem produção registrada nos últimos 7 dias ainda.</p>
                            ) : (
                                <ol className="space-y-2">
                                    {ranking.map((m: any, i: number) => (
                                        <li key={m.id} className="flex items-center justify-between gap-3 bg-slate-900/50 rounded-lg p-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <span className={`text-lg font-black w-6 text-center ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-slate-500'}`}>{i + 1}º</span>
                                                <span className="font-semibold truncate">{m.name}</span>
                                            </div>
                                            <span className="text-sm font-bold text-emerald-400 shrink-0">{m.semana} ações</span>
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </Card>
                    </div>
                )}

                {/* Autorização de fiscais de zona */}
                <FiscalRequestsPanel />

                {/* Feed de atividade da equipe (ao vivo) */}
                {feed.length > 0 && (
                    <Card className="bg-slate-800 p-4">
                        <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><Activity className="w-5 h-5 text-sky-400" /> Atividade da Equipe (ao vivo)</h2>
                        <ul className="space-y-1.5">
                            {feed.map((it, i) => (
                                <li key={i} className="flex items-center gap-3 text-sm py-1.5 border-b border-slate-800 last:border-0">
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${it.kind === 'visit' ? 'bg-emerald-400' : it.kind === 'eng' ? 'bg-indigo-400' : 'bg-yellow-400'}`} />
                                    <span className="flex-1 min-w-0 truncate"><strong className="text-slate-200">{it.who}</strong> <span className="text-slate-400">{it.text}</span></span>
                                    <span className="text-[11px] text-slate-500 shrink-0">{timeAgo(it.ts)}</span>
                                </li>
                            ))}
                        </ul>
                    </Card>
                )}

                {/* Mapa ao vivo da equipe */}
                <TeamLiveMap />

                {/* Liderados com produtividade */}
                <Card className="bg-slate-800 p-4">
                    <h2 className="text-lg font-bold mb-4">Meus Liderados — Produtividade</h2>
                    {produtividade.length === 0 ? (
                        <div className="text-center py-8">
                            <p className="text-slate-400 text-sm mb-3">Você ainda não tem liderados. Cadastre sua equipe para começar a acompanhar a produção.</p>
                            <Button onClick={openAddModal} className="inline-flex items-center gap-2">
                                <UserPlus className="w-4 h-4" /> Cadastrar meu primeiro liderado
                            </Button>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-slate-400 border-b border-slate-700">
                                        <th className="py-2">Nome</th>
                                        <th className="py-2">Função</th>
                                        <th className="py-2 text-right">Visitas ✓</th>
                                        <th className="py-2 text-right">Engaj.</th>
                                        <th className="py-2 w-40">Meta de visitas</th>
                                        <th className="py-2 text-center">Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {produtividade.map((m: any) => {
                                        const wa = waLink(m.phone);
                                        const meta = m.visitsTarget || 0;
                                        const pct = meta > 0 ? Math.min(100, Math.round((m.visitasRealizadas / meta) * 100)) : 0;
                                        return (
                                        <tr key={m.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                                            <td className="py-2">{m.name}</td>
                                            <td className="py-2 text-slate-400">{m.role}</td>
                                            <td className="py-2 text-right text-emerald-400">{m.visitasRealizadas}<span className="text-slate-600"> / {m.visitasPendentes}⏳</span></td>
                                            <td className="py-2 text-right">{m.engajamentos}</td>
                                            <td className="py-2">
                                                {meta > 0 ? (
                                                    <div>
                                                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                                                            <div className={`h-full ${pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-indigo-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
                                                        </div>
                                                        <p className="text-[10px] text-slate-500 mt-0.5">{m.visitasRealizadas}/{meta} ({pct}%)</p>
                                                    </div>
                                                ) : <span className="text-[10px] text-slate-600">sem meta</span>}
                                            </td>
                                            <td className="py-2">
                                                <div className="flex items-center justify-center gap-2">
                                                    {wa && <a href={wa} target="_blank" rel="noopener noreferrer" title="WhatsApp" className="text-emerald-400 hover:text-emerald-300"><MessageCircle className="w-4 h-4" /></a>}
                                                    <button onClick={() => openEditModal(m)} title="Editar / definir meta" className="text-indigo-400 hover:text-indigo-300"><Pencil className="w-4 h-4" /></button>
                                                    <button onClick={() => handleResetPwd(m)} title="Resetar senha" className="text-amber-400 hover:text-amber-300"><KeyRound className="w-4 h-4" /></button>
                                                    <button onClick={() => handleRemove(m)} title="Remover" className="text-rose-400 hover:text-rose-300"><Trash2 className="w-4 h-4" /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    );})}
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

                {/* Tarefas & roteiros */}
                <Card className="bg-slate-800 p-4">
                    <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><ListChecks className="w-5 h-5 text-indigo-400" /> Tarefas & Roteiros da Equipe</h2>

                    {/* Criar tarefa */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2 mb-4 bg-slate-900/50 p-3 rounded-lg">
                        <select value={newTask.assignedToUserId} onChange={(e) => setNewTask({ ...newTask, assignedToUserId: e.target.value })}
                                className="md:col-span-3 bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-sm">
                            <option value="">Responsável (obrigatório)…</option>
                            {lideratosComLogin.map((m: any) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                        </select>
                        <input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                               placeholder="Tarefa (ex.: visitar quadra 12)" className="md:col-span-4 bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-sm" />
                        <input value={newTask.bairro} onChange={(e) => setNewTask({ ...newTask, bairro: e.target.value })}
                               placeholder="Bairro/área" className="md:col-span-2 bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-sm" />
                        <input type="date" value={newTask.dueDate} onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                               className="md:col-span-2 bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-sm text-slate-300" />
                        <Button onClick={handleCreateTask} disabled={creatingTask} className="md:col-span-1 flex items-center justify-center">
                            {creatingTask ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        </Button>
                    </div>

                    {tasks.length === 0 ? (
                        <p className="text-slate-400 text-sm">Nenhuma tarefa criada. Designe roteiros para sua equipe acima.</p>
                    ) : (
                        <div className="space-y-2">
                            {tasks.map((t: TeamTask) => (
                                <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/50 p-3 rounded-lg border border-white/5">
                                    <div className="min-w-0">
                                        <p className={`font-semibold ${t.status === 'concluida' ? 'line-through text-slate-500' : ''}`}>{t.title}</p>
                                        <p className="text-xs text-slate-400">
                                            {t.assignedToName || 'Equipe'}{t.bairro ? ` · ${t.bairro}` : ''}{t.dueDate ? ` · até ${new Date(t.dueDate + 'T00:00:00').toLocaleDateString('pt-BR')}` : ''}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <select value={t.status} onChange={(e) => setTaskStatus(t.id, e.target.value as TeamTask['status'])}
                                                className={`text-xs rounded-md py-1 px-2 border bg-slate-700 border-slate-600 ${t.status === 'concluida' ? 'text-emerald-400' : t.status === 'cancelada' ? 'text-rose-400' : t.status === 'em_andamento' ? 'text-indigo-400' : 'text-amber-400'}`}>
                                            {Object.entries(TASK_STATUS_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                                        </select>
                                        <button onClick={() => removeTask(t.id)} title="Excluir" className="text-rose-400 hover:text-rose-300"><Trash2 className="w-4 h-4" /></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </main>

            {showAdd && (
                <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title={editingId ? 'Editar Liderado' : 'Cadastrar Liderado'}>
                    <div className="space-y-4">
                        <p className="text-xs text-slate-400">
                            {editingId
                                ? 'Atualize os dados e defina a meta. Para trocar a senha, use o botão de chave na lista.'
                                : 'O liderado é vinculado automaticamente a você. Ele entra na plataforma com o e-mail e a senha definidos aqui.'}
                        </p>
                        <Input label="Nome completo *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {!editingId && <Input label="E-mail (login) *" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
                            <Input label="Telefone / WhatsApp" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                            {!editingId && <Input label="Senha (mín. 6) *" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1">Função</label>
                                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                                        className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                                    <option value="Apoiador">Apoiador</option>
                                    <option value="Colaborador">Colaborador</option>
                                    <option value="Pesquisador">Pesquisador</option>
                                    <option value="Fiscal">Fiscal de Zona</option>
                                </select>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-700">
                            <Input label="Meta de visitas" type="number" value={String(form.visitsTarget)} onChange={(e) => setForm({ ...form, visitsTarget: Number(e.target.value) })} />
                            <Input label="Meta de votos" type="number" value={String(form.votesTarget)} onChange={(e) => setForm({ ...form, votesTarget: Number(e.target.value) })} />
                        </div>
                        {formErr && <p className="text-sm bg-red-500/10 text-red-400 rounded-lg p-3">{formErr}</p>}
                        <div className="flex justify-end gap-3 pt-2">
                            <Button variant="secondary" onClick={() => setShowAdd(false)} disabled={saving}>Cancelar</Button>
                            <Button onClick={handleSaveLiderado} disabled={saving} className="flex items-center gap-2">
                                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando…</> : <><UserPlus className="w-4 h-4" /> {editingId ? 'Salvar' : 'Cadastrar'}</>}
                            </Button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
};

export default LeaderDashboardPage;
