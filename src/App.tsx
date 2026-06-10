import * as React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useProfilePermissions } from './contexts/PermissionsContext';
import CampaignWebApp from './CampaignWebApp';
import { DataProvider } from './contexts/DataContext';
import SupporterPage from './pages/SupporterPage';
import ResearcherPage from './pages/ResearcherPage';
import CandidateDashboardPage from './pages/CandidateDashboardPage';
import LeaderDashboardPage from './pages/LeaderDashboardPage';
import FiscalPage from './pages/FiscalPage';
import PartyPresidentPage from './pages/PartyPresidentPage';
import PartyCandidatePage from './pages/PartyCandidatePage';
import SupremeAdminPage from './pages/SupremeAdminPage';
import BlockedPage from './pages/BlockedPage';
import LoadingScreen from './components/ui/LoadingScreen';

/**
 * Componente principal autenticado da plataforma Campanha Pró.
 * Roteia o usuário para o layout específico baseado no seu tipo (Admin, Candidato, Pesquisador, etc).
 */
const App: React.FC = () => {
    const { user, isInitializing, userType } = useAuth();
    const { config, isLoading: permsLoading } = useProfilePermissions();

    if (isInitializing) {
        return <LoadingScreen />;
    }

    // Se não houver usuário, as rotas (routes.tsx) já redirecionam para o login.
    if (!user) return null;

    // Prioridade máxima: Gestor da Plataforma (Supreme Admin) — nunca é barrado.
    if (user?.isSupremeAdmin) {
        return <SupremeAdminPage />;
    }

    // Conta bloqueada — sai antes de qualquer outra view
    if (userType === 'blocked') {
        return <BlockedPage />;
    }

    // Onboarding pago: campanha sem pagamento confirmado não acessa o app.
    // Só barra quando sabemos que está pendente (fail-open enquanto carrega/sem config).
    if (permsLoading) {
        return <LoadingScreen />;
    }
    if (config?.status === 'pending_payment') {
        return <Navigate to="/assinar" replace />;
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

        case 'Fiscal':
            return (
                <DataProvider>
                    <FiscalPage />
                </DataProvider>
            );

        case 'Presidente de Partido':
            // Produto PARTIDO — não usa DataProvider (campanha); carrega o próprio agregado.
            return <PartyPresidentPage />;

        case 'Candidato de Partido':
            // Candidato dentro do partido — experiência enxuta de comprovação.
            return <PartyCandidatePage />;

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
