import * as React from 'react';
import { useAuth } from './contexts/AuthContext';
import CampaignWebApp from './CampaignWebApp';
import { DataProvider } from './contexts/DataContext';
import SupporterPage from './pages/SupporterPage';
import ResearcherPage from './pages/ResearcherPage';
import CandidateDashboardPage from './pages/CandidateDashboardPage';
import LeaderDashboardPage from './pages/LeaderDashboardPage';
import SupremeAdminPage from './pages/SupremeAdminPage';
import BlockedPage from './pages/BlockedPage';
import LoadingScreen from './components/ui/LoadingScreen';

/**
 * Componente principal autenticado da plataforma Campanha Pró.
 * Roteia o usuário para o layout específico baseado no seu tipo (Admin, Candidato, Pesquisador, etc).
 */
const App: React.FC = () => {
    const { user, isInitializing, userType } = useAuth();

    if (isInitializing) {
        return <LoadingScreen />;
    }

    // Se não houver usuário, as rotas (routes.tsx) já redirecionam para o login.
    if (!user) return null;

    // Prioridade máxima: Gestor da Plataforma (Supreme Admin)
    if (user?.isSupremeAdmin) {
        return <SupremeAdminPage />;
    }

    // Conta bloqueada — sai antes de qualquer outra view
    if (userType === 'blocked') {
        return <BlockedPage />;
    }

    // Roteamento por tipo de usuário (Profile-based)
    switch (userType) {
        case 'Admin':
        case 'Coordenador':
            return <CampaignWebApp />;

        case 'Candidato':
            return (
                <DataProvider>
                    <CandidateDashboardPage />
                </DataProvider>
            );

        case 'Líder':
            return (
                <DataProvider>
                    <LeaderDashboardPage />
                </DataProvider>
            );

        case 'Pesquisador':
            return (
                <DataProvider>
                    <ResearcherPage />
                </DataProvider>
            );

        default:
            // 'Apoiador', 'Colaborador', 'Suporte', 'Manutenção'
            return (
                <DataProvider>
                    <SupporterPage />
                </DataProvider>
            );
    }
};

export default App;
