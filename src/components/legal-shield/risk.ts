// Estilos/labels do nível de risco — usados nos badges do módulo Blindagem.
export const RISK_STYLES: Record<string, { label: string; cls: string }> = {
  'baixo':   { label: 'Baixo',   cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  'médio':   { label: 'Médio',   cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  'alto':    { label: 'Alto',    cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  'crítico': { label: 'Crítico', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
};

export function riskBadge(level?: string | null) {
  return RISK_STYLES[level ?? ''] ?? { label: 'Indefinido', cls: 'bg-slate-700 text-slate-300 border-slate-600' };
}
