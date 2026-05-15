import * as React from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { handleSupabaseError, OperationType } from '../utils/supabaseUtils';

export const usePesquisas = () => {
  const { user } = useAuth();
  const [pesquisas, setPesquisas] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    if (!user?.campaignId) return;
    
    const fetchPesquisas = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('pesquisas')
                .select('*')
                .eq('campaignId', user.campaignId)
                .order('createdAt', { ascending: false })
                .limit(100);

            if (error) {
                handleSupabaseError(error, OperationType.GET, 'pesquisas');
            } else {
                setPesquisas(data || []);
            }
        } finally {
            setIsLoading(false);
        }
    };

    fetchPesquisas();

    // Canal único por execução do effect — evita conflito quando React re-roda
    // o effect (Strict Mode) e tenta registrar callbacks num canal já subscrito.
    const channelId = `pesquisas-changes-${user.campaignId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase.channel(channelId);

    channel
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'pesquisas', filter: `campaignId=eq.${user.campaignId}` },
            fetchPesquisas
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

  return { pesquisas, isLoading };
};
