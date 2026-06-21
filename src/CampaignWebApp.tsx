import * as React from 'react';
import { DataProvider } from './contexts/DataContext';
import { useSettings } from './contexts/SettingsContext';
import { useLocalStorage } from './hooks/useLocalStorage';
import { LOCAL_STORAGE_KEYS } from './constants';
import { useAuth } from './contexts/AuthContext';
import { useProfilePermissions } from './contexts/PermissionsContext';
import Header from './components/Header';
import ElectionCountdownBanner from './components/plan/ElectionCountdownBanner';
import AiTrialUnlockNotice from './components/plan/AiTrialUnlockNotice';
import Tabs from './components/Tabs';
import GuidedTour from './components/ui/GuidedTour';
import ErrorBoundary from './components/dev/ErrorBoundary';

// Lazy load all pages to improve initial load time and isolate module errors
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'));
const AgentsHQPage = React.lazy(() => import('./pages/AgentsHQPage'));
const CalculatorPage = React.lazy(() => import('./pages/CalculatorPage'));
const VisitsPage = React.lazy(() => import('./pages/VisitsPage'));
const EngagementPage = React.lazy(() => import('./pages/EngagementPage'));
const ResourcesPage = React.lazy(() => import('./pages/ResourcesPage'));
const TeamsPage = React.lazy(() => import('./pages/TeamsPage'));
const FinancialPage = React.lazy(() => import('./pages/FinancialPage'));
const TrainingPage = React.lazy(() => import('./pages/TrainingPage'));
const ToolsPage = React.lazy(() => import('./pages/ToolsPage'));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage'));
const HelpPage = React.lazy(() => import('./pages/HelpPage'));
const PermissionsPage = React.lazy(() => import('./pages/PermissionsPage'));
const ElectionDayPage = React.lazy(() => import('./pages/ElectionDayPage'));
const CampaignMapPage = React.lazy(() => import('./pages/CampaignMapPage'));
const ApuracaoLiveDashboard = React.lazy(() => import('./components/election/ApuracaoLiveDashboard'));
const ElectionReportsPage = React.lazy(() => import('./pages/ElectionReportsPage'));
const CRMPage = React.lazy(() => import('./pages/CRMPage'));
const IntelligencePage = React.lazy(() => import('./pages/IntelligencePage'));
const AgentTasksPage = React.lazy(() => import('./pages/AgentTasksPage'));
const InboxPage = React.lazy(() => import('./pages/InboxPage'));
const ScenariosPage = React.lazy(() => import('./pages/ScenariosPage'));
const CompliancePage = React.lazy(() => import('./pages/CompliancePage'));
const BillingPage = React.lazy(() => import('./pages/BillingPage'));
const GoalsPage = React.lazy(() => import('./pages/GoalsPage'));
const RoutinesPage = React.lazy(() => import('./pages/RoutinesPage'));
const MeetingsPage = React.lazy(() => import('./pages/MeetingsPage'));
const ContentStudioPage = React.lazy(() => import('./pages/ContentStudioPage'));
const ShortLinksPage = React.lazy(() => import('./pages/ShortLinksPage'));
const LegalShieldPage = React.lazy(() => import('./pages/LegalShieldPage'));

// Import Icons for Tabs
import { Bot, ShieldCheck, Brain, Cpu, Inbox, FlaskConical, CreditCard, Target, RefreshCw, CalendarDays, Sparkles, Link2, ShieldAlert } from 'lucide-react';
import { useActiveModules } from './hooks/useActiveModules';
import {
    BarChartIcon, CalculatorIcon, ClipboardListIcon, SparklesIcon,
    UsersGroupIcon, CurrencyDollarIcon, AcademicCapIcon, CogIcon,
    QuestionMarkCircleIcon, ToolsIcon, ChartBarIcon, MapIcon
} from './components/icons';

const AdminApp: React.FC = () => {
    const { headerLogo } = useSettings();
    const { userType } = useAuth();
    const { permissions, config, isLoading } = useProfilePermissions();
    // Add-ons avulsos (ex.: Blindagem) ativam por entitlement, não por plano —
    // fonte autoritativa é /api/v1/modules/me (.active).
    const { active: activeModules } = useActiveModules();

    // Filtro de abas por perfil e funcionalidades habilitadas
    const tabs = React.useMemo(() => {
        if (!permissions || !userType) return [];

        // 'Candidato de Partido' opera como coordenador na plataforma cortesia.
        const isAdmin = userType === 'Admin' || userType === 'Coordenador' || userType === 'Candidato de Partido';

        // Abas de add-on avulso: independem do tier; dependem do módulo ativo
        // (entitlement) + perfil de gestão (dados sensíveis).
        const isManager = userType === 'Admin' || userType === 'Coordenador';
        const addonTabs: string[] = [];
        if (isManager && activeModules.includes('legal_shield')) addonTabs.push('Blindagem');
        const withAddons = (list: string[]) => [...new Set([...list, ...addonTabs])];

        // 1. Permissões básicas do perfil
        let allowedTabs = permissions[userType] || ['Dashboard'];

        // Mapa COMPLETO: feature key (plano) → abas do app
        const featureToTabMap: { [key: string]: string[] } = {
            dashboard: ['Dashboard'], crm: ['CRM'], help: ['Ajuda'], visits: ['Visitas'],
            team: ['Equipes'], engagement: ['Engajamento'], resources: ['Recursos'],
            goals: ['Objetivos'], routines: ['Rotinas'], ai_agents: ['Agentes IA'],
            analytics: ['Analytics'], financial: ['Financeiro'], content_studio: ['Estúdio'],
            meetings: ['Reuniões'], tools: ['Calculadora', 'Ferramentas'], training: ['Treinamento'],
            whatsapp_omnichannel: ['Caixa de Entrada'], election_day: ['Dia das Eleições', 'Apuração ao Vivo'],
            intelligence: ['Inteligência', 'Mapa da Campanha'], scenarios: ['Cenários'], budget_ceo: ['Plano'],
            paperclip: ['Agentes (Tarefas)'], compliance: ['Conformidade'],
        };
        // Abas de gestão sempre liberadas (qualquer plano) — evita lock-out do admin.
        const ALWAYS = ['Dashboard', 'Permissões', 'Configurações', 'Ajuda', 'Links Curtos'];
        // Conjunto completo de abas do admin (plano Total / sem restrição).
        const FULL_ADMIN = [
            'Dashboard', 'Agentes IA', 'Calculadora', 'Visitas', 'Engajamento',
            'Recursos', 'Equipes', 'Financeiro', 'Treinamento', 'Ferramentas',
            'Permissões', 'Configurações', 'Ajuda', 'Dia das Eleições',
            'Analytics', 'CRM', 'Inteligência', 'Mapa da Campanha', 'Apuração ao Vivo', 'Caixa de Entrada', 'Agentes (Tarefas)',
            'Cenários', 'Conformidade', 'Plano', 'Objetivos', 'Rotinas', 'Reuniões', 'Estúdio', 'Links Curtos',
        ];

        // Total (planTier 'completo') ou sem config (VIP/dev) → libera tudo.
        if (!config?.features || config.planTier === 'completo') {
            if (isAdmin) return withAddons(FULL_ADMIN);
            return withAddons(allowedTabs.length > 0 ? allowedTabs : ['Dashboard']);
        }

        // Essencial / Estratégico ('limitado') → gateia TODOS (inclusive Admin) pelos módulos do plano.
        const enabledTabs = [...ALWAYS];
        config.features.forEach(feat => {
            if (featureToTabMap[feat]) enabledTabs.push(...featureToTabMap[feat]);
        });
        allowedTabs = (isAdmin ? FULL_ADMIN : allowedTabs).filter(tab => enabledTabs.includes(tab));

        return withAddons(allowedTabs.length > 0 ? allowedTabs : ['Dashboard']);
    }, [userType, permissions, config, activeModules]);

    const iconMap = {
        Dashboard: <BarChartIcon className="h-5 w-5" />,
        'Agentes IA': <Bot className="h-5 w-5" />,
        Calculadora: <CalculatorIcon className="h-5 w-5" />,
        Visitas: <ClipboardListIcon className="h-5 w-5" />,
        Engajamento: <SparklesIcon className="h-5 w-5" />,
        Recursos: <UsersGroupIcon className="h-5 w-5" />,
        Equipes: <UsersGroupIcon className="h-5 w-5" />,
        Financeiro: <CurrencyDollarIcon className="h-5 w-5" />,
        Treinamento: <AcademicCapIcon className="h-5 w-5" />,
        Ferramentas: <ToolsIcon className="h-5 w-5" />,
        Permissões: <ShieldCheck className="h-5 w-5" />,
        Configurações: <CogIcon className="h-5 w-5" />,
        Ajuda: <QuestionMarkCircleIcon className="h-5 w-5" />,
        'Dia das Eleições': <MapIcon className="h-5 w-5" />,
        Analytics: <ChartBarIcon className="h-5 w-5" />,
        CRM: <UsersGroupIcon className="h-5 w-5" />,
        Inteligência: <Brain className="h-5 w-5" />,
        'Mapa da Campanha': <MapIcon className="h-5 w-5" />,
        'Apuração ao Vivo': <BarChartIcon className="h-5 w-5" />,
        'Caixa de Entrada': <Inbox className="h-5 w-5" />,
        'Agentes (Tarefas)': <Cpu className="h-5 w-5" />,
        'Cenários': <FlaskConical className="h-5 w-5" />,
        'Conformidade': <ShieldCheck className="h-5 w-5" />,
        'Plano': <CreditCard className="h-5 w-5" />,
        'Objetivos': <Target className="h-5 w-5" />,
        'Rotinas': <RefreshCw className="h-5 w-5" />,
        'Reuniões': <CalendarDays className="h-5 w-5" />,
        'Estúdio': <Sparkles className="h-5 w-5" />,
        'Links Curtos': <Link2 className="h-5 w-5" />,
        'Blindagem': <ShieldAlert className="h-5 w-5" />,
    };

    // Componentes mapeados para as abas (deve seguir a ordem lógica do ALL_TABS para o componente Tabs indexar corretamente)
    const pageMap: { [key: string]: React.ReactNode } = {
        'Dashboard': <DashboardPage />,
        'Agentes IA': <AgentsHQPage />,
        'Calculadora': <CalculatorPage />,
        'Visitas': <VisitsPage />,
        'Engajamento': <EngagementPage />,
        'Recursos': <ResourcesPage />,
        'Equipes': <TeamsPage />,
        'Financeiro': <FinancialPage />,
        'Treinamento': <TrainingPage />,
        'Ferramentas': <ToolsPage />,
        'Permissões': <PermissionsPage />,
        'Configurações': <SettingsPage />,
        'Ajuda': <HelpPage />,
        'Dia das Eleições': <ElectionDayPage />,
        'Analytics': <ElectionReportsPage />,
        'CRM': <CRMPage />,
        'Inteligência': <IntelligencePage />,
        'Mapa da Campanha': <CampaignMapPage />,
        'Apuração ao Vivo': <ApuracaoLiveDashboard />,
        'Caixa de Entrada': <InboxPage />,
        'Agentes (Tarefas)': <AgentTasksPage />,
        'Cenários': <ScenariosPage />,
        'Conformidade': <CompliancePage />,
        'Plano': <BillingPage />,
        'Objetivos': <GoalsPage />,
        'Rotinas': <RoutinesPage />,
        'Reuniões': <MeetingsPage />,
        'Estúdio': <ContentStudioPage />,
        'Links Curtos': <ShortLinksPage />,
        'Blindagem': <LegalShieldPage />,
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-800 text-slate-50 font-sans">
                <Header logoUrl={headerLogo} />
                <main className="container mx-auto p-4 sm:p-6 md:p-8">
                    <div className="flex space-x-2 animate-pulse border-b border-slate-700 pb-2 mb-4">
                        <div className="w-24 h-8 bg-slate-700 rounded-md"></div>
                        <div className="w-32 h-8 bg-slate-700 rounded-md"></div>
                        <div className="w-20 h-8 bg-slate-700 rounded-md"></div>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-800 text-slate-50 font-sans">
            <Header logoUrl={headerLogo} />
            <ElectionCountdownBanner />
            <AiTrialUnlockNotice />
            <main className="container mx-auto p-4 sm:p-6 md:p-8">
                <Tabs tabs={tabs} iconMap={iconMap}>
                    {tabs.map(tab => (
                        <ErrorBoundary key={tab} label={tab}>{pageMap[tab]}</ErrorBoundary>
                    ))}
                </Tabs>
            </main>
        </div>
    );
};

const CampaignWebApp: React.FC = () => {
    const [hasSeenTour, setHasSeenTour] = useLocalStorage(LOCAL_STORAGE_KEYS.HAS_SEEN_TOUR, false);
    const [isTourOpen, setIsTourOpen] = React.useState(!hasSeenTour);
    
    const handleCloseTour = () => {
        setIsTourOpen(false);
        setHasSeenTour(true);
    };

    return (
        <DataProvider>
            <GuidedTour isOpen={isTourOpen} onClose={handleCloseTour} />
            <AdminApp />
        </DataProvider>
    );
};

export default CampaignWebApp;