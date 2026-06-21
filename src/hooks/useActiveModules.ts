/**
 * Hook dos módulos ATIVOS do tenant (fonte: GET /api/v1/modules/me → .active).
 * É a fonte autoritativa de add-ons ativos (soma entitlements + plano) — usada
 * pra mostrar/ocultar a aba de add-ons avulsos (ex.: Blindagem Jurídica).
 *
 * Cacheia ~60s pra não martelar o backend, no mesmo padrão do usePlanStatus.
 */
import * as React from 'react';
import { authedFetch } from '../lib/authedFetch';

const TTL_MS = 60_000;
let cache: { active: string[]; at: number } | null = null;

export function useActiveModules() {
  const [active, setActive] = React.useState<string[]>(cache?.active ?? []);
  const [loading, setLoading] = React.useState(!cache);

  React.useEffect(() => {
    let alive = true;
    const run = async () => {
      if (cache && Date.now() - cache.at < TTL_MS) {
        setActive(cache.active); setLoading(false); return;
      }
      try {
        const r = await authedFetch('/api/v1/modules/me');
        if (!r.ok) { if (alive) setLoading(false); return; }
        const data = await r.json();
        const list: string[] = Array.isArray(data?.active) ? data.active : [];
        cache = { active: list, at: Date.now() };
        if (alive) { setActive(list); setLoading(false); }
      } catch {
        if (alive) setLoading(false);
      }
    };
    run();
    return () => { alive = false; };
  }, []);

  return { active, loading };
}
