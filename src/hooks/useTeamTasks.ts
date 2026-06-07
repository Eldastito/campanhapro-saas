import * as React from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';

/**
 * Tarefas / roteiros da equipe. O Líder designa trabalho aos liderados; o
 * liderado vê as suas e marca andamento/conclusão. RLS restringe à campanha.
 */
export interface TeamTask {
  id: string;
  campaignId: string;
  leaderId: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  title: string;
  description: string | null;
  bairro: string | null;
  dueDate: string | null;
  status: 'pendente' | 'em_andamento' | 'concluida' | 'cancelada';
  createdBy: string | null;
  createdAt: string;
}

export const TASK_STATUS_LABEL: Record<TeamTask['status'], string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

export function useTeamTasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = React.useState<TeamTask[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!user?.campaignId) { setLoading(false); return; }
    let cancelled = false;

    const buildQuery = () => {
      let q = supabase.from('team_tasks').select('*').eq('campaignId', user.campaignId)
        .order('createdAt', { ascending: false });
      if (user.type === 'Líder') q = q.eq('leaderId', user.uid);
      else if (user.type !== 'Admin' && user.type !== 'Coordenador' && user.type !== 'Candidato') {
        q = q.eq('assignedToUserId', user.uid);
      }
      return q;
    };

    const fetchTasks = async () => {
      const { data, error } = await buildQuery();
      if (!cancelled && !error) setTasks((data ?? []) as TeamTask[]);
      if (!cancelled) setLoading(false);
    };

    fetchTasks();
    const ch = supabase.channel(`team_tasks-${user.campaignId}-${user.uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_tasks', filter: `campaignId=eq.${user.campaignId}` }, fetchTasks)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [user?.campaignId, user?.type, user?.uid]);

  const createTask = async (t: {
    title: string; description?: string; bairro?: string; dueDate?: string | null;
    assignedToUserId?: string | null; assignedToName?: string | null;
  }) => {
    if (!user?.campaignId) throw new Error('Sem campanha vinculada.');
    const row = {
      campaignId: user.campaignId,
      leaderId: user.type === 'Líder' ? user.uid : null,
      assignedToUserId: t.assignedToUserId ?? null,
      assignedToName: t.assignedToName ?? null,
      title: t.title,
      description: t.description ?? null,
      bairro: t.bairro ?? null,
      dueDate: t.dueDate || null,
      status: 'pendente' as const,
      createdBy: user.uid,
    };
    const { data, error } = await supabase.from('team_tasks').insert(row).select('*').single();
    if (error) throw error;
    if (data) setTasks(prev => [data as TeamTask, ...prev]);
  };

  const setStatus = async (id: string, status: TeamTask['status']) => {
    const { error } = await supabase.from('team_tasks').update({ status }).eq('id', id);
    if (error) throw error;
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, status } : t)));
  };

  const removeTask = async (id: string) => {
    const { error } = await supabase.from('team_tasks').delete().eq('id', id);
    if (error) throw error;
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  return { tasks, loading, createTask, setStatus, removeTask };
}
