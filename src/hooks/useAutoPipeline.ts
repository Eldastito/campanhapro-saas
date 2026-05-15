/**
 * useAutoPipeline — Hook que monitora novos street reports negativos
 * e dispara a pipeline de IA automaticamente, exibindo notificação.
 */
import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

export interface AutoPipelineNotification {
  id: string;
  type: 'running' | 'done' | 'error';
  bairro: string;
  message: string;
  timestamp: Date;
}

interface UseAutoPipelineOptions {
  campaignId: string | undefined;
  enabled: boolean;
  onNotification: (notification: AutoPipelineNotification) => void;
}

const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 horas entre pipelines automáticas

export const useAutoPipeline = ({
  campaignId,
  enabled,
  onNotification
}: UseAutoPipelineOptions) => {
  const lastPipelineRun = useRef<number>(0);
  const channelRef = useRef<any>(null);

  const triggerPipeline = useCallback(async (bairro: string, reclamacao: string) => {
    // Cooldown: não roda duas vezes em menos de 2h
    const now = Date.now();
    if (now - lastPipelineRun.current < COOLDOWN_MS) {
      console.log('[AutoPipeline] Cooldown ativo — pipeline já rodou recentemente.');
      return;
    }

    lastPipelineRun.current = now;
    const notifId = `notif-${Date.now()}`;

    onNotification({
      id: notifId,
      type: 'running',
      bairro,
      message: `🚨 Reporte negativo em "${bairro}". Agentes de IA acionados automaticamente...`,
      timestamp: new Date()
    });

    try {
      // Chamar a Edge Function auto-pipeline
      const { data, error } = await supabase.functions.invoke('auto-pipeline', {
        body: {
          type: 'INSERT',
          record: {
            campaignId,
            bairro,
            clima: 'Negativo',
            reclamacao
          }
        }
      });

      if (error) throw error;

      if (data?.skipped) {
        onNotification({
          id: notifId,
          type: 'done',
          bairro,
          message: `ℹ️ Pipeline pausada: ${data.reason}`,
          timestamp: new Date()
        });
      } else {
        onNotification({
          id: notifId,
          type: 'done',
          bairro,
          message: `✅ Pipeline concluída! Novo plano estratégico gerado para "${bairro}". Veja o Histórico de Análises.`,
          timestamp: new Date()
        });
      }
    } catch (err: any) {
      console.error('[AutoPipeline] Erro ao invocar edge function:', err);
      onNotification({
        id: notifId,
        type: 'error',
        bairro,
        message: `❌ Falha na pipeline automática. Acione manualmente no War Room.`,
        timestamp: new Date()
      });
    }
  }, [campaignId, onNotification]);

  useEffect(() => {
    if (!campaignId || !enabled) return;

    // Escutar novos street reports em tempo real
    const channelId = `auto-pipeline-trigger-${campaignId}`;
    
    channelRef.current = supabase
      .channel(channelId)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'street_reports',
          filter: `campaignId=eq.${campaignId}`
        },
        (payload: any) => {
          const newReport = payload.new;
          console.log('[AutoPipeline] Novo reporte detectado:', newReport);

          // Só aciona pipeline para reportes NEGATIVOS
          if (newReport?.clima === 'Negativo') {
            triggerPipeline(
              newReport.bairro || 'bairro desconhecido',
              newReport.reclamacao || ''
            );
          }
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [campaignId, enabled, triggerPipeline]);

  // Acionar pipeline manualmente (para cron ou botão manual)
  const runManualPipeline = useCallback(async () => {
    if (!campaignId) return;

    const notifId = `manual-${Date.now()}`;
    onNotification({
      id: notifId,
      type: 'running',
      bairro: 'Toda a campanha',
      message: '🤖 Executando análise diária completa...',
      timestamp: new Date()
    });

    try {
      const { error } = await supabase.functions.invoke('auto-pipeline', {
        body: { type: 'manual', campaignId }
      });

      if (error) throw error;

      onNotification({
        id: notifId,
        type: 'done',
        bairro: 'Toda a campanha',
        message: '✅ Análise diária concluída! Veja o Histórico de Análises.',
        timestamp: new Date()
      });
    } catch (err: any) {
      onNotification({
        id: notifId,
        type: 'error',
        bairro: 'Toda a campanha',
        message: '❌ Falha na análise automática.',
        timestamp: new Date()
      });
    }
  }, [campaignId, onNotification]);

  return { runManualPipeline };
};
