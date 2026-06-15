/**
 * Gate de pause global da IA (#137).
 *
 * Quando campaigns.aiGloballyPausedAt está setado, NENHUMA IA dispara:
 *   - Monitor Proativo (Manager batch)
 *   - Daily Briefing (Orchestrator)
 *   - Secretary IA (agenda por voz/WhatsApp)
 *   - Aurora (atendimento eleitor WhatsApp)
 *   - fireOrchestration em geral
 *
 * Workers e handlers chamam isCampaignPaused antes de qualquer disparo.
 * Cache de 30s pra não martelar o banco.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { paused: boolean; expires: number }>();

export async function isCampaignPaused(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<boolean> {
  if (!campaignId) return false;
  const now = Date.now();
  const hit = cache.get(campaignId);
  if (hit && hit.expires > now) return hit.paused;

  try {
    const { data } = await supabase
      .from('campaigns')
      .select('"aiGloballyPausedAt"')
      .eq('id', campaignId)
      .maybeSingle();
    const paused = !!(data as any)?.aiGloballyPausedAt;
    cache.set(campaignId, { paused, expires: now + CACHE_TTL_MS });
    return paused;
  } catch {
    // Fail-open: se não conseguir verificar, deixa IA rodar (não bloqueia)
    return false;
  }
}

/** Invalida cache (chamar após mudar o estado via POST /pause). */
export function invalidatePauseCache(campaignId?: string): void {
  if (campaignId) cache.delete(campaignId);
  else cache.clear();
}
