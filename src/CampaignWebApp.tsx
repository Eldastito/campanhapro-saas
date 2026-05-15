import * as React from 'react';
import { DataProvider } from './contexts/DataContext';
import { useSettings } from './contexts/SettingsContext';
import { useLocalStorage } from './hooks/useLocalStorage';
import { LOCAL_STORAGE_KEYS } from './constants';
import { useAuth } from './contexts/AuthContext';
import { useProfilePermissions } from './contexts/PermissionsContext';
import Header from './components/Header';
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
const ElectionReportsPage = React.lazy(() => import('./pages/ElectionReportsPage'));
const CRMPage = React.lazy(() => import('./pages/CRMPage'));
const IntelligencePage = React.lazy(() => import('./pages/IntelligencePage'));

// Import Icons for Tabs
import { Bot, ShieldCheck, Brain } from 'lucide-react';
import {
    BarChartIcon, CalculatorIcon, ClipboardListIcon, SparklesIcon,
    UsersGroupIcon, CurrencyDollarIcon, AcademicCapIcon, CogIcon,
    QuestionMarkCircleIcon, ToolsIcon, ChartBarIcon, MapIcon
} from './components/icons';

const AdminApp: React.FC = () => {
    const { headerLogo } = useSettings();
    const { userType } = useAuth();
    const { permissions, config, isLoading } = useProfilePermissions();

    // Filtro de abas por perfil e funcionalidades habilitadas
    const tabs = React.useMemo(() => {
        if (!permissions || !userType) return [];
        
        // 1. Considera as permissões básicas do perfil
        let allowedTabs = permissions[userType] || ['Dashboard'];
        
        // 2. Filtra com base nas funcionalidades habilitadas para a campanha (venda/plano)
        // REGRA: Admins veem tudo o que o perfil permite. Outros perfis são filtrados pelo plano da campanha.
        if (config?.features && userType !== 'Admin' && userType !== 'Coordenador') {
            const featureToTabMap: { [key: string]: string[] } = {
                'ai_agents': ['Agentes IA'],
                'visits': ['Visitas'],
                'team': ['Equipes'],
                'financial': ['Financeiro'],
                'dashboard': ['Dashboard'],
                'engagement': ['Engajamento'],
                'training': ['Treinamento'],
                'help': ['Ajuda'],
                'tools': ['Calculadora', 'Ferramentas'],
                'resources': ['Recursos'],
                'crm': ['CRM'],
                'analytics': ['Analytics'],
                'election_day': ['Dia das Eleições']
            };

            const enabledTabs = ['Permissões', 'Configurações']; 
            
            config.features.forEach(feat => {
                if (featureToTabMap[feat]) {
                    enabledTabs.push(...featureToTabMap[feat]);
                } else {
                    enabledTabs.push(feat);
                }
            });

            allowedTabs = allowedTabs.filter(tab => enabledTabs.includes(tab));
        }
        
        // Garantia final para Admin
        if (userType === 'Admin' || userType === 'Coordenador') {
            // 'Planos' e 'Demonstração' foram movidos para a Landing pública
            // (rotas /planos e /demonstracao). Não aparecem mais como abas do app.
            const mandatory = [
                'Dashboard', 'Agentes IA', 'Calculadora', 'Visitas', 'Engajamento',
                'Recursos', 'Equipes', 'Financeiro', 'Treinamento', 'Ferramentas',
                'Permissões', 'Configurações', 'Ajuda', 'Dia das Eleições',
                'Analytics', 'CRM', 'Inteligência'
            ];
            mandatory.forEach(tab => {
                if (!allowedTabs.includes(tab)) allowedTabs.push(tab);
            });
        }

        return allowedTabs.length > 0 ? allowedTabs : ['Dashboard'];
    }, [userType, permissions, config]);

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