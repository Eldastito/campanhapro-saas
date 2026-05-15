import * as React from 'react';
import { supabase } from '../lib/supabaseClient';
import { handleSupabaseError, sanitizeData, OperationType } from '../utils/supabaseUtils';
import { CampaignDetails } from '../types/campaign';
import { useAuth } from './AuthContext';

interface SettingsContextType {
    campaignDetails: CampaignDetails;
    updateCampaignDetails: (details: CampaignDetails) => Promise<void>;
    headerLogo: string | null;
    updateHeaderLogo: (logo: string | null) => Promise<void>;
    footerLogo: string | null;
    updateFooterLogo: (logo: string | null) => Promise<void>;
}

const SettingsContext = React.createContext<SettingsContextType | undefined>(undefined);

const initialCampaignDetails: CampaignDetails = {
    nomeCompleto: '',
    nomeUrna: '',
    numero: '',
    partido: '',
    cnpj: '',
    cpf: '',
    identidade: '',
    dataNascimento: '',
    estadoCivil: '',
    endereco: '',
    cidade: '',
    estado: '',
    cep: '',
    orcamento: 50000,
    candidatePhotoUrl: ''
};

export const SettingsProvider = ({ children }: { children?: React.ReactNode }) => {
    const { user } = useAuth();
    const [campaignDetails, setCampaignDetails] = React.useState<CampaignDetails>(initialCampaignDetails);
    const [headerLogo, setHeaderLogo] = React.useState<string | null>(null);
    const [footerLogo, setFooterLogo] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!user?.campaignId) return;

        const fetchData = async () => {
            // Filtro pela FK semântica (campaign_id), não pelo PK (id) — id e campaign_id
            // não são garantidamente iguais; apenas a coluna campaign_id é UNIQUE por campanha.
            const { data, error } = await supabase
                .from('settings')
                .select('*')
                .eq('campaignId', user.campaignId)
                .maybeSingle();

            if (error) {
                if (error.code !== 'PGRST116') {
                    handleSupabaseError(error, OperationType.GET, `settings/${user.campaignId}`);
                }
            } else if (data) {
                if (data.campaignDetails) setCampaignDetails(data.campaignDetails as CampaignDetails);
                if (data.headerLogo) setHeaderLogo(data.headerLogo);
                if (data.footerLogo) setFooterLogo(data.footerLogo);
            }
        };

        fetchData();

        // Canal único por execução do effect — evita conflito quando React re-roda
        // o effect (Strict Mode) e tenta registrar callbacks num canal já subscrito.
        const channelId = `settings-changes-${user.campaignId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const channel = supabase.channel(channelId);

        channel
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'settings', filter: `campaign_id=eq.${user.campaignId}` },
                fetchData
            )
            .subscribe();

        return () => {
            try {
                supabase.removeChannel(channel);
            } catch (err) {
                // Silencia erros de cleanup (pode ocorrer se canal já foi removido)
            }
        };
    }, [user?.campaignId]);


    const updateSettings = async (updates: Record<string, any>) => {
        if (!user?.campaignId) return;
        try {
            // onConflict: campaign_id (UNIQUE) — sem isso o supabase tenta conflict
            // pelo PK (id), o que não é o que queremos pra esta tabela.
            const { error } = await supabase
                .from('settings')
                .upsert({
                    campaignId: user.campaignId,
                    ...sanitizeData(updates),
                    updatedAt: new Date().toISOString()
                }, { onConflict: 'campaign_id' });

            if (error) throw error;
        } catch (error) {
            handleSupabaseError(error, OperationType.WRITE, `settings/${user.campaignId}`);
        }
    };

    const updateCampaignDetails = async (details: CampaignDetails) => {
        await updateSettings({ campaignDetails: details });
        setCampaignDetails(details);
    };

    const updateHeaderLogo = async (logo: string | null) => {
        await updateSettings({ headerLogo: logo });
        setHeaderLogo(logo);
    };

    const updateFooterLogo = async (logo: string | null) => {
        await updateSettings({ footerLogo: logo });
        setFooterLogo(logo);
    };

    const value = {
        campaignDetails, updateCampaignDetails,
        headerLogo, updateHeaderLogo,
        footerLogo, updateFooterLogo
    };

    return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export const useSettings = () => {
    const context = React.useContext(SettingsContext);
    if (context === undefined) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
};
