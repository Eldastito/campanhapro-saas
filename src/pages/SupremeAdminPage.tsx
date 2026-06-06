import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { AuthenticatedUser, Plan } from '../types/user';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import { syncPlanForCampaign, getPlanConfig } from '../utils/planUtils';
import { 
    Users, ShieldAlert, Ban, CheckCircle, Globe, 
    Settings, Plus, Search, Lock, Unlock,
    Layout, Cpu, AlertTriangle, Trash2, Mail,
    CreditCard, Layers, TrendingUp as TrendingIcon,
    Activity, Filter, Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
    AreaChart, Area, Cell
} from 'recharts';

interface CampaignConfig {
    id: string;
    features: string[];
    limits: {
        aiCalls: number;
        teamMembers: number;
        visits: number;
    };
    customFields: Record<string, CustomField[]>;
    status: 'active' | 'blocked';
}

interface AIUsageRecord {
    id: string;
    campaignId: string;
    userId: string;
    model: string;
    totalTokens: number;
    estimatedCost: number;
    timestamp: any;
}

interface CustomField {
    id: string;
    label: string;
    type: 'text' | 'number' | 'select' | 'boolean';
    options?: string[];
    required: boolean;
}

const SUPREME_API = '/api/v1/supreme';

/**
 * Calls a Supreme Admin backend endpoint with the operator's JWT.
 * These actions run server-side with the service_role key (create users
 * without hijacking the session, set passwords, ban accounts), so they
 * MUST go through the API — not the browser Supabase client.
 */
async function supremeFetch(path: string, init?: RequestInit): Promise<any> {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPREME_API}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            ...(init?.headers ?? {}),
        },
    });
    if (res.status === 204) return null;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(body?.detail || body?.error || `request_failed_${res.status}`);
    }
    return body;
}

const SupremeAdminPage: React.FC = () => {
    const { user, logout, sendPasswordReset } = useAuth();
    const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'users' | 'platform' | 'financial'>('overview');
    
    // Campaigns Data
    const [campaigns, setCampaigns] = useState<AuthenticatedUser[]>([]);
    const [campaignConfigs, setCampaignConfigs] = useState<Record<string, CampaignConfig>>({});
    
    // Global Users Data
    const [globalUsers, setGlobalUsers] = useState<AuthenticatedUser[]>([]);
    const [userSearch, setUserSearch] = useState('');
    const [userFilter, setUserFilter] = useState<'all' | 'Admin' | 'Líder' | 'Apoiador' | 'Colaborador' | 'Pesquisador' | 'Suporte' | 'Manutenção'>('all');
    
    // AI Usage Data
    const [aiUsageData, setAiUsageData] = useState<AIUsageRecord[]>([]);
    const [usageStats, setUsageStats] = useState({ totalTokens: 0, totalCost: 0 });

    // Platform metrics (F1) — real aggregates from supreme_platform_metrics()
    const [metrics, setMetrics] = useState<any | null>(null);
    
    // UI State
    const [isLoading, setIsLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showCreateUserModal, setShowCreateUserModal] = useState(false);
    const [showConfigModal, setShowConfigModal] = useState<string | null>(null);
    const [passwordModal, setPasswordModal] = useState<{ isOpen: boolean; email: string }>({ isOpen: false, email: '' });
    const [manualPassword, setManualPassword] = useState('');
    const [isManagingPassword, setIsManagingPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    // Form Creation State
    const [newCampaign, setNewCampaign] = useState({
        name: '',
        email: '',
        password: '',
        plan: Plan.ESSENCIAL
    });

    const [newInternalUser, setNewInternalUser] = useState({
        name: '',
        email: '',
        type: 'Suporte' as any,
        campaignId: 'PLATFORM_CORE'
    });

    const fetchAllData = async () => {
        setIsLoading(true);
        try {
            // 1. Fetch Users
            const { data: allUsers, error: usersError } = await supabase.from('users').select('*');
            if (usersError) throw usersError;
            
            setGlobalUsers(allUsers as AuthenticatedUser[]);
            setCampaigns((allUsers as AuthenticatedUser[]).filter(u => u.type === 'Admin'));

            // 2. Fetch Configs
            const { data: configsData, error: configsError } = await supabase.from('campaign_configs').select('*');
            if (configsError) throw configsError;

            const configs: Record<string, CampaignConfig> = {};
            configsData?.forEach((c: any) => {
                configs[c.id] = c as CampaignConfig;
            });
            setCampaignConfigs(configs);

            // 3. Fetch AI Usage
            const { data: usageData, error: usageError } = await supabase
                .from('ai_usage')
                .select('*')
                .order('timestamp', { ascending: false })
                .limit(50);
            if (usageError) throw usageError;
            setAiUsageData(usageData as AIUsageRecord[]);

            // 4. Fetch Platform Stats
            const { data: statsData } = await supabase
                .from('platform_stats')
                .select('*')
                .eq('id', 'global')
                .single();
            if (statsData) {
                setUsageStats({
                    totalTokens: statsData.totalTokens || 0,
                    totalCost: statsData.totalCost || 0
                });
            }

            // 5. Platform metrics (real aggregates) — best-effort, never blocks the page
            try {
                const m = await supremeFetch('/metrics');
                setMetrics(m?.metrics ?? null);
            } catch (mErr) {
                console.warn('[Supreme] metrics fetch failed:', mErr);
            }

        } catch (error) {
            console.error("Supreme Admin Fetch Error:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchAllData();
    }, []);

    const handleCreateInternalUser = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            // Server-side: admin.createUser doesn't hijack the operator's session
            // and uses a real password (no more fixed 'temporary-password-123').
            const tempPassword = `Cp${Math.random().toString(36).slice(2, 10)}!${Math.floor(Math.random() * 90 + 10)}`;
            await supremeFetch('/users', {
                method: 'POST',
                body: JSON.stringify({
                    name: newInternalUser.name,
                    email: newInternalUser.email,
                    password: tempPassword,
                    type: newInternalUser.type,
                    campaignId: newInternalUser.campaignId,
                }),
            });
            setShowCreateUserModal(false);
            fetchAllData();
            alert(
                `Usuário de ${newInternalUser.type} criado com sucesso.\n\n` +
                `Senha temporária: ${tempPassword}\n` +
                `Repasse ao usuário e peça que troque no primeiro acesso.`
            );
        } catch (error: any) {
            console.error(error);
            alert(`Erro ao criar usuário: ${error.message || 'desconhecido'}`);
        }
    };

    const handleUpdatePlan = async (userId: string, campaignId: string, newPlan: Plan) => {
        try {
            // Sincroniza users.plan + campaign_configs.planTier + features + limits em uma única operação
            await syncPlanForCampaign(supabase, userId, campaignId, newPlan);

            fetchAllData();
            const tier = getPlanConfig(newPlan).planTier;
            alert(`Plano atualizado para ${newPlan} (tier: ${tier}). O usuário deve recarregar a página.`);
        } catch (error: any) {
            console.error(error);
            alert(`Erro ao atualizar plano: ${error.message || 'Erro desconhecido'}`);
        }
    };

    const handleSetUserPassword = async (email: string, pass: string) => {
        try {
            // Resolve the user id from the email we already have loaded.
            const target = globalUsers.find(u => u.email === email);
            if (!target?.id) throw new Error('Usuário não encontrado na lista.');
            // Server-side override via admin.updateUserById (the old `set-password`
            // edge function never existed).
            await supremeFetch(`/users/${target.id}/password`, {
                method: 'POST',
                body: JSON.stringify({ password: pass }),
            });
            return true;
        } catch (error: any) {
            console.error("Erro no set-password:", error);
            alert(`Erro ao definir senha: ${error.message || 'Erro de conexão com o servidor.'}`);
            return false;
        }
    };

    const handleForcePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (manualPassword.length < 6) {
            alert("A senha deve ter pelo menos 6 caracteres.");
            return;
        }

        setIsManagingPassword(true);
        const success = await handleSetUserPassword(passwordModal.email, manualPassword);
        if (success) {
            alert("Senha definida com sucesso via Global Auth.");
            setPasswordModal({ isOpen: false, email: '' });
            setManualPassword('');
        }
        setIsManagingPassword(false);
    };

    const handleCreateCampaign = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        try {
            // Server-side provisioning: creates the auth identity (admin.createUser,
            // no session hijack), the campaign admin profile, and campaign_configs
            // with a proper UUID campaignId (the old `camp_${Date.now()}` text id
            // was incompatible with the uuid column in production).
            await supremeFetch('/campaigns', {
                method: 'POST',
                body: JSON.stringify({
                    name: newCampaign.name,
                    email: newCampaign.email,
                    password: newCampaign.password,
                    plan: newCampaign.plan,
                }),
            });
            setShowCreateModal(false);
            setNewCampaign({ name: '', email: '', password: '', plan: Plan.ESSENCIAL });
            await fetchAllData();
        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Erro crítico ao provisionar servidor.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggleUserStatus = async (user: AuthenticatedUser) => {
        const isBlocked = user.role === 'blocked';
        try {
            // Real enforcement: the backend bans/unbans at the Supabase Auth
            // layer (prevents login + kills sessions) AND mirrors role on the
            // profile. The old client-side version only flipped role='blocked',
            // which the app routing never checked — blocked users still logged in.
            await supremeFetch(`/users/${user.id}/${isBlocked ? 'unblock' : 'block'}`, {
                method: 'POST',
            });
            fetchAllData();
        } catch (error: any) {
            console.error(error);
            alert(`Erro ao ${isBlocked ? 'desbloquear' : 'bloquear'}: ${error.message || 'desconhecido'}`);
        }
    };

    const handleResetPassword = async (email: string) => {
        try {
            await sendPasswordReset(email);
            alert(`Email de recuperação enviado para ${email}`);
        } catch (error) {
            console.error(error);
            alert('Falha ao enviar email.');
        }
    };

    const updateConfig = async (campaignId: string, updates: Partial<CampaignConfig>) => {
        try {
            const { error } = await supabase
                .from('campaign_configs')
                .update(updates)
                .eq('id', campaignId);
            
            if (error) throw error;
            fetchAllData();
        } catch (error) {
            console.error(error);
        }
    };

    const filteredUsers = globalUsers.filter(u => {
        const matchesSearch = u.name.toLowerCase().includes(userSearch.toLowerCase()) || 
                             u.email.toLowerCase().includes(userSearch.toLowerCase());
        const matchesType = userFilter === 'all' || u.type === userFilter;
        return matchesSearch && matchesType;
    });

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">
            {isLoading && (
                <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-center justify-center">
                    <div className="flex flex-col items-center gap-4">
                        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-xs font-black uppercase tracking-[0.3em] text-indigo-400 animate-pulse">Sincronizando Rede Global...</p>
                    </div>
                </div>
            )}
            {/* Header */}
            <header className="bg-slate-900/80 backdrop-blur-md border-b border-white/5 p-4 sticky top-0 z-50 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <div className="bg-gradient-to-br from-red-600 to-rose-900 p-2.5 rounded-xl shadow-lg shadow-red-900/20">
                        <ShieldAlert className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-lg font-black text-white tracking-widest uppercase italic">SUPREME CONTROL</h1>
                        <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <p className="text-[10px] text-slate-500 font-mono tracking-tighter">GLOBAL_CORE_OPERATIONAL</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <nav className="hidden md:flex bg-slate-800/50 p-1 rounded-lg border border-white/5">
                        <button 
                            onClick={() => setActiveTab('overview')}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'overview' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                            Visão Geral
                        </button>
                        <button 
                            onClick={() => setActiveTab('campaigns')}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'campaigns' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                            Campanhas
                        </button>
                        <button 
                            onClick={() => setActiveTab('users')}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'users' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                            Usuários
                        </button>
                        <button 
                            onClick={() => setActiveTab('financial')}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'financial' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                            Financeiro & IA
                        </button>
                        <button 
                            onClick={() => setActiveTab('platform')}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'platform' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                            Configurações
                        </button>
                    </nav>

                    <div className="flex items-center gap-3 pl-6 border-l border-white/10">
                        <div className="flex flex-col items-end">
                            <p className="text-xs font-black text-white leading-none uppercase">{user?.name || 'ADMINISTRADOR'}</p>
                            <p className="text-[10px] text-slate-400 font-medium">GESTÃO SUPREMA</p>
                        </div>
                        <Button variant="ghost" onClick={logout} className="h-8 w-8 p-0 rounded-full hover:bg-red-500/10">
                            <Mail className="w-4 h-4 text-slate-500 hover:text-red-500" />
                        </Button>
                    </div>
                </div>
            </header>

            <main className="p-6 max-w-7xl mx-auto space-y-8 pb-20">
                {/* Visualizer Frame */}
                <AnimatePresence mode="wait">
                    {activeTab === 'overview' && (
                        <motion.div 
                            key="overview"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="space-y-8"
                        >
                            {/* Stats Grid — dados reais de supreme_platform_metrics() */}
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                                {[
                                    { label: 'Campanhas Ativas', val: metrics?.campaigns?.active ?? campaigns.length, icon: Globe, color: 'text-blue-400', bg: 'bg-blue-500/10' },
                                    { label: 'Usuários Totais', val: metrics?.users?.total ?? globalUsers.length, icon: Users, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
                                    { label: 'Ativos (30d)', val: metrics?.users?.active30d ?? '—', icon: Activity, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                                    { label: 'Bloqueados', val: metrics?.users?.blocked ?? globalUsers.filter(u => u.role === 'blocked').length, icon: Ban, color: 'text-rose-400', bg: 'bg-rose-500/10' },
                                    { label: 'Tokens IA', val: (metrics?.tokens?.totalTokens ?? 0).toLocaleString('pt-BR'), icon: Cpu, color: 'text-amber-400', bg: 'bg-amber-500/10' },
                                    { label: 'Banco de Dados', val: metrics?.database?.sizePretty ?? '—', icon: Layers, color: 'text-purple-400', bg: 'bg-purple-500/10' },
                                ].map((stat, i) => (
                                    <Card key={i} className="bg-slate-900/50 border-white/5 p-4 relative overflow-hidden group">
                                        <div className={`absolute top-0 right-0 p-3 ${stat.bg} rounded-bl-3xl opacity-20 group-hover:scale-110 transition-transform`}>
                                            <stat.icon className={`w-6 h-6 ${stat.color}`} />
                                        </div>
                                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{stat.label}</p>
                                        <p className="text-2xl font-black text-white mt-2 font-mono tracking-tighter">{stat.val}</p>
                                    </Card>
                                ))}
                            </div>

                            {/* Crescimento de usuários + Usuários por campanha */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                    <div className="p-4 border-b border-white/5 bg-slate-800/30">
                                        <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                            <TrendingIcon className="w-4 h-4 text-emerald-400" /> Crescimento de Usuários (30d)
                                        </h3>
                                    </div>
                                    <div className="p-4 h-64">
                                        {metrics?.userGrowth?.length ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart data={metrics.userGrowth}>
                                                    <defs>
                                                        <linearGradient id="ug" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#34d399" stopOpacity={0.4} />
                                                            <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#64748b' }} />
                                                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
                                                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }} />
                                                    <Area type="monotone" dataKey="novos" stroke="#34d399" fill="url(#ug)" />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        ) : (
                                            <div className="h-full flex items-center justify-center text-slate-500 text-sm">Sem dados de crescimento ainda.</div>
                                        )}
                                    </div>
                                </Card>

                                <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                    <div className="p-4 border-b border-white/5 bg-slate-800/30">
                                        <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                            <Users className="w-4 h-4 text-indigo-400" /> Usuários por Campanha
                                        </h3>
                                    </div>
                                    <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                                        {(metrics?.usersByCampaign ?? []).map((c: any, idx: number) => (
                                            <div key={idx} className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-white/5 text-sm">
                                                <div>
                                                    <p className="font-bold text-white">{c.campaign_name ?? c.campaign_id?.substring(0, 8)}</p>
                                                    <p className="text-[10px] text-slate-500 font-mono">
                                                        {Object.entries(c.by_type ?? {}).map(([t, n]) => `${t}: ${n}`).join('  ·  ')}
                                                    </p>
                                                </div>
                                                <span className="text-lg font-black text-indigo-400 font-mono">{c.total}</span>
                                            </div>
                                        ))}
                                        {!(metrics?.usersByCampaign?.length) && (
                                            <div className="text-slate-500 text-sm py-8 text-center">Sem campanhas com usuários.</div>
                                        )}
                                    </div>
                                </Card>
                            </div>

                            {/* Tamanho do banco (top tabelas) + Horários de pico */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                    <div className="p-4 border-b border-white/5 bg-slate-800/30 flex justify-between items-center">
                                        <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                            <Layers className="w-4 h-4 text-purple-400" /> Consumo de Espaço (Top Tabelas)
                                        </h3>
                                        <span className="text-[10px] text-slate-500 font-mono">Total: {metrics?.database?.sizePretty ?? '—'}</span>
                                    </div>
                                    <div className="p-4 space-y-1.5 max-h-64 overflow-y-auto">
                                        {(metrics?.topTables ?? []).map((t: any, idx: number) => (
                                            <div key={idx} className="flex items-center justify-between text-xs">
                                                <span className="font-mono text-slate-300">{t.table_name}</span>
                                                <span className="font-mono text-slate-500">{t.pretty}</span>
                                            </div>
                                        ))}
                                    </div>
                                </Card>

                                <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                    <div className="p-4 border-b border-white/5 bg-slate-800/30">
                                        <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                            <Activity className="w-4 h-4 text-amber-400" /> Horários de Pico de Atividade (IA, 30d)
                                        </h3>
                                    </div>
                                    <div className="p-4 h-64">
                                        {metrics?.peakHours?.length ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={metrics.peakHours}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#64748b' }} unit="h" />
                                                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
                                                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }} />
                                                    <Bar dataKey="atividades" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        ) : (
                                            <div className="h-full flex items-center justify-center text-slate-500 text-sm text-center px-4">
                                                Sem registros de IA ainda.<br />
                                                <span className="text-[10px]">(o consumo de tokens passa a aparecer quando ai_usage for populado)</span>
                                            </div>
                                        )}
                                    </div>
                                </Card>
                            </div>
                        </motion.div>
                    )}

                    {activeTab === 'campaigns' && (
                        <motion.div 
                            key="campaigns"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="space-y-6"
                        >
                            <div className="flex justify-between items-end">
                                <div>
                                    <h2 className="text-2xl font-black text-white tracking-tighter">GESTOR DE CAMPANHAS</h2>
                                    <p className="text-xs text-slate-500 uppercase tracking-widest font-mono">Provisionamento e Bloqueio de Candidatos</p>
                                </div>
                                <Button onClick={() => setShowCreateModal(true)} className="bg-indigo-600 hover:bg-indigo-500 flex items-center gap-2">
                                    <Plus className="w-4 h-4" /> Nova Campanha
                                </Button>
                            </div>

                            <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-950 text-slate-500 text-[10px] uppercase font-black tracking-widest border-b border-white/5">
                                        <tr>
                                            <th className="px-6 py-4">ID / Candidato</th>
                                            <th className="px-6 py-4">Plano</th>
                                            <th className="px-6 py-4">Features</th>
                                            <th className="px-6 py-4">Status</th>
                                            <th className="px-6 py-4 text-right">Controle</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {campaigns.map(c => {
                                            const config = campaignConfigs[c.campaignId || ''] || {};
                                            return (
                                                <tr key={c.id} className="hover:bg-white/5 transition-colors group">
                                                    <td className="px-6 py-5">
                                                        <p className="font-black text-white text-sm tracking-tight">{c.name}</p>
                                                        <p className="text-[10px] text-slate-500 font-mono italic">CID: {c.campaignId?.substring(0, 12)}...</p>
                                                    </td>
                                                    <td className="px-6 py-5">
                                                        <span className="bg-slate-800 text-xs px-2 py-1 rounded font-bold uppercase text-slate-300">
                                                            {c.plan}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-5">
                                                        <div className="flex gap-1">
                                                            {config.features?.slice(0, 3).map((f, i) => (
                                                                <span key={i} className="w-2 h-2 rounded-full bg-indigo-500" title={f} />
                                                            ))}
                                                            {(config.features?.length || 0) > 3 && <span className="text-[8px] text-slate-500 font-bold">+{config.features!.length - 3}</span>}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-5">
                                                        {c.role === 'blocked' ? (
                                                            <span className="text-rose-500 text-[10px] font-black uppercase flex items-center gap-1.5 bg-rose-500/10 px-2 py-1 rounded-full w-fit">
                                                                <Ban className="w-3 h-3" /> Bloqueado
                                                            </span>
                                                        ) : (
                                                            <span className="text-emerald-500 text-[10px] font-black uppercase flex items-center gap-1.5 bg-emerald-500/10 px-2 py-1 rounded-full w-fit">
                                                                <CheckCircle className="w-3 h-3" /> Liberado
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-5 text-right">
                                                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <Button 
                                                                variant="ghost" 
                                                                onClick={() => setShowConfigModal(c.campaignId || '')}
                                                                className="h-8 w-8 p-0 text-slate-400 hover:text-white"
                                                            >
                                                                <Settings className="w-4 h-4" />
                                                            </Button>
                                                            <Button 
                                                                variant="ghost" 
                                                                onClick={() => handleToggleUserStatus(c)}
                                                                className={`h-8 w-8 p-0 ${c.role === 'blocked' ? 'text-emerald-500' : 'text-rose-500'}`}
                                                            >
                                                                {c.role === 'blocked' ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </Card>
                        </motion.div>
                    )}

                    {activeTab === 'users' && (
                        <motion.div 
                            key="users"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="space-y-6"
                        >
                            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                                <div>
                                    <h2 className="text-2xl font-black text-white tracking-tighter uppercase italic">Global Intelligence: Users</h2>
                                    <p className="text-xs text-slate-500 uppercase tracking-widest font-mono">Banco de Dados Centralizado de Colaboradores</p>
                                </div>
                                <div className="flex gap-2">
                                    <Button onClick={() => setShowCreateUserModal(true)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-2">
                                        <Plus className="w-3 h-3" /> Add Suporte/Manut.
                                    </Button>
                                    <select 
                                        className="bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-sm outline-none"
                                        value={userFilter}
                                        onChange={(e) => setUserFilter(e.target.value as any)}
                                    >
                                        <option value="all">Todos os Perfis</option>
                                        <option value="Admin">Admins/Candidatos</option>
                                        <option value="Líder">Líderes</option>
                                        <option value="Apoiador">Apoiadores</option>
                                        <option value="Colaborador">Colaboradores</option>
                                        <option value="Pesquisador">Pesquisadores</option>
                                    </select>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                        <input 
                                            type="text" 
                                            placeholder="Audit Search..."
                                            className="bg-slate-900 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm outline-none w-64 focus:ring-1 focus:ring-indigo-500"
                                            value={userSearch}
                                            onChange={(e) => setUserSearch(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>

                            <Card className="bg-slate-900 border-white/5">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead className="bg-slate-950 text-slate-500 text-[10px] uppercase font-black tracking-widest">
                                            <tr>
                                                <th className="px-6 py-4">Usuário</th>
                                                <th className="px-6 py-4">Status / Role</th>
                                                <th className="px-6 py-4">Campanha</th>
                                                <th className="px-6 py-4 text-right">Gestão de Credencial</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {filteredUsers.map(u => (
                                                <tr key={u.id} className="hover:bg-white/5 text-sm transition-colors">
                                                    <td className="px-6 py-4">
                                                        <p className="text-white font-bold">{u.name}</p>
                                                        <p className="text-[10px] text-slate-500 font-mono">{u.email}</p>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-2">
                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                                                u.role === 'blocked' ? 'bg-rose-500/20 text-rose-500' : 'bg-indigo-500/20 text-indigo-500'
                                                            }`}>
                                                                {u.type}
                                                            </span>
                                                            {u.role === 'blocked' && <AlertTriangle className="w-3 h-3 text-rose-500" />}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <p className="text-xs text-slate-400">ID: {u.campaignId?.substring(0, 8)}</p>
                                                    </td>
                                                    <td className="px-6 py-4 text-right space-x-2">
                                                        <Button 
                                                            variant="ghost" 
                                                            className="text-xs h-7 px-3 border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/10"
                                                            onClick={async () => {
                                                                try {
                                                                    // Server-side promote (the `promote-user` edge fn never existed).
                                                                    await supremeFetch(`/users/${u.id}/promote`, {
                                                                        method: 'POST',
                                                                        body: JSON.stringify({ type: 'Admin' }),
                                                                    });
                                                                    alert('Usuário promovido a Admin com sucesso.');
                                                                    fetchAllData();
                                                                } catch (e: any) {
                                                                    alert(`Erro na promoção: ${e.message || 'desconhecido'}`);
                                                                    console.error(e);
                                                                }
                                                            }}
                                                        >
                                                            Tornar Admin
                                                        </Button>
                                                        <Button 
                                                            variant="ghost" 
                                                            className="text-xs h-7 px-3 border-white/10 text-slate-400 hover:text-white"
                                                            onClick={() => setPasswordModal({ isOpen: true, email: u.email })}
                                                        >
                                                            Forçar Senha
                                                        </Button>
                                                        <Button 
                                                            variant="ghost" 
                                                            className="text-xs h-7 px-3 border-white/10 text-slate-400 hover:text-white"
                                                            onClick={async () => {
                                                                if (window.confirm(`Deseja enviar um email de recuperação para ${u.email}?`)) {
                                                                    await handleResetPassword(u.email);
                                                                }
                                                            }}
                                                        >
                                                            Reset via Email
                                                        </Button>
                                                        <Button 
                                                            variant={u.role === 'blocked' ? 'secondary' : 'danger'}
                                                            className="text-xs h-7 px-3"
                                                            onClick={() => handleToggleUserStatus(u)}
                                                        >
                                                            {u.role === 'blocked' ? 'Ativar' : 'Bloquear'}
                                                        </Button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </Card>
                        </motion.div>
                    )}

                    {activeTab === 'financial' && (
                        <motion.div 
                            key="financial"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="space-y-8"
                        >
                            <div className="flex justify-between items-end">
                                <div>
                                    <h2 className="text-2xl font-black text-white tracking-tighter uppercase italic">AI Intelligence: Consumption & Cost</h2>
                                    <p className="text-xs text-slate-500 uppercase tracking-widest font-mono">Monitoramento de Consumo de Tokens em Tempo Real</p>
                                </div>
                                <div className="flex items-center gap-4 bg-slate-900 p-3 rounded-xl border border-white/5">
                                    <div className="text-right">
                                        <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Total Gasto (Estimated)</p>
                                        <p className="text-xl font-black text-emerald-400 font-mono">USD {usageStats.totalCost.toFixed(5)}</p>
                                    </div>
                                    <div className="h-8 w-px bg-white/10" />
                                    <div className="text-right">
                                        <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Tokens Processados</p>
                                        <p className="text-xl font-black text-white font-mono">{usageStats.totalTokens.toLocaleString()}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Charts Grid */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <Card className="bg-slate-900 border-white/5 p-6 h-[400px]">
                                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                                        <Activity className="w-4 h-4 text-indigo-400" /> Fluxo de Consumo por Modelo
                                    </h3>
                                    <ResponsiveContainer width="100%" height="85%">
                                        <AreaChart data={aiUsageData.slice().reverse()}>
                                            <defs>
                                                <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                                            <XAxis 
                                                dataKey="timestamp" 
                                                hide 
                                            />
                                            <YAxis stroke="#94a3b8" fontSize={10} />
                                            <Tooltip 
                                                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px' }}
                                                itemStyle={{ fontSize: '12px' }}
                                            />
                                            <Area type="monotone" dataKey="totalTokens" stroke="#6366f1" fillOpacity={1} fill="url(#colorTokens)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </Card>

                                <Card className="bg-slate-900 border-white/5 p-6 h-[400px]">
                                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                                        <TrendingIcon className="w-4 h-4 text-emerald-400" /> Matriz de Custos por Campanha
                                    </h3>
                                    <ResponsiveContainer width="100%" height="85%">
                                        <BarChart data={campaigns.map(c => {
                                            const campaignUsage = aiUsageData.filter(u => u.campaignId === c.campaignId);
                                            return {
                                                name: c.name.substring(0, 10),
                                                cost: campaignUsage.reduce((acc, curr) => acc + curr.estimatedCost, 0),
                                                tokens: campaignUsage.reduce((acc, curr) => acc + curr.totalTokens, 0)
                                            };
                                        }).filter(c => c.tokens > 0)}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                                            <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} />
                                            <YAxis stroke="#94a3b8" fontSize={10} />
                                            <Tooltip 
                                                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px' }}
                                            />
                                            <Bar dataKey="cost" fill="#10b981" radius={[4, 4, 0, 0]}>
                                                {campaigns.map((_, index) => (
                                                    <Cell key={`cell-${index}`} fillOpacity={0.8} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </Card>
                            </div>

                            {/* Detailed Logs */}
                            <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                <div className="p-4 border-b border-white/5 flex justify-between items-center">
                                    <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                        <Settings className="w-4 h-4 text-slate-500" /> Histórico Operacional de IA
                                    </h3>
                                    <div className="flex gap-2">
                                        <Button variant="ghost" className="h-7 text-[10px] flex items-center gap-2"><Filter className="w-3 h-3" /> Filtrar Usuário</Button>
                                        <Button variant="ghost" className="h-7 text-[10px] flex items-center gap-2"><Download className="w-3 h-3" /> Export CSV</Button>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead className="bg-slate-950 text-slate-500 text-[10px] uppercase font-black tracking-widest">
                                            <tr>
                                                <th className="px-6 py-4">Sessão / Modelo</th>
                                                <th className="px-6 py-4">Campaign ID</th>
                                                <th className="px-6 py-4">Tokens</th>
                                                <th className="px-6 py-4 text-right">Custo Est.</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {aiUsageData.map((usage) => (
                                                <tr key={usage.id} className="hover:bg-white/5 text-[11px] transition-colors">
                                                    <td className="px-6 py-3">
                                                        <p className="text-slate-200 font-bold">{usage.model}</p>
                                                        <p className="text-[9px] text-slate-500 font-mono">LOG_ID: {usage.id.substring(0, 10)}</p>
                                                    </td>
                                                    <td className="px-6 py-3 text-slate-400 font-mono">
                                                        {usage.campaignId}
                                                    </td>
                                                    <td className="px-6 py-3">
                                                        <span className="text-indigo-400 font-bold">{usage.totalTokens}</span>
                                                    </td>
                                                    <td className="px-6 py-3 text-right">
                                                        <span className="text-emerald-500 font-black">USD {usage.estimatedCost.toFixed(6)}</span>
                                                    </td>
                                                </tr>
                                            ))}
                                            {aiUsageData.length === 0 && (
                                                <tr>
                                                    <td colSpan={4} className="px-6 py-10 text-center text-slate-500 italic">Nenhum log de IA capturado ainda.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </Card>
                        </motion.div>
                    )}

                    {activeTab === 'platform' && (
                        <motion.div 
                            key="platform"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="space-y-8"
                        >
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <Card className="bg-slate-900 border-white/5 p-6 space-y-4">
                                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                                        <Layout className="w-6 h-6 text-indigo-400" />
                                        <h3 className="font-bold text-white uppercase tracking-widest text-sm">Estrutura de Formulários Globais</h3>
                                    </div>
                                    <p className="text-xs text-slate-400 leading-relaxed italic">
                                        Defina campos personalizados para toda a plataforma ou campanhas específicas. 
                                        A sincronização no cluster é enviada em tempo real para as equipes de rua.
                                    </p>
                                    <div className="space-y-3">
                                        {['Configuração de Visitas', 'Reportes de Rua', 'Pesquisa Quantitativa'].map((f, i) => (
                                            <div key={i} className="flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-white/5 group">
                                                <span className="text-xs font-bold text-slate-300">{f}</span>
                                                <Button variant="ghost" className="h-6 text-[10px] p-0 px-2 opacity-50 group-hover:opacity-100">Configurar Schema</Button>
                                            </div>
                                        ))}
                                    </div>
                                </Card>

                                <Card className="bg-slate-900 border-white/5 p-6 space-y-4">
                                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                                        <CreditCard className="w-6 h-6 text-amber-400" />
                                        <h3 className="font-bold text-white uppercase tracking-widest text-sm">Planos e Monetização</h3>
                                    </div>
                                    <div className="space-y-4">
                                        {[Plan.ESSENCIAL, Plan.ESTRATEGICO, Plan.TOTAL].map((p, i) => (
                                            <div key={i} className="p-4 bg-slate-950 rounded-lg border border-white/5 flex justify-between items-center">
                                                <div>
                                                    <p className="text-sm font-black text-white">{p}</p>
                                                    <p className="text-[10px] text-slate-500 font-mono">LEVEL_{i+1}_ACCESS_PROTOCOL</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs font-bold text-indigo-400">R$ {i === 0 ? '999' : i === 1 ? '2.490' : '5.900'}/camp</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </Card>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>

            {/* Modals */}
            <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="LIBERAR NOVO CANDIDATO">
                <form onSubmit={handleCreateCampaign} className="space-y-4 p-4 text-slate-200">
                    {error && (
                        <div className="bg-rose-500/10 border border-rose-500/20 p-3 rounded text-rose-500 text-xs font-bold">
                            {error}
                        </div>
                    )}
                    <Input 
                        label="Nome da Campanha / Candidato"
                        value={newCampaign.name} 
                        onChange={e => setNewCampaign({...newCampaign, name: e.target.value})}
                        required
                    />
                    <Input 
                        label="Email de Acesso (Login)"
                        type="email"
                        value={newCampaign.email} 
                        onChange={e => setNewCampaign({...newCampaign, email: e.target.value})}
                        required
                    />
                    <Input 
                        label="Definir Senha Inicial"
                        type="password"
                        placeholder="Mínimo 6 caracteres"
                        value={newCampaign.password} 
                        onChange={e => setNewCampaign({...newCampaign, password: e.target.value})}
                        required
                    />
                    <div className="space-y-2">
                        <label className="text-xs font-bold uppercase text-slate-500">Plano de Entrada</label>
                        <select 
                            className="w-full bg-slate-950 border border-white/10 rounded-lg p-2.5 outline-none focus:ring-1 focus:ring-indigo-500"
                            value={newCampaign.plan}
                            onChange={e => setNewCampaign({...newCampaign, plan: e.target.value as Plan})}
                        >
                            <option value={Plan.ESSENCIAL}>Essencial</option>
                            <option value={Plan.ESTRATEGICO}>Estratégico</option>
                            <option value={Plan.TOTAL}>Total (Prime)</option>
                        </select>
                    </div>
                    <div className="pt-4">
                        <Button 
                            type="submit" 
                            className="w-full bg-indigo-600 hover:bg-indigo-500"
                            disabled={isLoading}
                        >
                            {isLoading ? 'EXECUTANDO PROVISIONAMENTO...' : 'Provisionar Servidor da Campanha'}
                        </Button>
                    </div>
                </form>
            </Modal>
            
            {/* Forçar Senha Modal */}
            <Modal 
                isOpen={passwordModal.isOpen} 
                onClose={() => setPasswordModal({ isOpen: false, email: '' })}
                title="GESTÃO DE ACESSO: FORÇAR SENHA"
            >
                <form onSubmit={handleForcePasswordSubmit} className="p-4 space-y-4">
                    <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg">
                        <p className="text-[10px] text-amber-200 uppercase font-bold mb-1">Aviso de Segurança</p>
                        <p className="text-xs text-slate-400">
                            Esta ação altera a senha diretamente no cluster de autenticação. 
                            O usuário <strong>{passwordModal.email}</strong> receberá a nova senha definida abaixo.
                        </p>
                    </div>
                    
                    <Input 
                        label="Nova Senha"
                        type="password"
                        placeholder="Mínimo 6 caracteres"
                        value={manualPassword}
                        onChange={e => setManualPassword(e.target.value)}
                        required
                    />
                    
                    <div className="pt-4 flex justify-end gap-3">
                        <Button 
                            type="button" 
                            variant="secondary" 
                            onClick={() => setPasswordModal({ isOpen: false, email: '' })}
                        >
                            Cancelar
                        </Button>
                        <Button 
                            type="submit"
                            disabled={isManagingPassword}
                        >
                            {isManagingPassword ? 'SUBMETENDO NOVO HASH...' : 'Confirmar Alteração'}
                        </Button>
                    </div>
                </form>
            </Modal>

            {/* Config Campaign Modal */}
            <Modal 
                isOpen={!!showConfigModal} 
                onClose={() => setShowConfigModal(null)} 
                title={`CONFIGURAR CAMPANHA: ${showConfigModal?.substring(0, 8)}`}
            >
                {showConfigModal && (
                    <div className="p-4 space-y-6 max-h-[600px] overflow-y-auto custom-scrollbar">
                        {/* Plan Strategy Section */}
                        <div className="space-y-4">
                            <h4 className="text-[10px] font-black uppercase text-indigo-400 border-b border-indigo-500/20 pb-1">Estratégia de Plano (Upgrade/Downgrade)</h4>
                            <div className="flex gap-2">
                                {[Plan.ESSENCIAL, Plan.ESTRATEGICO, Plan.TOTAL].map(p => {
                                    const userObj = campaigns.find(c => c.campaignId === showConfigModal);
                                    const isCurrent = userObj?.plan === p;
                                    return (
                                        <button 
                                            key={p}
                                            onClick={() => userObj && handleUpdatePlan(String(userObj.id!), showConfigModal, p)}
                                            className={`flex-1 p-2 rounded border text-[10px] font-black uppercase transition-all ${
                                                isCurrent ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-slate-900 border-white/5 text-slate-500 hover:border-white/10'
                                            }`}
                                        >
                                            {p}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Limits Section */}
                        <div className="space-y-4">
                            <h4 className="text-[10px] font-black uppercase text-indigo-400 border-b border-indigo-500/20 pb-1">Recursos e Limites</h4>
                            <div className="grid grid-cols-3 gap-2">
                                <div className="space-y-1">
                                    <label className="text-[9px] uppercase text-slate-500">IA Calls</label>
                                    <input 
                                        type="number" 
                                        className="w-full bg-slate-950 border border-white/10 rounded p-1 text-xs" 
                                        value={campaignConfigs[showConfigModal]?.limits.aiCalls || 0}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            const cfg = campaignConfigs[showConfigModal];
                                            updateConfig(showConfigModal, { limits: { ...cfg.limits, aiCalls: val } });
                                        }}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[9px] uppercase text-slate-500">Equipe</label>
                                    <input 
                                        type="number" 
                                        className="w-full bg-slate-950 border border-white/10 rounded p-1 text-xs" 
                                        value={campaignConfigs[showConfigModal]?.limits.teamMembers || 0}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            const cfg = campaignConfigs[showConfigModal];
                                            updateConfig(showConfigModal, { limits: { ...cfg.limits, teamMembers: val } });
                                        }}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[9px] uppercase text-slate-500">Visitas</label>
                                    <input 
                                        type="number" 
                                        className="w-full bg-slate-950 border border-white/10 rounded p-1 text-xs" 
                                        value={campaignConfigs[showConfigModal]?.limits.visits || 0}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            const cfg = campaignConfigs[showConfigModal];
                                            updateConfig(showConfigModal, { limits: { ...cfg.limits, visits: val } });
                                        }}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Features Section */}
                        <div className="space-y-4">
                            <h4 className="text-[10px] font-black uppercase text-indigo-400 border-b border-indigo-500/20 pb-1">Funcionalidades Liberadas</h4>
                            <div className="grid grid-cols-2 gap-2">
                                {['dashboard', 'visits', 'team', 'reports', 'financial', 'ai_agents', 'content_Brief', 'field_ops'].map(feat => {
                                    const isEnabled = campaignConfigs[showConfigModal]?.features.includes(feat);
                                    return (
                                        <button 
                                            key={feat}
                                            onClick={() => {
                                                const current = campaignConfigs[showConfigModal]?.features || [];
                                                const next = isEnabled ? current.filter(f => f !== feat) : [...current, feat];
                                                updateConfig(showConfigModal, { features: next });
                                            }}
                                            className={`text-[10px] p-2 rounded border transition-all text-left uppercase font-bold flex justify-between items-center ${
                                                isEnabled ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400' : 'bg-slate-900 border-white/5 text-slate-600 hover:border-white/10'
                                            }`}
                                        >
                                            {feat.replace('_', ' ')}
                                            {isEnabled && <CheckCircle className="w-3 h-3" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Custom Fields Section */}
                        <div className="space-y-4">
                            <h4 className="text-[10px] font-black uppercase text-indigo-400 border-b border-indigo-500/20 pb-1">Campos Customizados (Visitas)</h4>
                            <div className="space-y-2">
                                {(campaignConfigs[showConfigModal]?.customFields?.visits || []).map((f, i) => (
                                    <div key={i} className="flex items-center justify-between p-2 bg-slate-950 rounded text-xs">
                                        <span>{f.label} ({f.type})</span>
                                        <button 
                                            onClick={() => {
                                                const nextFields = campaignConfigs[showConfigModal].customFields.visits.filter((_, idx) => idx !== i);
                                                updateConfig(showConfigModal, { customFields: { ...campaignConfigs[showConfigModal].customFields, visits: nextFields } });
                                            }}
                                            className="text-red-500 hover:text-red-400"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                ))}
                                <Button 
                                    variant="ghost" 
                                    className="w-full h-8 text-[10px] border-dashed border-white/10"
                                    onClick={() => {
                                        const label = prompt('Label do campo:');
                                        if (label) {
                                            const nextFields = [...(campaignConfigs[showConfigModal].customFields?.visits || []), { id: `field_${Date.now()}`, label, type: 'text', required: false }];
                                            updateConfig(showConfigModal, { customFields: { ...campaignConfigs[showConfigModal].customFields, visits: nextFields as CustomField[] } });
                                        }
                                    }}
                                >
                                    + Adicionar Campo à Visita
                                </Button>
                            </div>
                        </div>

                        <div className="pt-4">
                            <Button onClick={() => setShowConfigModal(null)} className="w-full">Fechar Painel</Button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Create Internal User Modal */}
            <Modal isOpen={showCreateUserModal} onClose={() => setShowCreateUserModal(false)} title="CRIAR USUÁRIO DA PLATAFORMA">
                <form onSubmit={handleCreateInternalUser} className="space-y-4 p-4 text-slate-200">
                    <Input 
                        label="Nome Completo"
                        value={newInternalUser.name} 
                        onChange={e => setNewInternalUser({...newInternalUser, name: e.target.value})}
                        required
                    />
                    <Input 
                        label="Email"
                        type="email"
                        value={newInternalUser.email} 
                        onChange={e => setNewInternalUser({...newInternalUser, email: e.target.value})}
                        required
                    />
                    <div className="space-y-2">
                        <label className="text-xs font-bold uppercase text-slate-500">Perfil Profissional</label>
                        <select 
                            className="w-full bg-slate-950 border border-white/10 rounded-lg p-2.5 outline-none focus:ring-1 focus:ring-indigo-500"
                            value={newInternalUser.type}
                            onChange={e => setNewInternalUser({...newInternalUser, type: e.target.value as any})}
                        >
                            <option value="Suporte">Suporte Técnico</option>
                            <option value="Manutenção">Manutenção de Dados</option>
                        </select>
                    </div>
                    <div className="pt-4">
                        <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500">Gerar Credencial Global</Button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default SupremeAdminPage;
