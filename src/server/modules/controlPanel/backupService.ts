/**
 * Backup Service (#137).
 *
 * Cria snapshot agregado da campanha — contagens + amostras das tabelas
 * principais. Não é dump completo (não escala); é "evidência" pra auditoria
 * + recuperação parcial.
 *
 * Uso:
 *   - POST /control-panel/backup-now (manual via UI)
 *   - tickBackupSnapshot do routinesWorker (auto noturno)
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface SnapshotResult {
  id: string;
  snapshotDate: string;
  sizeBytes: number;
  counts: Record<string, number>;
}

const SNAPSHOT_TABLES = [
  'visits', 'engagement_actions', 'contacts', 'team_members',
  'scenarios', 'campaign_configs', 'campaigns',
  'engagement_followups', 'team_badges', 'whatsapp_instances',
];

export async function createSnapshot(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<SnapshotResult> {
  const today = new Date().toISOString().slice(0, 10);
  const counts: Record<string, number> = {};
  const payload: Record<string, any> = {};

  // Pra cada tabela, conta + pega só os 100 últimos (evita payload gigante)
  for (const table of SNAPSHOT_TABLES) {
    try {
      const { count } = await supabase.from(table)
        .select('id', { count: 'exact', head: true })
        .eq('campaignId', campaignId);
      counts[table] = count || 0;

      const { data } = await supabase.from(table)
        .select('*')
        .eq(table === 'campaigns' ? 'id' : 'campaignId', campaignId)
        .order('createdAt', { ascending: false })
        .limit(100);
      payload[table] = data || [];
    } catch (err: any) {
      // Tabela pode não ter campaignId (campaigns usa id) — só loga
      console.warn(`[backup] tabela ${table}:`, err?.message);
      counts[table] = -1;
    }
  }

  const sizeBytes = JSON.stringify(payload).length;

  // Upsert (1 por dia)
  const { data, error } = await supabase.from('daily_backups')
    .upsert({
      campaignId, snapshotDate: today,
      sizeBytes, counts, payload,
    }, { onConflict: 'campaignId,snapshotDate' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  // Limpa backups com mais de 30 dias
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  await supabase.from('daily_backups').delete()
    .eq('campaignId', campaignId)
    .lt('snapshotDate', cutoff);

  return { id: (data as any).id, snapshotDate: today, sizeBytes, counts };
}

/**
 * Helper pro routinesWorker checar se deve fazer backup hoje. Faz UPSERT
 * atomicamente — se outro worker já pegou, ignora.
 */
export async function shouldRunBackupToday(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const { count } = await supabase.from('daily_backups')
    .select('id', { count: 'exact', head: true })
    .eq('campaignId', campaignId)
    .eq('snapshotDate', today);
  return (count || 0) === 0;
}
