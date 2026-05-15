import * as React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import App from './App';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import PublicChatPage from './pages/PublicChatPage';
import PublicColinhaPage from './pages/PublicColinhaPage';
import PublicCapturePage from './pages/PublicCapturePage';
import PublicTeamRegistrationPage from './pages/PublicTeamRegistrationPage';
import UseCasesPage from './pages/UseCasesPage';

/**
 * Definição centralizada de rotas para a plataforma Campanha Pró.
 * Gerencia a navegação profissional e proteção de rotas.
 */
export const AppRoutes: React.FC = () => {
    const { user, isInitializing } = useAuth();

    if (isInitializing) {
        return <div className="min-h-screen bg-slate-900" />;
    }

    return (
        <BrowserRouter>
            <Routes>
                {/* Rotas Públicas */}
                <Route path="/" element={<LandingPage />} />
                
                {/* Se o usuário já está logado, redireciona do Login/Registro para o App */}
                <Route 
                    path="/login" 
                    element={user ? <Navigate to="/app" replace /> : <LoginPage />} 
                />
                <Route 
                    path="/register" 
                    element={user ? <Navigate to="/app" replace /> : <RegisterPage />} 
                />
                
                <Route path="/forgot-password" element={<ForgotPasswordPage onNavigateToLogin={() => window.location.href = '/login'} />} />
                <Route path="/chat" element={<PublicChatPage onBack={() => window.history.back()} />} />
                <Route path="/colinha" element={<PublicColinhaPage uid={new URLSearchParams(window.location.search).get('colinha') || ''} onBack={() => window.history.back()} />} />
                <Route path="/cadastro" element={<PublicCapturePage />} />
                <Route path="/cadastro-equipe/:campaignId" element={<PublicTeamRegistrationPage />} />
                <Route path="/casos-de-uso" element={<UseCasesPage />} />
                <Route path="/demonstracao" element={<UseCasesPage />} />

                {/* Rota Privada (Main App) */}
                <Route 
                    path="/app/*" 
                    element={user ? <App /> : <Navigate to="/login" replace />} 
                />

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
};
