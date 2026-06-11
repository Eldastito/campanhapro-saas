/**
 * Hook do status do plano da campanha. Fonte única para:
 *  - Cadeados nos botões pagos (planTier === 'gratis' → trava).
 *  - Cotas usadas/limites (mostrar "12/100 disparos").
 *  - Trial 24h de IA (ativo/elegível/usado).
 *  - Banners de upgrade contextuais.
 *
 * Cacheia por ~60s pra não martelar o backend; força refresh após ações.
 */
import * as React from 'react';
import { authedFetch } from '../lib/authedFetch';

export interface PlanStatus {
  planTier: 'gratis' | 'limitado' | 'completo';
  features: string[];
  limits: {
    ai_calls?: number; aiCalls?: number;
    team_members?: number; teamMembers?: number;
    visits?: number;
    whatsapp_per_day?: number; whatsappPerDay?: number;
    forms?: number;
  };
  usage: { whatsappToday: number; formsActive: number; leads: number };
  trial: {
    active: boolean; used: number; until: string | null;
    startedAt: string | null; eligible: boolean;
    leadsThreshold: number; leadsCount: number;
  };
}

const TTL_MS = 60_000;
let cache: { data: PlanStatus | null; at: number } = { data: null, at: 0 };
const listeners = new Set<() => void>();

export function invalidatePlanStatus() { cache = { data: null, at: 0 }; listeners.forEach((l) => l()); }

export function usePlanStatus() {
  const [status, setStatus] = React.useState<PlanStatus | null>(cache.data);
  const [loading, setLoading] = React.useState(!cache.data);

  const fetchStatus = React.useCallback(async (force = false) => {
    if (!force && cache.data && Date.now() - cache.at < TTL_MS) {
      setStatus(cache.data); setLoading(false); return cache.data;
    }
    try {
      const r = await authedFetch('/api/v1/plan/status');
      if (!r.ok) { setLoading(false); return null; }
      const data = await r.json() as PlanStatus;
      cache = { data, at: Date.now() };
      setStatus(data); setLoading(false);
      return data;
    } catch { setLoading(false); return null; }
  }, []);

  React.useEffect(() => {
    fetchStatus();
    const cb = () => fetchStatus(true);
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, [fetchStatus]);

  return { status, loading, refresh: () => fetchStatus(true) };
}

/** Helpers — derivam infos comuns sem precisar saber as estruturas internas. */
export const isFree = (s: PlanStatus | null) => s?.planTier === 'gratis';
export const isAiLocked = (s: PlanStatus | null) => isFree(s) && !s?.trial?.active;
export const isFeatureLocked = (s: PlanStatus | null, key: string) =>
  s ? !s.features.includes(key) : false;
export const whatsappRemaining = (s: PlanStatus | null) => {
  if (!s) return 0;
  const limit = s.limits.whatsapp_per_day ?? s.limits.whatsappPerDay ?? 999999;
  return Math.max(0, limit - (s.usage?.whatsappToday || 0));
};
