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
    resetMemberPassword: (userId: string, password: string) => Promise<void>;
    removeMemberAccess: (member: TeamMember) => Promise<void>;
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
            // Membros vêm pelo backend: campos sensíveis (CPF/RG/banco/PIX) são
            // decifrados lá (a chave não existe no browser) e o escopo por papel
            // foi replicado no servidor. Realtime abaixo só dispara este refetch.
            try {
                const resp = await authedFetch('/api/v1/team-members');
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const json = await resp.json();
                setTeamMembers((json.members ?? []) as TeamMember[]);
            } catch (teamError) {
                console.error("[TeamContext] Erro ao buscar membros:", teamError);
                handleSupabaseError(teamError, OperationType.GET, 'team_members');
            }

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
        let linkedUserId: string | null = null;

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
                    email_already_registered: 'Este e-mail já possui conta em outro contexto. Use outro e-mail.',
                    email_in_another_campaign: 'Este e-mail já pertence a outra campanha.',
                    password_min_6: 'A senha precisa ter no mínimo 6 caracteres.',
                    invalid_email: 'E-mail inválido.',
                    admin_required: 'Apenas Admin/Coordenador podem criar membros com acesso.',
                    role_not_invitable: 'Função não permitida para criação direta.',
                };
                throw new Error(MAP[json?.error] || json?.detail || json?.error || 'Falha ao criar o acesso do membro.');
            }
            linkedUserId = json?.userId ?? null;
            // Re-adicionar o mesmo e-mail = atualizar: remove a linha de equipe antiga
            // (evita duplicata; o login foi reaproveitado pelo backend).
            await supabase.from('team_members')
                .delete()
                .eq('campaignId', user.campaignId)
                .eq('email', memberWithoutPassword.email);
        }

        // Backend cifra CPF/RG/banco/PIX antes de gravar (campaignId/addedBy são
        // resolvidos lá pelo JWT). assignedLeaderId vai junto.
        try {
            const resp = await authedFetch('/api/v1/team-members', {
                method: 'POST',
                body: JSON.stringify(sanitizeData({
                    ...memberWithoutPassword,
                    ...(linkedUserId ? { userId: linkedUserId } : {}),
                    assignedLeaderId,
                })),
            });
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
            const createdRow = json?.member as TeamMember | undefined;
            if (createdRow) setTeamMembers(prev => [...prev.filter(m => m.id !== (createdRow as any).id), createdRow]);
        } catch (error) {
            await handleSupabaseError(error, OperationType.CREATE, 'team_members');
        }
    };

    const updateTeamMember = async (updatedMember: TeamMember) => {
        const { id, password, ...data } = updatedMember as any;
        try {
            // Backend cifra os campos sensíveis antes do update (escopado à campanha).
            const resp = await authedFetch(`/api/v1/team-members/${id}`, {
                method: 'PATCH',
                body: JSON.stringify(sanitizeData(data)),
            });
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
            const saved = (json?.member ?? { ...updatedMember }) as TeamMember;
            setTeamMembers(prev => prev.map(m => (m.id === id ? saved : m)));
        } catch (error) {
            handleSupabaseError(error, OperationType.UPDATE, `team_members/${id}`);
        }
    };

    const deleteTeamMember = async (id: string | number) => {
        try {
            const { error } = await supabase.from('team_members').delete().eq('id', String(id));
            if (error) throw error;
            setTeamMembers(prev => prev.filter(m => String(m.id) !== String(id)));
        } catch (error) {
            handleSupabaseError(error, OperationType.DELETE, `team_members/${id}`);
        }
    };

    // Redefine a senha de login de um membro (Admin/Coord, ou o Líder dono dele).
    const resetMemberPassword = async (userId: string, password: string) => {
        const resp = await authedFetch(`/api/v1/team/members/${userId}/reset-password`, {
            method: 'POST',
            body: JSON.stringify({ password }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            const MAP: Record<string, string> = {
                password_min_6: 'A senha precisa ter no mínimo 6 caracteres.',
                forbidden: 'Você não pode alterar a senha deste membro.',
                member_not_found: 'Membro não encontrado.',
            };
            throw new Error(MAP[json?.error] || json?.detail || json?.error || 'Falha ao redefinir a senha.');
        }
    };

    // Remove o ACESSO (Auth+users) e a linha de equipe de um membro.
    const removeMemberAccess = async (member: TeamMember) => {
        const uid = (member as any).userId as string | undefined;
        if (uid) {
            const resp = await authedFetch(`/api/v1/team/members/${uid}`, { method: 'DELETE' });
            if (!resp.ok) {
                const json = await resp.json().catch(() => ({}));
                throw new Error(json?.error === 'forbidden' ? 'Você não pode remover este membro.' : (json?.detail || json?.error || 'Falha ao remover o acesso.'));
            }
        }
        const { error } = await supabase.from('team_members').delete().eq('id', String(member.id));
        if (error) throw error;
        setTeamMembers(prev => prev.filter(m => String(m.id) !== String(member.id)));
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
        resetMemberPassword, removeMemberAccess,
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
