import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { AuthenticatedUser, Plan } from '../types/user';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import { syncPlanForCampaign, getPlanConfig } from '../utils/planUtils';
import ConsultantReport from '../components/supreme/ConsultantReport';
import { ModernArea, ModernBar } from '../components/supreme/Charts';
import FormBuilder from '../components/supreme/FormBuilder';
import PublicFormsPanel from '../components/supreme/PublicFormsPanel';
import PlatformFormsCatalog from '../components/supreme/PlatformFormsCatalog';
import SupremeAiHealthCard from '../components/supreme/SupremeAiHealthCard';
import BusinessKpis from '../components/supreme/BusinessKpis';
import PartiesTab from '../components/supreme/PartiesTab';
import ModulesTab from './supreme/ModulesTab';
import SupportSessionsTab from './supreme/SupportSessionsTab';
import ContractsTab from '../components/supreme/ContractsTab';
import TseKeysPanel from '../components/supreme/TseKeysPanel';
import { 
    Users, ShieldAlert, Ban, CheckCircle, Globe,
    Settings, Plus, Search, Lock, Unlock,
    Layout, Cpu, AlertTriangle, Trash2, Mail,
    CreditCard, Layers, TrendingUp as TrendingIcon,
    Activity, Filter, Download, Brain, RefreshCw, LogOut, ScrollText, Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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

interface CustomField {
    id: string;
    label: string;
    type: 'text' | 'number' | 'select' | 'boolean';
    options?: string[];
    required: boolean;
}

const SUPREME_API = '/api/v1/supreme';

/** Rótulos amigáveis dos módulos (feature keys → PT-BR). */
const FEATURE_LABELS: Record<string, string> = {
    dashboard: 'Dashboard', crm: 'CRM', help: 'Ajuda', visits: 'Visitas', team: 'Equipes',
    engagement: 'Engajamento', resources: 'Recursos', goals: 'Metas', routines: 'Rotinas',
    ai_agents: 'Agentes IA', forms: 'Formulários', analytics: 'Analytics', financial: 'Financeiro',
    content_studio: 'Estúdio', rag: 'Base IA (RAG)', meetings: 'Reuniões', tools: 'Ferramentas',
    training: 'Treinamento', whatsapp_omnichannel: 'WhatsApp', election_day: 'Dia das Eleições',
    intelligence: 'Inteligência', scenarios: 'Cenários', budget_ceo: 'Orçamento CEO',
    paperclip: 'Agentes-Tarefas', compliance: 'Conformidade',
};
const fmtLimit = (v: number) => (v === -1 || v == null ? '∞' : v.toLocaleString('pt-BR'));

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
    // Aba ativa persistida na URL (?tab=) → sobrevive a refresh e é compartilhável.
    const VALID_TABS = ['overview', 'campaigns', 'users', 'platform', 'financial', 'parties', 'modulos', 'suporte', 'audit', 'forms', 'contratos'] as const;
    type SupremeTab = typeof VALID_TABS[number];
    const [activeTab, setActiveTab] = useState<SupremeTab>(() => {
        try {
            const t = new URLSearchParams(window.location.search).get('tab');
            if (t && (VALID_TABS as readonly string[]).includes(t)) return t as SupremeTab;
        } catch { /* ignore */ }
        return 'overview';
    });
    const [formsSubTab, setFormsSubTab] = useState<'internal' | 'public'>('internal');

    // Sincroniza a aba ativa com a URL (sem empilhar histórico) p/ persistir no refresh.
    useEffect(() => {
        try {
            const url = new URL(window.location.href);
            if (url.searchParams.get('tab') !== activeTab) {
                url.searchParams.set('tab', activeTab);
                window.history.replaceState({}, '', url.toString());
            }
        } catch { /* ignore */ }
    }, [activeTab]);

    // Auditoria (F2)
    const [auditLogs, setAuditLogs] = useState<any[]>([]);
    const [accessLog, setAccessLog] = useState<any[]>([]);
    const [auditFilter, setAuditFilter] = useState('');
    const [loadingAudit, setLoadingAudit] = useState(false);
    
    // Campaigns Data
    const [campaigns, setCampaigns] = useState<AuthenticatedUser[]>([]);
    const [campaignConfigs, setCampaignConfigs] = useState<Record<string, CampaignConfig>>({});
    const [plans, setPlans] = useState<any[]>([]);
    const [partidoPriceCents, setPartidoPriceCents] = useState<number>(300000);
    
    // Global Users Data
    const [globalUsers, setGlobalUsers] = useState<AuthenticatedUser[]>([]);
    const [userSearch, setUserSearch] = useState('');
    const [userFilter, setUserFilter] = useState<'all' | 'Admin' | 'Líder' | 'Apoiador' | 'Colaborador' | 'Pesquisador' | 'Suporte' | 'Manutenção'>('all');
    

    // Platform metrics (F1) — real aggregates from supreme_platform_metrics()
    const [metrics, setMetrics] = useState<any | null>(null);

    // Financial metrics (F3)
    const [financial, setFinancial] = useState<any | null>(null);
    const [runningLifecycle, setRunningLifecycle] = useState(false);
    // Criptografia de campos sensíveis legados (CPF/RG/banco/PIX/etc.) em lote.
    const [migratingEnc, setMigratingEnc] = useState(false);
    const [encResult, setEncResult] = useState<any | null>(null);
    const [newCost, setNewCost] = useState({ category: 'infraestrutura', description: '', amount: '', currency: 'BRL' });
    const [taxes, setTaxes] = useState<any | null>(null);
    const [taxConfig, setTaxConfig] = useState<any>({ regime: 'simples', anexoOverride: 'auto', cnae: '', usdBrlRate: 5.40 });
    const [savingTaxConfig, setSavingTaxConfig] = useState(false);
    const [nf, setNf] = useState<any | null>(null);
    const [newNf, setNewNf] = useState({ number: '', amount: '', customerName: '', description: '' });

    // Dashboard per-campaign filter (F1)
    const [dashCampaign, setDashCampaign] = useState<string>('all');
    const [campaignSnapshot, setCampaignSnapshot] = useState<any | null>(null);
    const [loadingSnapshot, setLoadingSnapshot] = useState(false);

    // AI Consultant (F6)
    const [analyzingId, setAnalyzingId] = useState<string | null>(null);
    const [analysis, setAnalysis] = useState<any | null>(null);
    const [analysisCampaign, setAnalysisCampaign] = useState<string>('');
    const [showAnalysisModal, setShowAnalysisModal] = useState(false);
    
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
                configs[c.id] = { ...c, customFields: c.customFields ?? {} } as CampaignConfig;
            });
            setCampaignConfigs(configs);

            // 5. Platform metrics (real aggregates) — best-effort, never blocks the page
            // (consumo de IA real vem daqui — metrics.tokens, de agent_runs —
            //  as tabelas ai_usage/platform_stats legadas ficavam vazias)
            try {
                const m = await supremeFetch('/metrics');
                setMetrics(m?.metrics ?? null);
            } catch (mErr) {
                console.warn('[Supreme] metrics fetch failed:', mErr);
            }

            // 6. Financial metrics (F3) — best-effort
            try {
                const f = await supremeFetch('/financial');
                setFinancial(f?.financial ?? null);
            } catch (fErr) {
                console.warn('[Supreme] financial fetch failed:', fErr);
            }

            // 7. Impostos (Simples Nacional) + config fiscal — best-effort
            try {
                const t = await supremeFetch('/taxes');
                setTaxes(t?.taxes ?? null);
                const cfg = await supremeFetch('/tax-config');
                if (cfg?.config) setTaxConfig({
                    regime: cfg.config.regime ?? 'simples',
                    anexoOverride: cfg.config.anexoOverride ?? 'auto',
                    cnae: cfg.config.cnae ?? '',
                    usdBrlRate: cfg.config.usdBrlRate ?? 5.40,
                });
            } catch (tErr) {
                console.warn('[Supreme] taxes fetch failed:', tErr);
            }

            // 8. Notas Fiscais (rastreador manual) — best-effort
            try {
                const n = await supremeFetch('/invoices');
                setNf(n?.nf ?? null);
            } catch (nErr) {
                console.warn('[Supreme] nf fetch failed:', nErr);
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

    // When a campaign is picked in the dashboard filter, load its snapshot.
    const handleDashCampaignChange = async (campaignId: string) => {
        setDashCampaign(campaignId);
        if (campaignId === 'all') { setCampaignSnapshot(null); return; }
        setLoadingSnapshot(true);
        setCampaignSnapshot(null);
        try {
            const r = await supremeFetch(`/campaigns/${campaignId}/snapshot`);
            setCampaignSnapshot(r?.snapshot ?? null);
        } catch (e) {
            console.warn('[Supreme] snapshot failed', e);
        } finally {
            setLoadingSnapshot(false);
        }
    };

    const [planMenuFor, setPlanMenuFor] = useState<string | null>(null);
    const [settingPlan, setSettingPlan] = useState<string | null>(null);
    // Fecha o dropdown ao clicar fora.
    useEffect(() => {
        if (!planMenuFor) return;
        const close = () => setPlanMenuFor(null);
        const t = setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
        return () => { clearTimeout(t); document.removeEventListener('click', close); };
    }, [planMenuFor]);

    const handleSetPlan = async (campaignId: string, planId: 'free' | 'essencial' | 'pro' | 'enterprise') => {
        setSettingPlan(campaignId);
        try {
            const r = await supremeFetch(`/campaigns/${campaignId}/set-plan`, {
                method: 'POST', body: JSON.stringify({ planId }),
            });
            if (r?.ok) {
                // Recarrega a lista de campanhas pra refletir o novo plano
                setPlanMenuFor(null);
                // Refresca o campaignConfigs daquela campanha
                setCampaignConfigs((prev) => ({
                    ...prev,
                    [campaignId]: { ...(prev[campaignId] || {}), planTier: r.planTier, features: r.features ?? prev[campaignId]?.features ?? [] },
                }));
                alert(`✅ Plano alterado para ${r.planName || planId}.`);
            } else {
                alert(`Erro ao definir plano: ${r?.error || 'desconhecido'}`);
            }
        } catch (e: any) {
            alert(`Erro: ${e.message || 'falha de rede'}`);
        } finally { setSettingPlan(null); }
    };

    const handleAnalyzeCampaign = async (campaignId: string, campaignName: string) => {
        if (!campaignId) return;
        setAnalyzingId(campaignId);
        setAnalysisCampaign(campaignName);
        setAnalysis(null);
        setShowAnalysisModal(true);
        try {
            const r = await supremeFetch(`/campaigns/${campaignId}/analyze`, { method: 'POST' });
            setAnalysis(r);
        } catch (e: any) {
            setAnalysis({ error: e.message || 'Falha na análise' });
        } finally {
            setAnalyzingId(null);
        }
    };

    const fetchAudit = async (filter?: string) => {
        setLoadingAudit(true);
        try {
            const q = filter ? `?action=${encodeURIComponent(filter)}&limit=200` : '?limit=200';
            const [a, ac] = await Promise.all([
                supremeFetch(`/audit-logs${q}`),
                supremeFetch('/access-log'),
            ]);
            setAuditLogs(a?.logs ?? []);
            setAccessLog(ac?.access ?? []);
        } catch (e) {
            console.warn('[Supreme] audit fetch failed', e);
        } finally {
            setLoadingAudit(false);
        }
    };

    // Carrega auditoria ao abrir a aba
    useEffect(() => {
        if (activeTab === 'audit' && auditLogs.length === 0) fetchAudit();
        if (activeTab === 'platform' && plans.length === 0) {
            supremeFetch('/plans').then(r => setPlans(r?.plans || [])).catch(e => console.warn('[Supreme] plans fetch:', e));
            supremeFetch('/party-billing').then(r => setPartidoPriceCents(r?.price?.monthlyCents ?? 300000)).catch(() => {});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    const handleSaveTaxConfig = async () => {
        setSavingTaxConfig(true);
        try {
            await supremeFetch('/tax-config', {
                method: 'PUT',
                body: JSON.stringify({
                    regime: taxConfig.regime,
                    anexoOverride: taxConfig.anexoOverride,
                    cnae: taxConfig.cnae,
                    usdBrlRate: parseFloat(String(taxConfig.usdBrlRate).replace(',', '.')) || 5.40,
                }),
            });
            await fetchAllData();
            alert('Configuração fiscal salva. Impostos e custos recalculados.');
        } catch (e: any) {
            alert(`Erro ao salvar config: ${e.message}`);
        } finally {
            setSavingTaxConfig(false);
        }
    };

    const handleAddNf = async () => {
        const val = parseFloat(String(newNf.amount).replace(',', '.'));
        if (!Number.isFinite(val) || val < 0) { alert('Valor inválido.'); return; }
        try {
            await supremeFetch('/invoices', {
                method: 'POST',
                body: JSON.stringify({
                    number: newNf.number.trim() || null,
                    amountCents: Math.round(val * 100),
                    customerName: newNf.customerName.trim() || null,
                    description: newNf.description.trim() || null,
                }),
            });
            setNewNf({ number: '', amount: '', customerName: '', description: '' });
            fetchAllData();
        } catch (e: any) { alert(`Erro ao registrar nota: ${e.message}`); }
    };

    const handleCancelNf = async (id: string) => {
        if (!window.confirm('Marcar esta nota como cancelada?')) return;
        try {
            await supremeFetch(`/invoices/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelada' }) });
            fetchAllData();
        } catch (e: any) { alert(`Erro: ${e.message}`); }
    };

    const handleAddCost = async () => {
        const val = parseFloat(String(newCost.amount).replace(',', '.'));
        if (!newCost.description.trim() || !Number.isFinite(val) || val < 0) {
            alert('Preencha descrição e valor válido.');
            return;
        }
        try {
            await supremeFetch('/costs', {
                method: 'POST',
                body: JSON.stringify({
                    category: newCost.category,
                    description: newCost.description.trim(),
                    amountCents: Math.round(val * 100),
                    currency: newCost.currency,
                    recurrence: 'monthly',
                }),
            });
            setNewCost({ category: 'infraestrutura', description: '', amount: '', currency: 'BRL' });
            fetchAllData();
        } catch (e: any) {
            alert(`Erro ao adicionar custo: ${e.message || 'desconhecido'}`);
        }
    };

    const handleUpdateCostAmount = async (id: string, val: number) => {
        try {
            await supremeFetch(`/costs/${id}`, { method: 'PATCH', body: JSON.stringify({ amountCents: Math.round(val * 100) }) });
            fetchAllData();
        } catch (e: any) { alert(`Erro: ${e.message}`); }
    };

    const handleDeleteCost = async (id: string) => {
        if (!window.confirm('Remover este custo?')) return;
        try {
            await supremeFetch(`/costs/${id}`, { method: 'DELETE' });
            fetchAllData();
        } catch (e: any) { alert(`Erro: ${e.message}`); }
    };

    const handleRunLifecycle = async () => {
        setRunningLifecycle(true);
        try {
            const r = await supremeFetch('/financial/run-lifecycle', { method: 'POST' });
            const res = r?.result ?? {};
            alert(
                `Cobrança/lifecycle executado:\n` +
                `• Lembretes enviados: ${res.remindersSent ?? 0}\n` +
                `• Downgrades por inadimplência: ${res.downgraded ?? 0}\n` +
                `• Cancelados expirados: ${res.canceledExpired ?? 0}\n` +
                `• Erros: ${res.errors ?? 0}`
            );
            fetchAllData();
        } catch (e: any) {
            alert(`Erro ao rodar cobrança: ${e.message || 'desconhecido'}`);
        } finally {
            setRunningLifecycle(false);
        }
    };

    const handleEncryptMigrateAll = async () => {
        if (!confirm('Cifrar dados sensíveis legados (CPF, RG, título, banco, PIX, doc. do doador, CPF/CNPJ do candidato) em TODAS as campanhas?\n\nÉ seguro rodar mais de uma vez (idempotente). Requer FIELD_ENCRYPTION_KEY configurada no servidor.')) return;
        setMigratingEnc(true);
        setEncResult(null);
        try {
            const r = await supremeFetch('/encrypt-migrate-all', { method: 'POST' });
            setEncResult(r?.summary ?? {});
        } catch (e: any) {
            alert(`Erro na migração: ${e.message || 'desconhecido'}`);
        } finally {
            setMigratingEnc(false);
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
                            onClick={() => setActiveTab('forms')}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'forms' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                            Formulários
                        </button>
                        <button
                            onClick={() => setActiveTab('financial')}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'financial' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                            Financeiro & IA
                        </button>
                        <button
                            onClick={() => setActiveTab('parties')}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'parties' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                            🏛️ Partidos
                        </button>
                        <button
                            onClick={() => setActiveTab('modulos')}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'modulos' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                            🧩 Módulos
                        </button>
                        <button
                            onClick={() => setActiveTab('contratos')}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'contratos' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                            📄 Contratos
                        </button>
                        <button
                            onClick={() => setActiveTab('suporte')}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'suporte' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                            🛟 Suporte
                        </button>
                        <button
                            onClick={() => setActiveTab('audit')}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'audit' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                            Auditoria
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
                        <Button
                            onClick={() => { if (window.confirm('Encerrar sessão do SUPREME CONTROL?')) logout(); }}
                            className="h-9 px-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 flex items-center gap-2 text-xs font-bold"
                        >
                            <LogOut className="w-4 h-4" /> Sair
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
                            {/* Filtro por campanha */}
                            <div className="flex items-center gap-3">
                                <Filter className="w-4 h-4 text-slate-500" />
                                <select
                                    value={dashCampaign}
                                    onChange={(e) => handleDashCampaignChange(e.target.value)}
                                    className="bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-sm outline-none text-slate-200"
                                >
                                    <option value="all">🌐 Toda a plataforma (visão global)</option>
                                    {/* Só campanhas reais: presidentes de partido (sem campaignId,
                                        ex.: Ronald) não são campanha e não entram no filtro. */}
                                    {campaigns.filter((c) => c.campaignId).map((c) => (
                                        <option key={c.campaignId} value={c.campaignId || ''}>
                                            {c.name} ({c.campaignId!.substring(0, 8)})
                                        </option>
                                    ))}
                                </select>
                                {loadingSnapshot && <span className="text-xs text-slate-500">carregando…</span>}
                            </div>

                            {/* ===== VISÃO POR CAMPANHA ===== */}
                            {dashCampaign !== 'all' && campaignSnapshot && (
                                <div className="space-y-6">
                                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                                        {[
                                            { label: 'Contatos (CRM)', val: campaignSnapshot.contacts?.total ?? 0, icon: Users, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
                                            { label: 'Visitas', val: campaignSnapshot.visits?.total ?? 0, icon: Activity, color: 'text-blue-400', bg: 'bg-blue-500/10' },
                                            { label: 'Reportes Rua', val: campaignSnapshot.streetReports?.total ?? 0, icon: Globe, color: 'text-rose-400', bg: 'bg-rose-500/10' },
                                            { label: 'Tokens IA', val: (campaignSnapshot.ai?.tokens ?? 0).toLocaleString('pt-BR'), icon: Cpu, color: 'text-amber-400', bg: 'bg-amber-500/10' },
                                            { label: 'Custo IA', val: `$${(campaignSnapshot.ai?.costUsd ?? 0).toFixed(2)}`, icon: CreditCard, color: 'text-green-400', bg: 'bg-green-500/10' },
                                            { label: 'WhatsApp Msgs', val: campaignSnapshot.whatsapp?.messages ?? 0, icon: Mail, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                                        ].map((stat, i) => (
                                            <Card key={i} className="bg-slate-900/50 border-white/5 p-4 relative overflow-hidden group">
                                                <div className={`absolute top-0 right-0 p-3 ${stat.bg} rounded-bl-3xl opacity-20`}>
                                                    <stat.icon className={`w-6 h-6 ${stat.color}`} />
                                                </div>
                                                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{stat.label}</p>
                                                <p className="text-2xl font-black text-white mt-2 font-mono tracking-tighter">{stat.val}</p>
                                            </Card>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                        <Card className="bg-slate-900 border-white/5 p-4">
                                            <p className="text-xs font-black uppercase tracking-widest text-indigo-400 mb-3">Funil do Eleitor</p>
                                            {Object.keys(campaignSnapshot.voterJourney ?? {}).length ? (
                                                <div className="space-y-1.5">
                                                    {Object.entries(campaignSnapshot.voterJourney).map(([stage, n]: any) => (
                                                        <div key={stage} className="flex justify-between text-sm"><span className="text-slate-300">{stage}</span><span className="font-mono text-white">{n}</span></div>
                                                    ))}
                                                </div>
                                            ) : <p className="text-slate-500 text-sm">Sem dados de jornada.</p>}
                                        </Card>
                                        <Card className="bg-slate-900 border-white/5 p-4">
                                            <p className="text-xs font-black uppercase tracking-widest text-emerald-400 mb-3">Equipe por Perfil</p>
                                            {Object.keys(campaignSnapshot.team ?? {}).length ? (
                                                <div className="space-y-1.5">
                                                    {Object.entries(campaignSnapshot.team).map(([role, n]: any) => (
                                                        <div key={role} className="flex justify-between text-sm"><span className="text-slate-300">{role}</span><span className="font-mono text-white">{n}</span></div>
                                                    ))}
                                                </div>
                                            ) : <p className="text-slate-500 text-sm">Sem equipe.</p>}
                                        </Card>
                                        <Card className="bg-slate-900 border-white/5 p-4">
                                            <p className="text-xs font-black uppercase tracking-widest text-amber-400 mb-3">Clima nas Ruas</p>
                                            {Object.keys(campaignSnapshot.streetReports?.byClima ?? {}).length ? (
                                                <div className="space-y-1.5">
                                                    {Object.entries(campaignSnapshot.streetReports.byClima).map(([clima, n]: any) => (
                                                        <div key={clima} className="flex justify-between text-sm"><span className="text-slate-300">{clima}</span><span className="font-mono text-white">{n}</span></div>
                                                    ))}
                                                </div>
                                            ) : <p className="text-slate-500 text-sm">Sem reportes.</p>}
                                        </Card>
                                    </div>

                                    {/* Funil de Conversão (eleitor) — campos capturados nos formulários */}
                                    {campaignSnapshot.funnel && (
                                      <Card className="bg-slate-900 border-white/5 p-5">
                                        <div className="flex items-center justify-between mb-4">
                                          <p className="text-xs font-black uppercase tracking-widest text-blue-400">Funil de Conversão do Eleitor</p>
                                          <span className="text-[10px] text-slate-500">{campaignSnapshot.funnel.total ?? 0} contatos</span>
                                        </div>
                                        {/* KPIs */}
                                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
                                          {[
                                            { label: 'Certeza média', val: campaignSnapshot.funnel.avgCertainty != null ? `${campaignSnapshot.funnel.avgCertainty}/10` : '—' },
                                            { label: 'Multiplicadores', val: campaignSnapshot.funnel.multipliers ?? 0 },
                                            { label: 'Alcance (infl.)', val: campaignSnapshot.funnel.totalInfluence ?? 0 },
                                            { label: 'Opt-in WhatsApp', val: campaignSnapshot.funnel.whatsappOptin ?? 0 },
                                            { label: 'C/ zona-seção', val: campaignSnapshot.funnel.comGeoEleitoral ?? 0 },
                                          ].map((k, i) => (
                                            <div key={i} className="bg-slate-950 rounded-lg p-3 border border-white/5">
                                              <p className="text-[9px] uppercase text-slate-500 tracking-widest">{k.label}</p>
                                              <p className="text-lg font-black text-white mt-1">{k.val}</p>
                                            </div>
                                          ))}
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                          {([
                                            { title: 'Intenção de voto', data: campaignSnapshot.funnel.byIntention, labels: { apoia: 'Já apoia', vai_votar: 'Vai votar', indeciso: 'Indeciso', rejeita: 'Rejeita', nao_disse: 'Não disse', '(sem)': 'Sem info' } as any, color: 'bg-blue-500' },
                                            { title: 'Estágio no funil', data: campaignSnapshot.funnel.byStage, labels: {} as any, color: 'bg-indigo-500' },
                                            { title: 'Origem (canal)', data: campaignSnapshot.funnel.bySource, labels: {} as any, color: 'bg-emerald-500' },
                                          ]).map((blk, bi) => {
                                            const entries = Object.entries(blk.data ?? {}) as [string, number][];
                                            const tot = entries.reduce((s, [, n]) => s + Number(n), 0) || 1;
                                            return (
                                              <div key={bi}>
                                                <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">{blk.title}</p>
                                                {entries.length ? (
                                                  <div className="space-y-1.5">
                                                    {entries.sort((a, b) => Number(b[1]) - Number(a[1])).map(([k, n]) => (
                                                      <div key={k}>
                                                        <div className="flex justify-between text-[11px]"><span className="text-slate-300">{blk.labels[k] || k}</span><span className="font-mono text-slate-400">{n}</span></div>
                                                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden"><div className={`h-full ${blk.color}`} style={{ width: `${(Number(n) / tot) * 100}%` }} /></div>
                                                      </div>
                                                    ))}
                                                  </div>
                                                ) : <p className="text-slate-600 text-xs">Sem dados.</p>}
                                              </div>
                                            );
                                          })}
                                        </div>
                                        <p className="text-[10px] text-slate-600 mt-4">Preenchido pela Visita e pelo CRM (intenção, certeza, multiplicador, opt-in, zona/seção). Quanto mais preenchido, mais precisa a análise da IA.</p>
                                      </Card>
                                    )}

                                    {/* Crescimento + Pico + Consumo de espaço — filtrados por esta campanha */}
                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                        <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                            <div className="p-4 border-b border-white/5 bg-slate-800/30">
                                                <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2"><TrendingIcon className="w-4 h-4 text-emerald-400" /> Crescimento de Usuários (30d)</h3>
                                            </div>
                                            <div className="p-4 h-56">
                                                {campaignSnapshot.userGrowth?.length ? (
                                                    <ModernArea data={campaignSnapshot.userGrowth} xKey="day" dataKey="novos" color="#34d399" />
                                                ) : <div className="h-full flex items-center justify-center text-slate-500 text-sm">Sem novos usuários (30d).</div>}
                                            </div>
                                        </Card>
                                        <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                            <div className="p-4 border-b border-white/5 bg-slate-800/30">
                                                <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2"><Activity className="w-4 h-4 text-amber-400" /> Horários de Pico (IA, 30d)</h3>
                                            </div>
                                            <div className="p-4 h-56">
                                                {campaignSnapshot.peakHours?.length ? (
                                                    <ModernBar data={campaignSnapshot.peakHours} xKey="hour" dataKey="atividades" color="#fbbf24" unit="h" />
                                                ) : <div className="h-full flex items-center justify-center text-slate-500 text-sm text-center px-4">Sem atividade de IA (30d).</div>}
                                            </div>
                                        </Card>
                                        <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                            <div className="p-4 border-b border-white/5 bg-slate-800/30">
                                                <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2"><Layers className="w-4 h-4 text-purple-400" /> Consumo de Espaço (registros)</h3>
                                            </div>
                                            <div className="p-4 space-y-1.5 max-h-56 overflow-y-auto">
                                                {campaignSnapshot.spaceUsage?.length ? campaignSnapshot.spaceUsage.map((t: any) => (
                                                    <div key={t.tabela} className="flex items-center justify-between text-xs">
                                                        <span className="font-mono text-slate-300">{t.tabela}</span>
                                                        <span className="font-mono text-slate-500">{Number(t.rows).toLocaleString('pt-BR')}</span>
                                                    </div>
                                                )) : <div className="text-slate-500 text-sm py-8 text-center">Sem dados.</div>}
                                            </div>
                                        </Card>
                                    </div>

                                    <div className="flex justify-end">
                                        <Button onClick={() => handleAnalyzeCampaign(dashCampaign, campaigns.find(c => c.campaignId === dashCampaign)?.name || '')} className="bg-indigo-600 hover:bg-indigo-500 flex items-center gap-2">
                                            <Brain className="w-4 h-4" /> Analisar esta campanha com IA
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* ===== VISÃO GLOBAL ===== */}
                            {dashCampaign === 'all' && <>
                            {/* Stats Grid — dados reais de supreme_platform_metrics() */}
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                                {[
                                    { label: 'Campanhas Ativas', val: metrics?.campaigns?.active ?? campaigns.length, icon: Globe, color: 'text-blue-400', bg: 'bg-blue-500/10' },
                                    { label: 'Usuários Totais', val: metrics?.users?.total ?? globalUsers.length, icon: Users, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
                                    { label: 'Ativos (30d)', val: metrics?.users?.active30d ?? '—', icon: Activity, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                                    { label: 'Bloqueados', val: metrics?.users?.blocked ?? globalUsers.filter(u => u.role === 'blocked').length, icon: Ban, color: 'text-rose-400', bg: 'bg-rose-500/10' },
                                    { label: 'Tokens IA', val: (metrics?.tokens?.totalTokens ?? 0).toLocaleString('pt-BR'), icon: Cpu, color: 'text-amber-400', bg: 'bg-amber-500/10' },
                                    { label: 'Custo IA (USD)', val: `$${(metrics?.tokens?.totalCostUsd ?? 0).toFixed(2)}`, icon: CreditCard, color: 'text-green-400', bg: 'bg-green-500/10' },
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
                                            <ModernArea data={metrics.userGrowth} xKey="day" dataKey="novos" color="#34d399" />
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
                                            <ModernBar data={metrics.peakHours} xKey="hour" dataKey="atividades" color="#fbbf24" unit="h" />
                                        ) : (
                                            <div className="h-full flex items-center justify-center text-slate-500 text-sm text-center px-4">
                                                Sem registros de IA ainda.
                                            </div>
                                        )}
                                    </div>
                                </Card>
                            </div>
                            </>}
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
                                                        <p className="font-black text-white text-sm tracking-tight">{c.name || c.email}</p>
                                                        <p className="text-[10px] text-slate-400">{c.email}</p>
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
                                                            {/* Definir plano (Grátis / Essencial / Pro / Enterprise) — só Supreme vê */}
                                                            <div className="relative" onClick={(e) => e.stopPropagation()}>
                                                                <Button
                                                                    variant="ghost"
                                                                    onClick={() => setPlanMenuFor(planMenuFor === c.campaignId ? null : (c.campaignId || ''))}
                                                                    className="h-8 px-2 text-emerald-400 hover:text-emerald-300 flex items-center gap-1 text-xs"
                                                                    title="Definir plano da campanha (libera Grátis ou troca tier)"
                                                                    disabled={settingPlan === c.campaignId}
                                                                >
                                                                    🔓 {settingPlan === c.campaignId ? 'Salvando…' : 'Plano'}
                                                                </Button>
                                                                {planMenuFor === c.campaignId && (
                                                                    <div className="absolute right-0 top-9 z-20 bg-slate-900 border border-white/10 rounded-xl shadow-2xl py-1 min-w-[180px]">
                                                                        {[
                                                                            { id: 'free', label: '🆓 Grátis', sub: 'IA 0 · sem WhatsApp' },
                                                                            { id: 'essencial', label: '🚀 Essencial', sub: 'R$ 10k · 1k msgs' },
                                                                            { id: 'pro', label: '🎯 Estratégico', sub: 'R$ 15k · 10k msgs + Call Center' },
                                                                            { id: 'enterprise', label: '👑 Total', sub: 'R$ 20k · tudo ilimitado' },
                                                                        ].map((p) => (
                                                                            <button
                                                                                key={p.id}
                                                                                onClick={() => handleSetPlan(c.campaignId || '', p.id as any)}
                                                                                className="w-full text-left px-3 py-2 hover:bg-white/5 text-xs"
                                                                            >
                                                                                <p className="font-bold text-white">{p.label}</p>
                                                                                <p className="text-[10px] text-slate-500">{p.sub}</p>
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <Button
                                                                variant="ghost"
                                                                onClick={() => handleAnalyzeCampaign(c.campaignId || '', c.name)}
                                                                className="h-8 px-2 text-indigo-400 hover:text-indigo-300 flex items-center gap-1 text-xs"
                                                                title="Analisar campanha com IA (consultor político)"
                                                            >
                                                                <Brain className="w-4 h-4" /> Analisar IA
                                                            </Button>
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

                    {activeTab === 'forms' && (
                        <motion.div
                            key="forms"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="space-y-8"
                        >
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setFormsSubTab('internal')}
                                    className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${formsSubTab === 'internal' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-900 text-slate-400 hover:text-white border border-white/5'}`}
                                >
                                    Campos internos
                                </button>
                                <button
                                    onClick={() => setFormsSubTab('public')}
                                    className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${formsSubTab === 'public' ? 'bg-emerald-600 text-white shadow-lg' : 'bg-slate-900 text-slate-400 hover:text-white border border-white/5'}`}
                                >
                                    Formulários públicos
                                </button>
                            </div>
                            {formsSubTab === 'internal' ? (
                                <>
                                    <Card className="bg-slate-900/40 border-white/5 p-6">
                                        <FormBuilder
                                            campaigns={campaigns
                                                .filter((c) => !!c.campaignId)
                                                .map((c) => ({ id: c.campaignId as string, name: c.name }))}
                                            supremeFetch={supremeFetch}
                                        />
                                    </Card>
                                    <Card className="bg-slate-900/40 border-white/5 p-6">
                                        <PlatformFormsCatalog />
                                    </Card>
                                </>
                            ) : (
                                <Card className="bg-slate-900/40 border-white/5 p-6">
                                    <PublicFormsPanel
                                        campaigns={campaigns
                                            .filter((c) => !!c.campaignId)
                                            .map((c) => ({ id: c.campaignId as string, name: c.name }))}
                                        supremeFetch={supremeFetch}
                                    />
                                </Card>
                            )}
                        </motion.div>
                    )}

                    {activeTab === 'financial' && (
                        <motion.div
                            key="financial"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="space-y-8"
                        >
                            {/* ===== FINANCEIRO SAAS (F3) ===== */}
                            <div className="flex justify-between items-end">
                                <div>
                                    <h2 className="text-2xl font-black text-white tracking-tighter uppercase italic">Financeiro SaaS</h2>
                                    <p className="text-xs text-slate-500 uppercase tracking-widest font-mono">Receita Recorrente, Assinaturas e Inadimplência</p>
                                </div>
                                <Button onClick={handleRunLifecycle} disabled={runningLifecycle} className="bg-indigo-600 hover:bg-indigo-500 flex items-center gap-2">
                                    <RefreshCw className={`w-4 h-4 ${runningLifecycle ? 'animate-spin' : ''}`} />
                                    {runningLifecycle ? 'Processando…' : 'Rodar cobrança agora'}
                                </Button>
                            </div>

                            {/* Cards financeiros */}
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                                {[
                                    { label: 'MRR', val: `R$ ${((financial?.mrrCents ?? 0)/100).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: TrendingIcon },
                                    { label: 'ARR (anual)', val: `R$ ${((financial?.arrCents ?? 0)/100).toLocaleString('pt-BR', {minimumFractionDigits: 0})}`, color: 'text-teal-400', bg: 'bg-teal-500/10', icon: TrendingIcon },
                                    { label: 'Pagantes Ativos', val: financial?.subscriptions?.payingActive ?? 0, color: 'text-blue-400', bg: 'bg-blue-500/10', icon: CheckCircle },
                                    { label: 'Inadimplentes', val: financial?.subscriptions?.pastDue ?? 0, color: 'text-rose-400', bg: 'bg-rose-500/10', icon: AlertTriangle },
                                    { label: 'Cancelados', val: financial?.subscriptions?.canceled ?? 0, color: 'text-slate-400', bg: 'bg-slate-500/10', icon: Ban },
                                    { label: 'Custo IA (USD)', val: `$${(financial?.aiCostUsd ?? 0).toFixed(2)}`, color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Cpu },
                                ].map((s, i) => (
                                    <Card key={i} className="bg-slate-900/50 border-white/5 p-4 relative overflow-hidden">
                                        <div className={`absolute top-0 right-0 p-3 ${s.bg} rounded-bl-3xl opacity-20`}><s.icon className={`w-6 h-6 ${s.color}`} /></div>
                                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{s.label}</p>
                                        <p className="text-xl font-black text-white mt-2 font-mono tracking-tighter">{s.val}</p>
                                    </Card>
                                ))}
                            </div>

                            {/* AI Health detalhado — só Supreme vê custos/agentes/campanhas (regra #111) */}
                            <SupremeAiHealthCard />

                            {/* Planos + Inadimplentes */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                    <div className="p-4 border-b border-white/5 bg-slate-800/30">
                                        <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2"><CreditCard className="w-4 h-4 text-emerald-400" /> Planos & Assinantes</h3>
                                    </div>
                                    <div className="p-4 space-y-2">
                                        {(financial?.byPlan ?? []).map((p: any) => (
                                            <div key={p.id} className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-white/5">
                                                <div>
                                                    <p className="font-bold text-white">{p.name}</p>
                                                    <p className="text-[10px] text-slate-500 font-mono">R$ {(p.monthlyCents/100).toLocaleString('pt-BR')}/mês {p.active ? '' : '· inativo'}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-lg font-black text-emerald-400 font-mono">{p.active_subs}</p>
                                                    <p className="text-[10px] text-slate-500">ativos</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </Card>

                                <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                    <div className="p-4 border-b border-white/5 bg-slate-800/30">
                                        <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-rose-400" /> Inadimplentes (suspensão automática)</h3>
                                    </div>
                                    <div className="p-4 space-y-2 max-h-72 overflow-y-auto">
                                        {(financial?.inadimplentes?.length ?? 0) === 0 ? (
                                            <p className="text-slate-500 text-sm py-8 text-center flex flex-col items-center gap-2"><CheckCircle className="w-8 h-8 text-emerald-500/40" /> Nenhum inadimplente. 🎉</p>
                                        ) : financial.inadimplentes.map((x: any) => (
                                            <div key={x.subscription_id} className="flex items-center justify-between p-3 bg-rose-500/5 rounded-lg border border-rose-500/20">
                                                <div>
                                                    <p className="font-bold text-white">{x.campaign_name ?? x.campaign_id?.substring(0,8)}</p>
                                                    <p className="text-[10px] text-slate-500">{x.plan_name} · desde {x.updatedAt ? new Date(x.updatedAt).toLocaleDateString('pt-BR') : '—'}</p>
                                                </div>
                                                <span className="text-rose-400 font-mono text-sm">R$ {(x.monthlyCents/100).toLocaleString('pt-BR')}</span>
                                            </div>
                                        ))}
                                    </div>
                                </Card>
                            </div>

                            {/* ===== DEMONSTRATIVO DE RESULTADO (P&L) ===== */}
                            <div>
                                <h3 className="text-lg font-black text-white mb-1 uppercase">Demonstrativo de Resultado (P&L)</h3>
                                <p className="text-xs text-slate-500 uppercase tracking-widest font-mono mb-4">Receita − Custos − Imposto = Lucro após impostos (mensal)</p>
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                                    {[
                                        { label: 'Receita (MRR)', val: `R$ ${((financial?.profitLoss?.receitaCents ?? 0)/100).toLocaleString('pt-BR', {minimumFractionDigits:2})}`, color: 'text-emerald-400' },
                                        { label: 'Custos Fixos', val: `R$ ${((financial?.profitLoss?.custosFixosCents ?? 0)/100).toLocaleString('pt-BR', {minimumFractionDigits:2})}`, color: 'text-rose-400' },
                                        { label: 'Custo IA (var.)', val: `R$ ${((financial?.profitLoss?.custoIaVariavelCents ?? 0)/100).toLocaleString('pt-BR', {minimumFractionDigits:2})}`, color: 'text-amber-400' },
                                        { label: 'Lucro antes imp.', val: `R$ ${((financial?.profitLoss?.lucroLiquidoCents ?? 0)/100).toLocaleString('pt-BR', {minimumFractionDigits:2})}`, color: (financial?.profitLoss?.lucroLiquidoCents ?? 0) >= 0 ? 'text-slate-300' : 'text-rose-400' },
                                        { label: 'Imposto (DAS)', val: `R$ ${((financial?.profitLoss?.dasMesCents ?? 0)/100).toLocaleString('pt-BR', {minimumFractionDigits:2})}`, color: 'text-orange-400' },
                                        { label: 'Lucro após imp.', val: `R$ ${((financial?.profitLoss?.lucroAposImpostosCents ?? 0)/100).toLocaleString('pt-BR', {minimumFractionDigits:2})}`, color: (financial?.profitLoss?.lucroAposImpostosCents ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400' },
                                        { label: 'Margem', val: `${financial?.profitLoss?.margemPct ?? 0}%`, color: 'text-sky-400' },
                                    ].map((s, i) => (
                                        <Card key={i} className="bg-slate-900/50 border-white/5 p-4">
                                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{s.label}</p>
                                            <p className={`text-lg font-black mt-2 font-mono ${s.color}`}>{s.val}</p>
                                        </Card>
                                    ))}
                                </div>
                                <p className="text-[10px] text-slate-600 mt-2">Custo IA convertido a US$ 1 = R$ {financial?.usdBrlRate ?? '5.40'} (consumo dos últimos 30 dias). Imposto (DAS) é estimativa do Simples Nacional sobre a receita total (planos + módulos/partidos); a guia oficial é emitida pelo contador.</p>
                            </div>

                            {/* ===== KPIs DE SAÚDE DO NEGÓCIO (CAC/LTV/ROI/Equilíbrio) ===== */}
                            <BusinessKpis financial={financial} />

                            {/* ===== IMPOSTOS (SIMPLES NACIONAL) ===== */}
                            <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                <div className="p-4 border-b border-white/5 bg-slate-800/30">
                                    <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-400" /> Impostos — Simples Nacional (sede RJ)</h3>
                                </div>
                                {taxes ? (
                                    <div className="p-4">
                                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                                            {[
                                                { label: 'DAS a pagar/mês', val: `R$ ${((taxes.dasMesCents ?? 0)/100).toLocaleString('pt-BR', {minimumFractionDigits:2})}`, color: 'text-rose-400', big: true },
                                                { label: 'Anexo', val: taxes.anexo, color: 'text-sky-400' },
                                                { label: 'Fator R', val: `${(taxes.fatorR*100).toFixed(1)}%`, color: taxes.fatorR >= 0.28 ? 'text-emerald-400' : 'text-amber-400' },
                                                { label: 'Alíq. efetiva', val: `${(taxes.aliquotaEfetiva*100).toFixed(2)}%`, color: 'text-slate-200' },
                                                { label: 'RBT12 (base)', val: `R$ ${((taxes.rbt12 ?? 0)).toLocaleString('pt-BR')}`, color: 'text-slate-200' },
                                            ].map((s, i) => (
                                                <div key={i} className="bg-slate-950/50 border border-white/5 rounded-lg p-3">
                                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{s.label}</p>
                                                    <p className={`${s.big ? 'text-xl' : 'text-lg'} font-black mt-2 font-mono ${s.color}`}>{s.val}</p>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-300/90">
                                            💡 {taxes.observacao}
                                        </div>

                                        {/* Configuração fiscal manual */}
                                        <div className="mt-4 pt-4 border-t border-white/5">
                                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Configuração fiscal (ajuste conforme seu contador)</p>
                                            <div className="flex items-end gap-3 flex-wrap">
                                                <div>
                                                    <label className="block text-[10px] text-slate-500 mb-1">Regime</label>
                                                    <select value={taxConfig.regime} onChange={(e) => setTaxConfig({...taxConfig, regime: e.target.value})} className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-200">
                                                        <option value="simples">Simples Nacional</option>
                                                        <option value="presumido">Lucro Presumido</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] text-slate-500 mb-1">Anexo</label>
                                                    <select value={taxConfig.anexoOverride} onChange={(e) => setTaxConfig({...taxConfig, anexoOverride: e.target.value})} className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-200">
                                                        <option value="auto">Automático (Fator R)</option>
                                                        <option value="III">Forçar Anexo III</option>
                                                        <option value="V">Forçar Anexo V</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] text-slate-500 mb-1">CNAE</label>
                                                    <input value={taxConfig.cnae} onChange={(e) => setTaxConfig({...taxConfig, cnae: e.target.value})} placeholder="6203-1/00" className="w-32 bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-white" />
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] text-slate-500 mb-1">US$ → R$</label>
                                                    <input value={taxConfig.usdBrlRate} onChange={(e) => setTaxConfig({...taxConfig, usdBrlRate: e.target.value})} type="number" step="0.01" className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-right text-white" />
                                                </div>
                                                <Button onClick={handleSaveTaxConfig} disabled={savingTaxConfig} className="bg-indigo-600 hover:bg-indigo-500 flex items-center gap-1">
                                                    {savingTaxConfig ? 'Salvando…' : 'Salvar config'}
                                                </Button>
                                            </div>
                                        </div>

                                        <p className="text-[10px] text-slate-600 mt-3">
                                            RBT12 estimado = MRR × 12. Folha (Fator R) = custos de salários/pessoal × 12.
                                            A DAS é guia única e já inclui o ISS municipal (RJ) — SaaS não recolhe ICMS.
                                            A taxa US$→R$ definida aqui vale também pros custos e o lucro.
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-slate-500 text-sm p-6">Sem dados de imposto (defina receita/assinaturas).</p>
                                )}
                            </Card>

                            {/* ===== NOTAS FISCAIS (rastreador manual) ===== */}
                            <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                <div className="p-4 border-b border-white/5 bg-slate-800/30 flex justify-between items-center">
                                    <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2"><Download className="w-4 h-4 text-emerald-400" /> Notas Fiscais (NFS-e)</h3>
                                    <div className="flex gap-4 text-right">
                                        <div><p className="text-[9px] text-slate-500 uppercase">Mês atual</p><p className="text-sm font-black text-emerald-400 font-mono">R$ {((nf?.mesAtualCents ?? 0)/100).toLocaleString('pt-BR', {minimumFractionDigits:2})}</p></div>
                                        <div><p className="text-[9px] text-slate-500 uppercase">Emitidas</p><p className="text-sm font-black text-white font-mono">{nf?.count ?? 0}</p></div>
                                    </div>
                                </div>
                                <div className="p-4 space-y-2">
                                    {(nf?.items ?? []).slice(0, 50).map((n: any) => (
                                        <div key={n.id} className="flex items-center gap-3 p-3 bg-slate-950/50 rounded-lg border border-white/5 text-sm">
                                            <span className="font-mono text-slate-400 w-16 shrink-0">{n.number || '—'}</span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-white truncate">{n.customerName || n.campaign_name || 'Cliente'}</p>
                                                <p className="text-[10px] text-slate-500 truncate">{n.description || ''}</p>
                                            </div>
                                            <span className="text-[10px] text-slate-500 font-mono shrink-0">{n.issuedAt ? new Date(n.issuedAt).toLocaleDateString('pt-BR') : ''}</span>
                                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded shrink-0 ${n.status === 'emitida' ? 'bg-emerald-500/20 text-emerald-400' : n.status === 'cancelada' ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-700 text-slate-400'}`}>{n.status}</span>
                                            <span className="font-mono text-white w-28 text-right shrink-0">R$ {((n.amountCents ?? 0)/100).toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                                            {n.status === 'emitida' && <button onClick={() => handleCancelNf(n.id)} className="text-rose-400 hover:text-rose-300 p-1" title="Cancelar"><Ban className="w-4 h-4" /></button>}
                                        </div>
                                    ))}
                                    {!(nf?.items?.length) && <p className="text-slate-500 text-sm py-4 text-center">Nenhuma nota registrada ainda.</p>}
                                    {/* Registrar nota */}
                                    <div className="flex items-center gap-2 pt-2 border-t border-white/5 mt-2 flex-wrap">
                                        <input value={newNf.number} onChange={(e) => setNewNf({...newNf, number: e.target.value})} placeholder="Nº NF" className="w-20 bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-white" />
                                        <input value={newNf.customerName} onChange={(e) => setNewNf({...newNf, customerName: e.target.value})} placeholder="Cliente/tomador" className="flex-1 min-w-[140px] bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white" />
                                        <input value={newNf.description} onChange={(e) => setNewNf({...newNf, description: e.target.value})} placeholder="Descrição do serviço" className="flex-1 min-w-[140px] bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white" />
                                        <input value={newNf.amount} onChange={(e) => setNewNf({...newNf, amount: e.target.value})} placeholder="R$ valor" type="number" className="w-28 bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-right text-white" />
                                        <Button onClick={handleAddNf} className="bg-indigo-600 hover:bg-indigo-500 flex items-center gap-1"><Plus className="w-4 h-4" /> Registrar</Button>
                                    </div>
                                    <p className="text-[10px] text-slate-600 pt-1">Rastreador manual — registre as NFS-e emitidas (na Nota Carioca/contador). Emissão automática será integrada quando houver certificado A1 + cadastro municipal.</p>
                                </div>
                            </Card>

                            {/* ===== CUSTOS OPERACIONAIS ===== */}
                            <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                <div className="p-4 border-b border-white/5 bg-slate-800/30">
                                    <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2"><CreditCard className="w-4 h-4 text-rose-400" /> Custos Operacionais (infra, IA, impostos…)</h3>
                                </div>
                                <div className="p-4 space-y-2">
                                    {(financial?.costs?.items ?? []).map((c: any) => (
                                        <div key={c.id} className="flex items-center gap-3 p-3 bg-slate-950/50 rounded-lg border border-white/5">
                                            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-slate-700 text-slate-300 w-24 text-center shrink-0">{c.category}</span>
                                            <p className="flex-1 text-sm text-white truncate">{c.description}</p>
                                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${c.currency === 'USD' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>{c.currency}</span>
                                            <div className="flex items-center gap-1">
                                                <span className="text-slate-500 text-xs">{c.currency === 'USD' ? '$' : 'R$'}</span>
                                                <input
                                                    type="number"
                                                    defaultValue={(c.amountCents/100).toFixed(2)}
                                                    onBlur={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && Math.round(v*100) !== c.amountCents) handleUpdateCostAmount(c.id, v); }}
                                                    className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-right text-white font-mono"
                                                />
                                            </div>
                                            {/* Valor convertido pra BRL quando é USD */}
                                            <span className="text-[10px] text-slate-500 font-mono w-28 text-right shrink-0">
                                                {c.currency === 'USD' ? `≈ R$ ${((c.brl_cents ?? 0)/100).toLocaleString('pt-BR', {minimumFractionDigits:2})}` : '/mês'}
                                            </span>
                                            <button onClick={() => handleDeleteCost(c.id)} className="text-rose-400 hover:text-rose-300 p-1"><Trash2 className="w-4 h-4" /></button>
                                        </div>
                                    ))}
                                    {/* Adicionar custo */}
                                    <div className="flex items-center gap-2 pt-2 border-t border-white/5 mt-2 flex-wrap">
                                        <select value={newCost.category} onChange={(e) => setNewCost({...newCost, category: e.target.value})} className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-200">
                                            <option value="infraestrutura">Infraestrutura</option>
                                            <option value="ia">IA</option>
                                            <option value="dominio">Domínio</option>
                                            <option value="salarios">Salários</option>
                                            <option value="prestadores">Prestadores</option>
                                            <option value="impostos">Impostos</option>
                                            <option value="marketing">Marketing</option>
                                            <option value="outros">Outros</option>
                                        </select>
                                        <input value={newCost.description} onChange={(e) => setNewCost({...newCost, description: e.target.value})} placeholder="Descrição (ex: VPS Hostinger)" className="flex-1 min-w-[160px] bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white" />
                                        <select value={newCost.currency} onChange={(e) => setNewCost({...newCost, currency: e.target.value})} className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-200">
                                            <option value="BRL">R$ BRL</option>
                                            <option value="USD">$ USD</option>
                                        </select>
                                        <input value={newCost.amount} onChange={(e) => setNewCost({...newCost, amount: e.target.value})} placeholder="valor/mês" type="number" className="w-28 bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-right text-white" />
                                        <Button onClick={handleAddCost} className="bg-indigo-600 hover:bg-indigo-500 flex items-center gap-1"><Plus className="w-4 h-4" /> Add</Button>
                                    </div>
                                    <p className="text-[10px] text-slate-600 pt-1">Custos em USD (Supabase, IAs) são convertidos a R$ {financial?.usdBrlRate ?? '5.40'}/dólar no total e no lucro.</p>
                                </div>
                            </Card>

                            <div className="border-t border-white/5 pt-6" />

                            {/* ===== IA: CONSUMO & CUSTO ===== */}
                            <div className="flex justify-between items-end">
                                <div>
                                    <h2 className="text-2xl font-black text-white tracking-tighter uppercase italic">AI Intelligence: Consumption & Cost</h2>
                                    <p className="text-xs text-slate-500 uppercase tracking-widest font-mono">Monitoramento de Consumo de Tokens em Tempo Real</p>
                                </div>
                                <div className="flex items-center gap-4 bg-slate-900 p-3 rounded-xl border border-white/5">
                                    <div className="text-right">
                                        <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Total Gasto (USD)</p>
                                        <p className="text-xl font-black text-emerald-400 font-mono">US$ {(metrics?.tokens?.totalCostUsd ?? 0).toFixed(2)}</p>
                                    </div>
                                    <div className="h-8 w-px bg-white/10" />
                                    <div className="text-right">
                                        <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Tokens Processados</p>
                                        <p className="text-xl font-black text-white font-mono">{(metrics?.tokens?.totalTokens ?? 0).toLocaleString('pt-BR')}</p>
                                    </div>
                                    <div className="h-8 w-px bg-white/10" />
                                    <div className="text-right">
                                        <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Chamadas</p>
                                        <p className="text-xl font-black text-sky-400 font-mono">{(metrics?.tokens?.totalRuns ?? 0).toLocaleString('pt-BR')}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Charts Grid */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <Card className="bg-slate-900 border-white/5 p-6 h-[400px]">
                                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                                        <Activity className="w-4 h-4 text-indigo-400" /> Tokens por Provider / Modelo
                                    </h3>
                                    {(metrics?.tokens?.byModel?.length) ? (
                                        <div className="h-[85%]"><ModernBar data={metrics.tokens.byModel} xKey="model" dataKey="tokens" horizontal palette={['#6366f1','#34d399','#fbbf24','#f472b6']} /></div>
                                    ) : <div className="h-[85%] flex items-center justify-center text-slate-500 text-sm">Sem dados de IA.</div>}
                                </Card>

                                <Card className="bg-slate-900 border-white/5 p-6 h-[400px]">
                                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                                        <TrendingIcon className="w-4 h-4 text-emerald-400" /> Custo (US$) por Campanha
                                    </h3>
                                    {(metrics?.tokens?.byCampaign?.length) ? (
                                        <div className="h-[85%]"><ModernBar
                                            data={metrics.tokens.byCampaign.map((c: any) => ({
                                                name: (metrics.usersByCampaign?.find((u: any) => u.campaign_id === c.campaign_id)?.campaign_name) || String(c.campaign_id).substring(0, 8),
                                                cost: c.cost_usd, tokens: c.tokens,
                                            }))}
                                            xKey="name" dataKey="cost" color="#10b981"
                                        /></div>
                                    ) : <div className="h-[85%] flex items-center justify-center text-slate-500 text-sm">Sem dados de IA.</div>}
                                </Card>
                            </div>

                            {/* Breakdown por modelo (agent_runs) */}
                            <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                <div className="p-4 border-b border-white/5 flex justify-between items-center">
                                    <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                        <Cpu className="w-4 h-4 text-slate-500" /> Consumo de IA por Modelo (agent_runs)
                                    </h3>
                                    <span className="text-[10px] text-slate-500 font-mono">
                                        Total: {(metrics?.tokens?.totalTokens ?? 0).toLocaleString('pt-BR')} tokens · US$ {(metrics?.tokens?.totalCostUsd ?? 0).toFixed(2)}
                                        {metrics?.tokens?.reliability && (
                                            <span className="ml-2">· <span className="text-emerald-400">{metrics.tokens.reliability.ok} ok</span> / <span className="text-rose-400">{metrics.tokens.reliability.error} erro</span></span>
                                        )}
                                    </span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead className="bg-slate-950 text-slate-500 text-[10px] uppercase font-black tracking-widest">
                                            <tr>
                                                <th className="px-6 py-4">Provider / Modelo</th>
                                                <th className="px-6 py-4 text-right">Chamadas</th>
                                                <th className="px-6 py-4 text-right">Tokens</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {(metrics?.tokens?.byModel ?? []).map((m: any, i: number) => (
                                                <tr key={i} className="hover:bg-white/5 text-[11px] transition-colors">
                                                    <td className="px-6 py-3 text-slate-200 font-bold">{m.model}</td>
                                                    <td className="px-6 py-3 text-right text-slate-400 font-mono">{Number(m.calls).toLocaleString('pt-BR')}</td>
                                                    <td className="px-6 py-3 text-right text-indigo-400 font-bold">{Number(m.tokens).toLocaleString('pt-BR')}</td>
                                                </tr>
                                            ))}
                                            {!(metrics?.tokens?.byModel?.length) && (
                                                <tr><td colSpan={3} className="px-6 py-10 text-center text-slate-500 italic">Nenhuma chamada de IA registrada ainda.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                <p className="text-[10px] text-slate-600 p-3">Dados reais de agent_runs (consumo das chamadas do callAgent). Nota: providers que não retornam contagem de tokens (alguns Anthropic/Gemini) aparecem com 0 tokens — correção registrada como follow-up.</p>
                            </Card>
                        </motion.div>
                    )}

                    {activeTab === 'parties' && <PartiesTab />}

                    {activeTab === 'modulos' && <ModulesTab />}

                    {activeTab === 'contratos' && <ContractsTab />}

                    {activeTab === 'suporte' && <SupportSessionsTab />}

                    {activeTab === 'audit' && (
                        <motion.div
                            key="audit"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="space-y-8"
                        >
                            <div className="flex justify-between items-end">
                                <div>
                                    <h2 className="text-2xl font-black text-white tracking-tighter uppercase italic">Auditoria & Acessos</h2>
                                    <p className="text-xs text-slate-500 uppercase tracking-widest font-mono">Quem acessou e o que cada usuário fez na plataforma</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        value={auditFilter}
                                        onChange={(e) => setAuditFilter(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') fetchAudit(auditFilter); }}
                                        placeholder="Filtrar ação (ex: auth, billing, whatsapp)…"
                                        className="bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-sm outline-none text-slate-200 w-64"
                                    />
                                    <Button onClick={() => fetchAudit(auditFilter)} className="bg-indigo-600 hover:bg-indigo-500 flex items-center gap-2">
                                        <RefreshCw className={`w-4 h-4 ${loadingAudit ? 'animate-spin' : ''}`} /> Buscar
                                    </Button>
                                </div>
                            </div>

                            {/* Logs de acesso por usuário */}
                            <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                <div className="p-4 border-b border-white/5 bg-slate-800/30">
                                    <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2"><Clock className="w-4 h-4 text-sky-400" /> Logs de Acesso (por usuário)</h3>
                                </div>
                                <table className="w-full text-left text-sm">
                                    <thead className="text-[10px] uppercase text-slate-500 border-b border-white/5">
                                        <tr>
                                            <th className="px-4 py-2">Usuário</th>
                                            <th className="px-4 py-2">Perfil</th>
                                            <th className="px-4 py-2">Último acesso</th>
                                            <th className="px-4 py-2">Última ação</th>
                                            <th className="px-4 py-2 text-right">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {accessLog.map((u: any) => (
                                            <tr key={u.id} className="border-b border-white/5 hover:bg-white/5">
                                                <td className="px-4 py-2">
                                                    <p className="font-bold text-white">{u.name}</p>
                                                    <p className="text-[10px] text-slate-500">{u.email}</p>
                                                </td>
                                                <td className="px-4 py-2 text-slate-300">{u.type}</td>
                                                <td className="px-4 py-2 text-slate-400 font-mono text-xs">{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString('pt-BR') : '—'}</td>
                                                <td className="px-4 py-2 text-slate-400 font-mono text-xs">{u.last_action_at ? new Date(u.last_action_at).toLocaleString('pt-BR') : '—'}</td>
                                                <td className="px-4 py-2 text-right font-mono text-white">{u.actions_count}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </Card>

                            {/* Feed de atividade (o que cada usuário fez) */}
                            <Card className="bg-slate-900 border-white/5 overflow-hidden">
                                <div className="p-4 border-b border-white/5 bg-slate-800/30">
                                    <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2"><ScrollText className="w-4 h-4 text-indigo-400" /> Trilha de Auditoria ({auditLogs.length})</h3>
                                </div>
                                <div className="divide-y divide-white/5 max-h-[600px] overflow-y-auto">
                                    {loadingAudit ? (
                                        <p className="text-slate-500 text-sm p-6">Carregando…</p>
                                    ) : auditLogs.length === 0 ? (
                                        <p className="text-slate-500 text-sm p-6">Nenhum registro.</p>
                                    ) : auditLogs.map((l: any) => (
                                        <div key={l.id} className="px-4 py-3 flex items-start gap-3 hover:bg-white/5">
                                            <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${l.severity === 'critical' ? 'bg-rose-500' : l.severity === 'warn' ? 'bg-amber-500' : 'bg-slate-500'}`} />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <code className="text-xs font-bold text-indigo-300">{l.action}</code>
                                                    {l.actor_name && <span className="text-xs text-slate-400">por <strong className="text-slate-200">{l.actor_name}</strong></span>}
                                                    <span className="text-[10px] text-slate-600">{l.actorType}</span>
                                                </div>
                                                {l.resourceType && <p className="text-[10px] text-slate-500">recurso: {l.resourceType} {l.resourceId ? `#${String(l.resourceId).substring(0,8)}` : ''}</p>}
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-[10px] text-slate-500 font-mono">{new Date(l.createdAt).toLocaleString('pt-BR')}</p>
                                                {l.ipAddress && <p className="text-[9px] text-slate-600 font-mono">{l.ipAddress}</p>}
                                            </div>
                                        </div>
                                    ))}
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
                            {/* Segurança — criptografia de campos sensíveis em repouso */}
                            <Card className="bg-slate-900 border-white/5 p-6 space-y-3">
                                <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                                    <Lock className="w-6 h-6 text-emerald-400" />
                                    <h3 className="font-bold text-white uppercase tracking-widest text-sm">Criptografia de Dados Sensíveis</h3>
                                </div>
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    Cifra em repouso (AES-256-GCM) os campos legados em texto puro de <strong className="text-slate-200">todas as campanhas</strong>: CPF, RG, título de eleitor, dados bancários/PIX, documento do doador e CPF/CNPJ do candidato. Dados novos já entram cifrados automaticamente — isto é só para os antigos. É <strong className="text-emerald-300">idempotente</strong> (pode rodar de novo sem dano).
                                </p>
                                <p className="text-[11px] text-amber-300/80 leading-relaxed">
                                    Requer <code className="font-mono">FIELD_ENCRYPTION_KEY</code> configurada no servidor.
                                </p>
                                <Button onClick={handleEncryptMigrateAll} disabled={migratingEnc} className="bg-emerald-600 hover:bg-emerald-500 flex items-center gap-2 h-9 text-xs">
                                    <Lock className={`w-4 h-4 ${migratingEnc ? 'animate-pulse' : ''}`} />
                                    {migratingEnc ? 'Cifrando…' : 'Cifrar dados legados (todas as campanhas)'}
                                </Button>
                                {encResult && (
                                    <div className="mt-2 p-3 bg-slate-950 rounded-lg border border-emerald-500/20 text-[11px] text-slate-300 space-y-1">
                                        <p className="text-emerald-400 font-bold">Concluído ✓</p>
                                        {['incomes', 'team_members', 'settings'].map((t) => (
                                            <p key={t}>
                                                <span className="text-slate-500 font-mono">{t}:</span>{' '}
                                                {encResult[t]?.migrated ?? 0} cifrados de {encResult[t]?.scanned ?? 0} verificados
                                            </p>
                                        ))}
                                    </div>
                                )}
                            </Card>

                            {/* Atalho para o Form Builder (a antiga seção estática virou a aba Formulários) */}
                            <Card className="bg-slate-900 border-white/5 p-6 space-y-3">
                                <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                                    <Layout className="w-6 h-6 text-indigo-400" />
                                    <h3 className="font-bold text-white uppercase tracking-widest text-sm">Estrutura de Formulários</h3>
                                </div>
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    A configuração de campos personalizados (Visitas, Contatos, Pesquisa) e os formulários públicos de captação agora ficam na aba <strong className="text-indigo-300">Formulários</strong>.
                                </p>
                                <Button onClick={() => setActiveTab('forms')} className="h-9 text-xs">Ir para Formulários →</Button>
                            </Card>

                            {/* Planos e Monetização — dados reais da tabela plans */}
                            <Card className="bg-slate-900 border-white/5 p-6 space-y-4">
                                <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                                    <CreditCard className="w-6 h-6 text-amber-400" />
                                    <h3 className="font-bold text-white uppercase tracking-widest text-sm">Planos e Monetização</h3>
                                    <span className="text-[10px] text-slate-500">{plans.length} planos ativos</span>
                                </div>
                                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
                                    {plans.length === 0 && <p className="text-xs text-slate-500">Carregando planos…</p>}
                                    {plans.map((p: any) => (
                                        <div key={p.id} className="p-4 bg-slate-950 rounded-xl border border-white/5 flex flex-col">
                                            <div className="flex items-baseline justify-between">
                                                <p className="text-sm font-black text-white">{p.name}</p>
                                                <p className="text-[10px] text-slate-600 font-mono">{(p.features?.length ?? 0)} módulos</p>
                                            </div>
                                            <p className="text-2xl font-black text-amber-400 mt-1">
                                                R$ {((p.monthlyCents ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
                                                <span className="text-[10px] text-slate-500 font-medium">/mês</span>
                                            </p>
                                            <div className="grid grid-cols-2 gap-1 mt-3 text-[10px] text-slate-400">
                                                <span>Contatos: <strong className="text-slate-200">{fmtLimit(p.limits?.contacts)}</strong></span>
                                                <span>Equipe: <strong className="text-slate-200">{fmtLimit(p.limits?.team_users)}</strong></span>
                                                <span>IA: <strong className="text-slate-200">{
                                                    p.limits?.ai_budget_cents === -1 ? 'Ilimitada'
                                                    : p.limits?.ai_budget_cents === 0 ? 'Zero'
                                                    : 'Limitada'
                                                }</strong></span>
                                                <span title="Conta apenas disparos em massa (blast). Caixa de Entrada e Call Center NÃO consomem cota.">
                                                  Disparos: <strong className="text-slate-200">{
                                                    p.limits?.blasts_per_month === -1 ? '∞ /mês'
                                                    : p.limits?.blasts_per_month === 0 ? '— (não inclui)'
                                                    : `${Number(p.limits?.blasts_per_month ?? 0).toLocaleString('pt-BR')} /mês`
                                                }</strong></span>
                                            </div>
                                            <div className="flex flex-wrap gap-1 mt-3 pt-3 border-t border-white/5">
                                                {(p.features ?? []).map((f: string) => (
                                                    <span key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                                                        {FEATURE_LABELS[f] || f}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}

                                    {/* Plano do App Partido — produto próprio (module_prices), separado dos planos de campanha */}
                                    <div className="p-4 bg-slate-950 rounded-xl border border-violet-500/20 flex flex-col">
                                        <div className="flex items-baseline justify-between">
                                            <p className="text-sm font-black text-white">Plano Partido</p>
                                            <p className="text-[10px] text-violet-300/70 font-mono">app Partido</p>
                                        </div>
                                        <p className="text-2xl font-black text-violet-300 mt-1">
                                            R$ {((partidoPriceCents ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
                                            <span className="text-[10px] text-slate-500 font-medium">/mês</span>
                                        </p>
                                        <p className="text-[10px] text-slate-500 mt-1">Assinatura do presidente do partido. Cobrança e cortesia na aba <strong className="text-violet-300">Partidos</strong>.</p>
                                        <div className="flex flex-wrap gap-1 mt-3 pt-3 border-t border-white/5">
                                            {['Painel do Presidente', 'Candidatos', 'Repasses', 'Comprovação', 'Telão'].map((f) => (
                                                <span key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 border border-violet-500/20">{f}</span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <p className="text-[10px] text-slate-600">Preços e módulos vêm da tabela <code>plans</code> (fonte de verdade do faturamento). Cada plano superior inclui os módulos dos inferiores. O <strong className="text-violet-300">Plano Partido</strong> é produto próprio (<code>module_prices</code>), gerido na aba Partidos.</p>
                            </Card>

                            <TseKeysPanel />
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>

            {/* Modals */}

            {/* AI Consultant — modal só para loading/erro; relatório pronto vira full-screen */}
            <Modal
                isOpen={showAnalysisModal && (!!analyzingId || !!analysis?.error)}
                onClose={() => setShowAnalysisModal(false)}
                title={`CONSULTOR IA — ${analysisCampaign}`}
            >
                <div className="p-4 text-slate-200">
                    {analyzingId ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <div className="w-12 h-12 rounded-full border-4 border-slate-700 border-t-indigo-500 animate-spin" />
                            <p className="text-sm text-slate-400">Consultor analisando os dados da campanha…</p>
                            <p className="text-[10px] text-slate-600">Funil de conversão, SWOT, diagnóstico por fase</p>
                        </div>
                    ) : analysis?.error ? (
                        <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded text-rose-400 text-sm">
                            {analysis.error}
                        </div>
                    ) : null}
                </div>
            </Modal>

            {/* Relatório de consultoria — full-screen, imprimível, padrão da plataforma */}
            {showAnalysisModal && !analyzingId && analysis && !analysis.error && (
                <ConsultantReport
                    campaignName={analysisCampaign}
                    result={analysis}
                    onClose={() => setShowAnalysisModal(false)}
                />
            )}

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

                        {/* Custom Fields — agora geridos no Form Builder (F5) */}
                        <div className="space-y-3">
                            <h4 className="text-[10px] font-black uppercase text-indigo-400 border-b border-indigo-500/20 pb-1">Campos Personalizáveis</h4>
                            <div className="flex flex-wrap gap-2 text-[10px]">
                                {(['visits', 'contacts', 'pesquisa'] as const).map((t) => (
                                    <span key={t} className="px-2 py-1 rounded bg-slate-950 border border-white/5 text-slate-400">
                                        {t === 'visits' ? 'Visitas' : t === 'contacts' ? 'Contatos' : 'Pesquisa'}: <strong className="text-slate-200">{(campaignConfigs[showConfigModal]?.customFields?.[t]?.length) || 0}</strong>
                                    </span>
                                ))}
                            </div>
                            <Button
                                variant="ghost"
                                className="w-full h-8 text-[10px] border-dashed border-white/10"
                                onClick={() => { setShowConfigModal(null); setActiveTab('forms'); }}
                            >
                                Editar no Form Builder →
                            </Button>
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
