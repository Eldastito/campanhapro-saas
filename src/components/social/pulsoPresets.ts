/**
 * pulsoPresets — presets de filtros pra Pulso Digital.
 *
 * Analista clica um botão e vê a visão comum instantaneamente (últimas
 * 24h em crise, 7 dias em risco, etc). Reduz cliques em selects e evita
 * combinações inconsistentes ("risco de 30 dias atrás" é ruído, não
 * sinal atual).
 *
 * Determinístico — `now` é passado explícito pra facilitar teste e evitar
 * Date.now() dentro de componentes React.
 */

import type { SocialSignalSeverity } from './pulsoTypes';

export interface PresetFilters {
  minSeverity: SocialSignalSeverity | '';
  /** ISO string (yyyy-mm-ddTHH:MM:ssZ) ou vazio pra sem cutoff. */
  since: string;
}

export interface FilterPreset {
  id: string;
  label: string;
  /** Curto explicativo do escopo temporal. */
  scope: string;
  computeFilters(now: Date): PresetFilters;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function isoFrom(now: Date, deltaMs: number): string {
  return new Date(now.getTime() - deltaMs).toISOString();
}

export const PULSO_PRESETS: readonly FilterPreset[] = Object.freeze([
  {
    id: 'crises-24h',
    label: 'Crises · últimas 24h',
    scope: 'Só crise · 24h',
    computeFilters: (now) => ({
      minSeverity: 'crisis',
      since: isoFrom(now, DAY),
    }),
  },
  {
    id: 'risk-plus-24h',
    label: 'Risco+ · últimas 24h',
    scope: 'Risco e crise · 24h',
    computeFilters: (now) => ({
      minSeverity: 'risk',
      since: isoFrom(now, DAY),
    }),
  },
  {
    id: 'attention-plus-7d',
    label: 'Atenção+ · últimos 7 dias',
    scope: 'Atenção, risco, crise · 7d',
    computeFilters: (now) => ({
      minSeverity: 'attention',
      since: isoFrom(now, 7 * DAY),
    }),
  },
  {
    id: 'all-recent-7d',
    label: 'Tudo · últimos 7 dias',
    scope: 'Todas severidades · 7d',
    computeFilters: (now) => ({
      minSeverity: '',
      since: isoFrom(now, 7 * DAY),
    }),
  },
] satisfies readonly FilterPreset[]);

/**
 * Encontra a preset ativa dado o estado atual — comparação por
 * `minSeverity` + margem em `since` (± 60s) pra tolerar drift entre
 * clique e comparação. Retorna null se nenhuma bate.
 */
export function findMatchingPreset(
  current: PresetFilters,
  now: Date,
  toleranceMs: number = 60_000,
): FilterPreset | null {
  for (const p of PULSO_PRESETS) {
    const target = p.computeFilters(now);
    if (target.minSeverity !== current.minSeverity) continue;
    if (!target.since && !current.since) return p;
    if (!target.since || !current.since) continue;
    const t = new Date(target.since).getTime();
    const c = new Date(current.since).getTime();
    if (!Number.isFinite(t) || !Number.isFinite(c)) continue;
    if (Math.abs(t - c) <= toleranceMs) return p;
  }
  return null;
}
