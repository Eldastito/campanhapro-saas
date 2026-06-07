import * as React from 'react';
import { supabase } from '../lib/supabaseClient';
import { Visit } from '../types/visits';
import { EngagementAction } from '../types/engagement';
import { handleSupabaseError, sanitizeData, OperationType } from '../utils/supabaseUtils';
import { logSubmissionGeo } from '../utils/geoTracking';
import { useAuth } from './AuthContext';

/**
 * Cria/atualiza o CONTATO (registro mestre do eleitor) a partir de uma visita,
 * costurando os dados de funil capturados no porta-a-porta. Identidade pelo
 * telefone (chave da jornada). Best-effort: nunca deve impedir salvar a visita.
 * Retorna o id do contato (voterId) ou null.
 */
async function upsertVoterFromVisit(
    campaignId: string,
    visit: any,
    funnel: { voteIntention?: string; voteCertainty?: any; objection?: string; isMultiplier?: any; influenceCount?: any; whatsappOptin?: any },
): Promise<string | null> {
    const phone = (visit.tel || '').trim();
    const name = (visit.resp || '').trim();
    if (!name && !phone) return null;

    const intention = funnel.voteIntention || null;
    const certainty = funnel.voteCertainty === '' || funnel.voteCertainty == null ? null : Number(funnel.voteCertainty);
    const isMult = funnel.isMultiplier === 'sim' || funnel.isMultiplier === true;
    const influence = isMult ? (Number(funnel.influenceCount) || 0) : 0;
    const optin = funnel.whatsappOptin === 'sim' || funnel.whatsappOptin === true;
    const objection = (funnel.objection || '').trim() || null;
    const now = new Date().toISOString();

    // Identidade: procura contato por telefone na campanha.
    let existingId: string | null = null;
    if (phone) {
        const { data } = await supabase.from('contacts').select('id')
            .eq('campaignId', campaignId).eq('phone', phone).limit(1).maybeSingle();
        existingId = (data as any)?.id ?? null;
    }

    if (existingId) {
        // Atualiza só o que veio preenchido (não apaga dados já existentes).
        const upd: any = { lastInteractionAt: now };
        if (intention) upd.voteIntention = intention;
        if (certainty != null) upd.voteCertainty = certainty;
        if (objection) upd.objection = objection;
        if (isMult) { upd.isMultiplier = true; upd.influenceCount = influence; }
        if (optin) upd.whatsappOptin = true;
        if (visit.bairro) upd.neighborhood = visit.bairro;
        if (visit.municipio) upd.city = visit.municipio;
        await supabase.from('contacts').update(upd).eq('id', existingId);
        return existingId;
    }

    const { data: created, error } = await supabase.from('contacts').insert({
        campaignId,
        name: name || 'Eleitor (visita)',
        phone: phone || null,
        neighborhood: visit.bairro || null,
        city: visit.municipio || null,
        birthDate: visit.nasc || null,
        source: 'visita',
        funnelStage: 'relacionamento',
        voteIntention: intention,
        voteCertainty: certainty,
        objection,
        isMultiplier: isMult,
        influenceCount: influence,
        whatsappOptin: optin,
        lastInteractionAt: now,
        createdAt: now,
    }).select('id').single();
    if (error) throw error;
    return (created as any)?.id ?? null;
}

interface VisitsContextType {
    visits: Visit[];
    addVisit: (visit: Omit<Visit, 'id'>) => Promise<void>;
    updateVisit: (visit: Visit) => Promise<void>;
    deleteVisit: (id: string | number) => Promise<void>;
    engagementActions: EngagementAction[];
    addEngagementAction: (action: Omit<EngagementAction, 'id'>) => Promise<void>;
    isLoading: boolean;
}

const VisitsContext = React.createContext<VisitsContextType | undefined>(undefined);

export const VisitsProvider = ({ children }: { children?: React.ReactNode }) => {
    const { user } = useAuth();
    const [visits, setVisits] = React.useState<Visit[]>([]);
    const [engagementActions, setEngagementActions] = React.useState<EngagementAction[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);

    React.useEffect(() => {
        if (!user) return;
        const currentCampaignId = user.campaignId;
        if (!currentCampaignId) return;

        const buildVisitsQuery = () => {
            let query = supabase
                .from('visits')
                .select('*')
                .eq('campaignId', currentCampaignId)
                .order('data', { ascending: false });

            if (user.type === 'Líder') {
                query = query.eq('leaderId', user.uid);
            }
            return query;
        };

        const buildEngagementQuery = () => {
             return supabase
                .from('engagement_actions')
                .select('*')
                .eq('campaignId', currentCampaignId)
                .order('data', { ascending: false });
        };

        const fetchVisits = async () => {
            const { data, error } = await buildVisitsQuery();
            if (error) handleSupabaseError(error, OperationType.GET, 'visits');
            else setVisits(data as Visit[]);
        };

        const fetchEngagement = async () => {
             const { data, error } = await buildEngagementQuery();
             if (error) handleSupabaseError(error, OperationType.GET, 'engagement_actions');
             else setEngagementActions(data as EngagementAction[]);
        };

        const fetchData = async () => {
            setIsLoading(true);
            try {
                const [visitsResponse, engagementResponse] = await Promise.all([
                    buildVisitsQuery(),
                    buildEngagementQuery()
                ]);

                if (visitsResponse.error) handleSupabaseError(visitsResponse.error, OperationType.GET, 'visits');
                else setVisits(visitsResponse.data as Visit[]);

                if (engagementResponse.error) handleSupabaseError(engagementResponse.error, OperationType.GET, 'engagement_actions');
                else setEngagementActions(engagementResponse.data as EngagementAction[]);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();

        const channelVisitsId = `visits-${currentCampaignId}`;
        const channelVisits = supabase.channel(channelVisitsId)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: `campaignId=eq.${currentCampaignId}` }, fetchVisits)
            .subscribe();

        const channelEngagementId = `engagement-${currentCampaignId}`;
        const channelEngagement = supabase.channel(channelEngagementId)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'engagement_actions', filter: `campaignId=eq.${currentCampaignId}` }, fetchEngagement)
            .subscribe();

        return () => {
            supabase.removeChannel(channelVisits);
            supabase.removeChannel(channelEngagement);
        };
    }, [user?.campaignId, user?.type, user?.uid]);

    const addVisit = async (visit: Omit<Visit, 'id'>) => {
        if (!user?.campaignId) return;
        try {
            // Campos de funil NÃO são colunas de `visits` — viram o contato (voterId).
            const { voteIntention, voteCertainty, objection, isMultiplier, influenceCount, whatsappOptin, ...visitCore } = visit as any;

            // Cria/atualiza o contato do eleitor a partir da visita (best-effort).
            let voterId: string | null = null;
            try {
                voterId = await upsertVoterFromVisit(user.campaignId, visitCore, {
                    voteIntention, voteCertainty, objection, isMultiplier, influenceCount, whatsappOptin,
                });
            } catch (e) {
                console.warn('[addVisit] upsert do contato falhou (visita segue normal):', e);
            }

            const dataToSave = {
                ...visitCore,
                ...(voterId ? { voterId } : {}),
                campaignId: user.campaignId,
                createdBy: user.uid,
                leaderId: user.type === 'Líder' ? user.uid : (user.assignedLeaderId || null),
            };
            const { data: created, error } = await supabase
                .from('visits')
                .insert(sanitizeData(dataToSave))
                .select('id')
                .single();
            if (error) throw error;
            void logSubmissionGeo({
                campaignId: user.campaignId,
                userId: user.id ? String(user.id) : null,
                action: 'create_visit',
                targetTable: 'visits',
                targetId: created?.id || null,
            });
        } catch (error) {
            handleSupabaseError(error, OperationType.CREATE, 'visits');
        }
    };

    const updateVisit = async (updatedVisit: Visit) => {
        try {
            const { id, ...data } = updatedVisit;
            const { error } = await supabase.from('visits').update(sanitizeData(data)).eq('id', id);
            if (error) throw error;
        } catch (error) {
            handleSupabaseError(error, OperationType.UPDATE, `visits/${updatedVisit.id}`);
        }
    };

    const deleteVisit = async (id: string | number) => {
        try {
            const { error } = await supabase.from('visits').delete().eq('id', String(id));
            if (error) throw error;
        } catch (error) {
            handleSupabaseError(error, OperationType.DELETE, `visits/${id}`);
        }
    };

    const addEngagementAction = async (action: Omit<EngagementAction, 'id'>) => {
        if (!user?.campaignId) return;
        try {
            const { data: created, error } = await supabase
                .from('engagement_actions')
                .insert(sanitizeData({
                    ...action,
                    campaignId: user.campaignId,
                    createdBy: user.uid,
                }))
                .select('id')
                .single();
            if (error) throw error;
            void logSubmissionGeo({
                campaignId: user.campaignId,
                userId: user.id ? String(user.id) : null,
                action: 'create_engagement',
                targetTable: 'engagement_actions',
                targetId: created?.id || null,
            });
        } catch (error) {
            handleSupabaseError(error, OperationType.CREATE, 'engagement_actions');
        }
    };

    const value = {
        visits, addVisit, updateVisit, deleteVisit,
        engagementActions, addEngagementAction, isLoading
    };

    return <VisitsContext.Provider value={value}>{children}</VisitsContext.Provider>;
};

export const useVisits = () => {
    const context = React.useContext(VisitsContext);
    if (context === undefined) {
        throw new Error('useVisits must be used within a VisitsProvider');
    }
    return context;
};