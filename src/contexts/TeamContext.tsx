import * as React from 'react';
import { supabase } from '../lib/supabaseClient';
import { TeamMember, Location } from '../types/teams';
import { RJ_MUNICIPALITIES } from '../data/rj-locations';
import { handleSupabaseError, sanitizeData, OperationType } from '../utils/supabaseUtils';
import { authedFetch } from '../lib/authedFetch';
import { useAuth } from './AuthContext';

interface TeamContextType {
    teamMembers: TeamMember[];
    addTeamMember: (member: Omit<TeamMember, 'id'>) => Promise<void>;
    updateTeamMember: (member: TeamMember) => Promise<void>;
    deleteTeamMember: (id: string | number) => Promise<void>;
    locations: Location[];
    addLocation: (location: Omit<Location, 'id'>) => Promise<void>;
    deleteLocation: (id: string | number) => Promise<void>;
    loadRioBairros: () => void;
}

const TeamContext = React.createContext<TeamContextType | undefined>(undefined);

export const TeamProvider = ({ children }: { children?: React.ReactNode }) => {
    const { user } = useAuth();
    const [teamMembers, setTeamMembers] = React.useState<TeamMember[]>([]);
    const [locations, setLocations] = React.useState<Location[]>([]);

    React.useEffect(() => {
        if (!user?.campaignId) return;

        const fetchData = async () => {
            let teamQuery = supabase
                .from('team_members')
                .select('*')
                .eq('campaignId', user.campaignId);

            if (user.type === 'Líder') {
                teamQuery = teamQuery.eq('assignedLeaderId', user.uid);
            } else if (user.type !== 'Admin' && user.type !== 'Candidato') {
                teamQuery = teamQuery.eq('email', user.email);
            }

            console.log("[TeamContext] Buscando membros para campanha:", user.campaignId, "Tipo usuário:", user.type);
            const { data: teamData, error: teamError } = await teamQuery;
            console.log("[TeamContext] Membros encontrados:", teamData?.length || 0);
            
            if (teamError) {
                console.error("[TeamContext] Erro ao buscar membros:", teamError);
                handleSupabaseError(teamError, OperationType.GET, 'team_members');
            }
            else setTeamMembers(teamData as TeamMember[]);

            const { data: locData, error: locError } = await supabase
                .from('locations')
                .select('*')
                .eq('campaignId', user.campaignId);
            
            if (locError) handleSupabaseError(locError, OperationType.GET, 'locations');
            else setLocations(locData as Location[]);
        };

        fetchData();

        const channelTeamId = `team-${user.campaignId}`;
        const channelTeam = supabase.channel(channelTeamId)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members', filter: `campaignId=eq.${user.campaignId}` }, fetchData)
            .subscribe();

        const channelLocsId = `locations-${user.campaignId}`;
        const channelLocs = supabase.channel(channelLocsId)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'locations', filter: `campaignId=eq.${user.campaignId}` }, fetchData)
            .subscribe();

        return () => {
            supabase.removeChannel(channelTeam);
            supabase.removeChannel(channelLocs);
        };
    }, [user?.campaignId, user?.type, user?.uid]);

    const addTeamMember = async (member: Omit<TeamMember, 'id'>) => {
        if (!user?.campaignId) {
            alert('Erro: usuário sem campanha vinculada. Faça logout e login novamente.');
            throw new Error('campaignId não definido para este usuário');
        }
        const assignedLeaderId = user.type === 'Líder' ? user.uid : (member.assignedLeaderId || null);
        const { password, ...memberWithoutPassword } = member as any;

        // Cria a IDENTIDADE DE LOGIN (Supabase Auth + users) via backend, senão o
        // membro fica só na tabela team_members e NÃO consegue entrar na plataforma.
        if (memberWithoutPassword.email && password) {
            const resp = await authedFetch('/api/v1/team/members', {
                method: 'POST',
                body: JSON.stringify({
                    name: memberWithoutPassword.name,
                    email: memberWithoutPassword.email,
                    password,
                    role: memberWithoutPassword.role,
                }),
            });
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                const MAP: Record<string, string> = {
                    email_already_registered: 'Este e-mail já possui conta. Use outro e-mail ou convide pelo fluxo de convite.',
                    already_a_member: 'Este e-mail já é membro desta campanha.',
                    email_in_another_campaign: 'Este e-mail já pertence a outra campanha.',
                    password_min_6: 'A senha precisa ter no mínimo 6 caracteres.',
                    invalid_email: 'E-mail inválido.',
                    admin_required: 'Apenas Admin/Coordenador podem criar membros com acesso.',
                    role_not_invitable: 'Função não permitida para criação direta.',
                };
                throw new Error(MAP[json?.error] || json?.detail || json?.error || 'Falha ao criar o acesso do membro.');
            }
        }

        const { error } = await supabase.from('team_members').insert(sanitizeData({
            ...memberWithoutPassword,
            campaignId: user.campaignId,
            addedBy: user.uid,
            assignedLeaderId,
        }));
        if (error) await handleSupabaseError(error, OperationType.CREATE, 'team_members');
    };

    const updateTeamMember = async (updatedMember: TeamMember) => {
        try {
            const { id, password, ...data } = updatedMember as any;
            const { error } = await supabase.from('team_members').update(sanitizeData(data)).eq('id', id);
            if (error) throw error;
        } catch (error) {
            handleSupabaseError(error, OperationType.UPDATE, `team_members/${updatedMember.id}`);
        }
    };

    const deleteTeamMember = async (id: string | number) => {
        try {
            const { error } = await supabase.from('team_members').delete().eq('id', String(id));
            if (error) throw error;
        } catch (error) {
            handleSupabaseError(error, OperationType.DELETE, `team_members/${id}`);
        }
    };

    const addLocation = async (location: Omit<Location, 'id'>) => {
        if (!user?.campaignId) return;
        try {
            const { error } = await supabase.from('locations').insert(sanitizeData({
                ...location,
                campaignId: user.campaignId
            }));
            if (error) throw error;
        } catch (error) {
            handleSupabaseError(error, OperationType.CREATE, 'locations');
        }
    };

    const deleteLocation = async (id: string | number) => {
        try {
            const { error } = await supabase.from('locations').delete().eq('id', String(id));
            if (error) throw error;
        } catch (error) {
            handleSupabaseError(error, OperationType.DELETE, `locations/${id}`);
        }
    };
    
    const loadRioBairros = () => {
        const existingKeys = new Set(locations.map(l => `${l.municipality.toLowerCase()}|${l.name.toLowerCase()}`));
        
        RJ_MUNICIPALITIES.forEach(municipality => {
            municipality.neighborhoods.forEach(async (bairro) => {
                const key = `${municipality.name.toLowerCase()}|${bairro.toLowerCase()}`;
                if (!existingKeys.has(key)) {
                    await addLocation({ 
                        name: bairro, 
                        municipality: municipality.name 
                    });
                }
            });
        });
    };

    const value = {
        teamMembers, addTeamMember, updateTeamMember, deleteTeamMember,
        locations, addLocation, deleteLocation, loadRioBairros,
    };

    return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
};

export const useTeam = () => {
    const context = React.useContext(TeamContext);
    if (context === undefined) {
        throw new Error('useTeam must be used within a TeamProvider');
    }
    return context;
};
