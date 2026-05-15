import { supabase } from '../lib/supabaseClient';
import { TeamResource } from '../types/resources';
import { handleSupabaseError, OperationType } from '../utils/supabaseUtils';

export async function fetchTeamResources(campaignId: string): Promise<TeamResource[]> {
    const { data, error } = await supabase
        .from('team_resources')
        .select('*')
        .eq('campaignId', campaignId)
        .order('createdAt', { ascending: false });

    if (error) {
        await handleSupabaseError(error, OperationType.GET, 'team_resources');
        return [];
    }
    return (data || []) as TeamResource[];
}

export async function createTeamResource(
    resource: Omit<TeamResource, 'id' | 'createdAt' | 'updatedAt'>
): Promise<TeamResource | null> {
    const { data, error } = await supabase
        .from('team_resources')
        .insert(resource)
        .select()
        .single();

    if (error) {
        await handleSupabaseError(error, OperationType.CREATE, 'team_resources');
        return null;
    }
    return data as TeamResource;
}

export async function updateTeamResource(
    id: string,
    updates: Partial<TeamResource>
): Promise<TeamResource | null> {
    const { data, error } = await supabase
        .from('team_resources')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        await handleSupabaseError(error, OperationType.UPDATE, 'team_resources');
        return null;
    }
    return data as TeamResource;
}

export async function deleteTeamResource(id: string): Promise<boolean> {
    const { error } = await supabase
        .from('team_resources')
        .delete()
        .eq('id', id);

    if (error) {
        await handleSupabaseError(error, OperationType.DELETE, 'team_resources');
        return false;
    }
    return true;
}
