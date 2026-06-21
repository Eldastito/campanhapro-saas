import * as React from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';

export interface ProfilePermissions {
    [role: string]: string[]; // role -> list of allowed tabs
}

export interface CustomField {
    id: string;
    label: string;
    type: 'text' | 'number' | 'select' | 'boolean';
    options?: string[];
    required: boolean;
}

export interface CampaignConfig {
    id: string;
    features: string[];
    limits: {
        aiCalls: number;
        teamMembers: number;
        visits: number;
    };
    customFields: Record<string, CustomField[]>;
    profilePermissions?: ProfilePermissions;
    status: 'active' | 'blocked' | 'pending_payment';
    planTier: 'limitado' | 'completo';
}

interface PermissionsContextType {
    permissions: ProfilePermissions | null;
    config: CampaignConfig | null;
    updatePermissions: (newPermissions: ProfilePermissions) => Promise<void>;
    updateConfig: (updates: Partial<CampaignConfig>) => Promise<void>;
    hasFeature: (feature: string) => boolean;
    isLoading: boolean;
}

const PermissionsContext = React.createContext<PermissionsContextType | undefined>(undefined);

// Perfis 'Candidato', 'Suporte', 'Manutenção' e 'blocked' têm página dedicada
// (CandidateDashboardPage / SupporterPage / BlockedPage em src/App.tsx) e
// não consomem este mapa de permissões — listamos só os que usam o CampaignWebApp
// ou caem no SupporterPage como Apoiador/Colaborador/Pesquisador.
export const DEFAULT_PERMISSIONS: ProfilePermissions = {
    'Admin':       ['Dashboard', 'Agentes IA', 'Calculadora', 'Visitas', 'Engajamento', 'Recursos', 'Equipes', 'Financeiro', 'Treinamento', 'Ferramentas', 'Dia das Eleições', 'Analytics', 'CRM', 'Permissões', 'Configurações', 'Ajuda'],
    'Coordenador': ['Dashboard', 'Agentes IA', 'Calculadora', 'Visitas', 'Engajamento', 'Recursos', 'Equipes', 'Financeiro', 'Treinamento', 'Ferramentas', 'Dia das Eleições', 'Analytics', 'CRM', 'Permissões', 'Configurações', 'Ajuda'],
    'Líder':       ['Dashboard', 'Agentes IA', 'Visitas', 'Engajamento', 'Recursos', 'Equipes', 'Treinamento', 'Ajuda'],
    'Apoiador':    ['Dashboard', 'Visitas', 'Engajamento', 'Ajuda'],
    'Colaborador': ['Dashboard', 'Visitas', 'Ajuda'],
    'Pesquisador': ['Dashboard', 'Visitas', 'Ajuda'],
    // 'Fiscal' = Fiscal de Urna (label visível em todo lugar). Identificador
    // interno mantido pra evitar migration nos users existentes. Página dedicada
    // é o FiscalPage.tsx (não usa essas abas — mas o mapa serve pra Permissions
    // UI mostrar coerência).
    'Fiscal':      ['Dashboard', 'Dia das Eleições', 'Ajuda'],
    'Suporte':     ['Dashboard', 'Visitas', 'Ajuda'],
    'Manutenção':  ['Dashboard', 'Visitas', 'Ajuda'],
    // Candidato de Partido — quando usa a plataforma em modo CORTESIA (Opção B),
    // opera como coordenador (CRM, equipes, visitas, formulários, etc). A
    // fiscalização do partido fica no PartyCandidatePage, fora daqui.
    'Candidato de Partido': ['Dashboard', 'Agentes IA', 'Calculadora', 'Visitas', 'Engajamento', 'Recursos', 'Equipes', 'Financeiro', 'Treinamento', 'Ferramentas', 'Dia das Eleições', 'Analytics', 'CRM', 'Permissões', 'Configurações', 'Ajuda'],
};

export const PLAN_CONFIGS = {
    limitado: {
        aiCalls: 500,
        teamMembers: 100,
        visits: 5000,
        features: ['Dashboard', 'Visitas', 'Equipes', 'Ajuda']
    },
    completo: {
        aiCalls: 999999,
        teamMembers: 999999,
        visits: 999999,
        features: ['Dashboard', 'Agentes IA', 'Calculadora', 'Visitas', 'Engajamento', 'Recursos', 'Equipes', 'Financeiro', 'Treinamento', 'Ferramentas', 'Dia das Eleições', 'Analytics', 'CRM']
    }
};

export const PermissionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const [permissions, setPermissions] = React.useState<ProfilePermissions | null>(null);
    const [config, setConfig] = React.useState<CampaignConfig | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);

    React.useEffect(() => {
        // Sem acesso por e-mail hardcoded: quem não tem campanha não recebe config
        // (vai pro onboarding). Permissões/plano vêm do banco como qualquer conta.
        if (!user?.campaignId) {
            setPermissions(DEFAULT_PERMISSIONS);
            setConfig(null);
            setIsLoading(false);
            return;
        }

        const fetchConfig = async () => {
            try {
                const { data, error } = await supabase
                    .from('campaign_configs')
                    .select('*')
                    .eq('id', user.campaignId)
                    .maybeSingle();
                
                // Governança: acesso vem do campaign_configs do tenant — sem
                // override por e-mail VIP. Plano/limites são a verdade do banco.
                if (error) {
                    console.error("Erro ao carregar campaign_configs:", error);
                    setPermissions(DEFAULT_PERMISSIONS);
                    setConfig(null);
                } else if (data) {
                    const raw: any = data;
                    const configData = { ...raw, customFields: raw.customFields ?? {} } as CampaignConfig;
                    setConfig(configData);
                    setPermissions(configData.profilePermissions || DEFAULT_PERMISSIONS);
                } else {
                    setPermissions(DEFAULT_PERMISSIONS);
                    setConfig(null);
                }
            } catch (err) {
                console.error("Erro crítico no fetchConfig:", err);
                setPermissions(DEFAULT_PERMISSIONS);
                setConfig(null);
            } finally {
                setIsLoading(false);
            }
        };

        fetchConfig();
        
        // Supabase realtime subscription
        const channelId = `schema-db-changes-${user.campaignId}`;
        const channel = supabase.channel(channelId)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'campaign_configs', filter: `id=eq.${user.campaignId}` },
                (_payload: unknown) => fetchConfig()
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user?.campaignId]);

    const updatePermissions = async (newPermissions: ProfilePermissions) => {
        if (!user?.campaignId) return;
        await supabase
            .from('campaign_configs')
            .upsert({ id: user.campaignId, profilePermissions: newPermissions });
    };

    const updateConfig = async (updates: Partial<CampaignConfig>) => {
        if (!user?.campaignId) return;
        await supabase
            .from('campaign_configs')
            .upsert({ id: user.campaignId, ...updates });
    };

    const hasFeature = (feature: string) => {
        if (!config) return true; // Sem config (dev/VIP) → libera
        if (config.planTier === 'completo') return true; // Total → tudo
        // Essencial/Estratégico: checa a feature key na lista do plano
        return (config.features || []).includes(feature);
    };

    return (
        <PermissionsContext.Provider value={{ 
            permissions: permissions || DEFAULT_PERMISSIONS, 
            config, 
            updatePermissions, 
            updateConfig, 
            hasFeature,
            isLoading 
        }}>
            {children}
        </PermissionsContext.Provider>
    );
};

export const useProfilePermissions = () => {
    const context = React.useContext(PermissionsContext);
    if (context === undefined) {
        throw new Error('useProfilePermissions must be used within a PermissionsProvider');
    }
    return context;
};
