import * as React from 'react';
import { supabase } from '../lib/supabaseClient';
import { handleSupabaseError, sanitizeData, OperationType } from '../utils/supabaseUtils';
import { authedFetch } from '../lib/authedFetch';
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
            // campaignDetails vem pelo backend: CPF/CNPJ/RG do candidato são
            // decifrados lá (a chave não existe no browser). Logos vêm junto.
            // Realtime abaixo só dispara este refetch.
            try {
                const resp = await authedFetch('/api/v1/settings');
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                if (data.campaignDetails) setCampaignDetails(data.campaignDetails as CampaignDetails);
                if (data.headerLogo) setHeaderLogo(data.headerLogo);
                if (data.footerLogo) setFooterLogo(data.footerLogo);
            } catch (error) {
                handleSupabaseError(error, OperationType.GET, `settings/${user.campaignId}`);
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
                { event: '*', schema: 'public', table: 'settings', filter: `campaignId=eq.${user.campaignId}` },
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
            const { error } = await supabase
                .from('settings')
                .upsert({
                    campaignId: user.campaignId,
                    ...sanitizeData(updates),
                    updatedAt: new Date().toISOString()
                }, { onConflict: 'campaignId' });

            if (error) throw error;
        } catch (error) {
            handleSupabaseError(error, OperationType.WRITE, `settings/${user.campaignId}`);
        }
    };

    const updateCampaignDetails = async (details: CampaignDetails) => {
        if (!user?.campaignId) return;
        // Backend cifra CPF/CNPJ/RG do candidato antes de gravar.
        try {
            const resp = await authedFetch('/api/v1/settings/campaign-details', {
                method: 'PUT',
                body: JSON.stringify({ campaignDetails: sanitizeData(details) }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            setCampaignDetails(details);
        } catch (error) {
            handleSupabaseError(error, OperationType.WRITE, `settings/${user.campaignId}`);
        }
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
