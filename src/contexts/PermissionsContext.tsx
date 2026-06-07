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
    status: 'active' | 'blocked';
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
    'Suporte':     ['Dashboard', 'Visitas', 'Ajuda'],
    'Manutenção':  ['Dashboard', 'Visitas', 'Ajuda']
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

const VIP_EMAILS = ['examepad@gmail.com', 'eldastito@gmail.com', 'examepad@teste.com'];

export const PermissionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const [permissions, setPermissions] = React.useState<ProfilePermissions | null>(null);
    const [config, setConfig] = React.useState<CampaignConfig | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);

    React.useEffect(() => {
        const isVIP = VIP_EMAILS.includes(user?.email || '');

        if (!user?.campaignId) {
            // VIP sem campaign_id ainda recebe acesso total
            if (isVIP) {
                setPermissions(DEFAULT_PERMISSIONS);
                setConfig({ planTier: 'completo', features: Object.keys(PLAN_CONFIGS.completo.features) } as any);
            } else {
                setPermissions(DEFAULT_PERMISSIONS);
                setConfig(null);
            }
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
                
                // Para usuários VIP, garantimos acesso total mesmo se a tabela estiver vazia
                const isVIP = VIP_EMAILS.includes(user.email || '');
                
                if (error && !isVIP) {
                    console.error("Erro ao carregar campaign_configs:", error);
                    setPermissions(DEFAULT_PERMISSIONS);
                    setConfig(null);
                } else if (data || isVIP) {
                    const raw: any = data || { id: user.campaignId };
                    let configData = { ...raw, customFields: raw.customFields ?? {} } as CampaignConfig;

                    // VIP Override: Acesso total automático
                    if (isVIP) {
                        configData = {
                            ...configData,
                            planTier: 'completo',
                            features: [
                                'dashboard', 'ai_agents', 'calculator', 'visits', 'engagement',
                                'resources', 'team', 'financial', 'training', 'tools',
                                'permissions', 'settings', 'help', 'election_day',
                                'analytics', 'crm'
                            ],
                            profilePermissions: DEFAULT_PERMISSIONS
                        };
                    }

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
        if (!config) return true; // Se não tem config, libera tudo (modo dev)
        if (config.planTier === 'completo') return true;
        
        // Se for plano limitado, checa se a feature está na lista permitida
        const allowedFeatures = PLAN_CONFIGS.limitado.features;
        return allowedFeatures.includes(feature);
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
