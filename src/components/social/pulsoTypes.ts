/**
 * Types espelhados do backend (`socialSignalStore.ts` + `socialSignalBus.ts`)
 * para o Pulso Digital consumir sem depender de imports server-side.
 * Se o backend mudar, sincronizar aqui (mesma versão do bus).
 */

export type SocialSignalSource =
  | 'trend'
  | 'anomaly'
  | 'cross_network_trend'
  | 'cross_network_anomaly';

export type SocialSignalSeverity = 'info' | 'attention' | 'risk' | 'crisis';

export const SEVERITY_ORDER: Record<SocialSignalSeverity, number> = {
  info: 0,
  attention: 1,
  risk: 2,
  crisis: 3,
};

export type SocialProvider =
  | 'instagram'
  | 'facebook'
  | 'youtube'
  | 'tiktok'
  | 'x'
  | 'linkedin'
  | 'kwai';

export const SOCIAL_PROVIDERS: readonly SocialProvider[] = Object.freeze([
  'instagram', 'facebook', 'youtube', 'tiktok', 'x', 'linkedin', 'kwai',
]);

export const SOCIAL_TOPICS = Object.freeze([
  'saude', 'seguranca', 'educacao', 'transporte', 'emprego', 'economia',
  'saneamento', 'enchentes', 'transito', 'habitacao', 'assistencia_social',
  'servicos_publicos', 'meio_ambiente', 'esporte', 'cultura', 'outros',
] as const);
export type SocialTopic = typeof SOCIAL_TOPICS[number];

export interface StoredSocialSignal {
  id: string;
  campaignId: string;
  dedupKey: string;
  source: SocialSignalSource;
  severity: SocialSignalSeverity;
  summary: string;
  hypotheses: string[];
  providers: SocialProvider[];
  topic: string | null;
  confidence: number;
  emittedAt: string;
  payload: Record<string, unknown>;
  busVersion: string;
  createdAt: string;
  updatedAt: string;
}

/** Signals que chegam pelo canal Broadcast — shape diferente do StoredSocialSignal;
 *  vem serializado do backend em socialSignalsBroadcaster.serializeForWire. */
export interface BroadcastSocialSignal {
  dedupKey: string;
  source: SocialSignalSource;
  severity: SocialSignalSeverity;
  summary: string;
  hypotheses: string[];
  providers: SocialProvider[];
  topic: string | null;
  confidence: number;
  emittedAt: string;
  payload: Record<string, unknown>;
  busVersion: string;
}

// ── UI helpers ─────────────────────────────────────────────────────

export const SEVERITY_LABELS: Record<SocialSignalSeverity, string> = {
  info: 'Info',
  attention: 'Atenção',
  risk: 'Risco',
  crisis: 'Crise',
};

/** Tailwind classes por severidade — cores base pra badges + accents. */
export const SEVERITY_COLORS: Record<SocialSignalSeverity, {
  bg: string;
  text: string;
  border: string;
  ring: string;
}> = {
  info: {
    bg: 'bg-slate-700/40',
    text: 'text-slate-300',
    border: 'border-slate-600',
    ring: 'ring-slate-500/30',
  },
  attention: {
    bg: 'bg-amber-500/15',
    text: 'text-amber-300',
    border: 'border-amber-600/60',
    ring: 'ring-amber-500/30',
  },
  risk: {
    bg: 'bg-orange-500/15',
    text: 'text-orange-300',
    border: 'border-orange-600/70',
    ring: 'ring-orange-500/40',
  },
  crisis: {
    bg: 'bg-red-500/20',
    text: 'text-red-200',
    border: 'border-red-500',
    ring: 'ring-red-500/50',
  },
};

export const SOURCE_LABELS: Record<SocialSignalSource, string> = {
  trend: 'Tendência',
  anomaly: 'Anomalia',
  cross_network_trend: 'Cross-network · Tendência',
  cross_network_anomaly: 'Cross-network · Anomalia',
};

export const PROVIDER_LABELS: Record<SocialProvider, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  linkedin: 'LinkedIn',
  kwai: 'Kwai',
};

export const TOPIC_LABELS: Record<SocialTopic, string> = {
  saude: 'Saúde',
  seguranca: 'Segurança',
  educacao: 'Educação',
  transporte: 'Transporte',
  emprego: 'Emprego',
  economia: 'Economia',
  saneamento: 'Saneamento',
  enchentes: 'Enchentes',
  transito: 'Trânsito',
  habitacao: 'Habitação',
  assistencia_social: 'Assistência Social',
  servicos_publicos: 'Serviços Públicos',
  meio_ambiente: 'Meio Ambiente',
  esporte: 'Esporte',
  cultura: 'Cultura',
  outros: 'Outros',
};

/**
 * Converte `BroadcastSocialSignal` (que vem do canal realtime) em
 * `StoredSocialSignal` (que veio do GET /signals). Faltam id/campaignId/
 * createdAt/updatedAt — preenchidos com placeholders sensatos.
 */
export function broadcastToStored(
  bs: BroadcastSocialSignal,
  campaignId: string,
): StoredSocialSignal {
  return {
    id: `bcast:${bs.dedupKey}`,
    campaignId,
    dedupKey: bs.dedupKey,
    source: bs.source,
    severity: bs.severity,
    summary: bs.summary,
    hypotheses: bs.hypotheses,
    providers: bs.providers,
    topic: bs.topic,
    confidence: bs.confidence,
    emittedAt: bs.emittedAt,
    payload: bs.payload,
    busVersion: bs.busVersion,
    createdAt: bs.emittedAt,
    updatedAt: bs.emittedAt,
  };
}

export function formatEmittedAt(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const diffMs = Date.now() - t.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'agora mesmo';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `há ${diffD}d`;
  return t.toLocaleDateString('pt-BR');
}
