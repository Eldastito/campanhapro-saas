/**
 * pulsoSummary — cálculo puro que deriva stats do feed do Pulso Digital.
 *
 * Isolado do componente React (PulsoSummaryHeader.tsx) pra facilitar
 * teste unitário: `node --test` sobre `*.test.ts` só importa .ts, sem
 * precisar setar DOM/react-jsx no runner.
 */

import {
  StoredSocialSignal,
  SocialSignalSeverity,
  SEVERITY_ORDER,
  TOPIC_LABELS,
  SocialTopic,
} from './pulsoTypes';

export interface DayBucket {
  date: string;
  total: number;
  crisis: number;
  risk: number;
  attention: number;
  info: number;
}

/** yyyy-mm-dd em UTC — mesma chave usada no bucket server-side (PR 31). */
function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const ZERO_DAY_BUCKET: Omit<DayBucket, 'date'> = {
  total: 0, crisis: 0, risk: 0, attention: 0, info: 0,
};

/**
 * Bucketa signals por dia UTC. Dias no intervalo [oldestSignal, now] com
 * zero counts aparecem pra sparkline não pular no eixo X.
 *
 * Determinístico — não usa Date.now() nem timezone local. `now` é passado
 * explicitamente pra facilitar teste.
 *
 * Retorna array ORDENADO ASC. Vazio quando não há signals.
 */
export function computeDayBuckets(
  signals: StoredSocialSignal[],
  now: Date,
): DayBucket[] {
  if (signals.length === 0) return [];

  // Determina o range: do dia mais antigo até "now" UTC
  let minMs = now.getTime();
  for (const s of signals) {
    const t = new Date(s.emittedAt).getTime();
    if (!Number.isNaN(t) && t < minMs) minMs = t;
  }
  const oldestDay = new Date(Date.UTC(
    new Date(minMs).getUTCFullYear(),
    new Date(minMs).getUTCMonth(),
    new Date(minMs).getUTCDate(),
  ));
  const nowDay = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
  ));

  const buckets = new Map<string, DayBucket>();
  const cursor = new Date(oldestDay);
  const endMs = nowDay.getTime() + 24 * 60 * 60 * 1000; // inclui o dia de "now"
  while (cursor.getTime() < endMs) {
    const key = utcDateKey(cursor);
    buckets.set(key, { date: key, ...ZERO_DAY_BUCKET });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  for (const s of signals) {
    const t = new Date(s.emittedAt);
    if (Number.isNaN(t.getTime())) continue;
    const key = utcDateKey(t);
    const b = buckets.get(key);
    if (!b) continue; // defensive: signal fora do range (não deveria acontecer)
    b.total += 1;
    if (s.severity in ZERO_DAY_BUCKET) {
      // TS narrow: severity in ZERO — só literal 4 chaves
      b[s.severity] += 1;
    }
  }

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface PulsoSummary {
  total: number;
  bySeverity: Record<SocialSignalSeverity, number>;
  /** Percentuais 0-100 arredondados; podem NÃO somar 100 exato por causa de round. */
  percentBySeverity: Record<SocialSignalSeverity, number>;
  /** Top topics por count DESC — no máximo 3; topics null são ignorados. */
  topTopics: Array<{ topic: string; label: string; count: number }>;
  /** Severity mais alta presente (útil pra "estado geral"). */
  highestSeverity: SocialSignalSeverity | null;
}

const ZERO_BY_SEVERITY: Record<SocialSignalSeverity, number> = {
  info: 0, attention: 0, risk: 0, crisis: 0,
};

/**
 * Deriva o summary a partir da lista atual. Determinístico, sem side effects,
 * sem depender do relógio.
 */
export function computePulsoSummary(signals: StoredSocialSignal[]): PulsoSummary {
  const bySeverity: Record<SocialSignalSeverity, number> = { ...ZERO_BY_SEVERITY };
  const topicCounts = new Map<string, number>();
  let highestSeverity: SocialSignalSeverity | null = null;
  let highestRank = -1;

  for (const s of signals) {
    // Defense-in-depth: só conta severities do enum
    if (s.severity in bySeverity) {
      bySeverity[s.severity] += 1;
      const rank = SEVERITY_ORDER[s.severity];
      if (rank > highestRank) {
        highestRank = rank;
        highestSeverity = s.severity;
      }
    }
    if (s.topic) {
      topicCounts.set(s.topic, (topicCounts.get(s.topic) ?? 0) + 1);
    }
  }

  const total = signals.length;
  const percentBySeverity: Record<SocialSignalSeverity, number> = {
    info: total ? Math.round((bySeverity.info / total) * 100) : 0,
    attention: total ? Math.round((bySeverity.attention / total) * 100) : 0,
    risk: total ? Math.round((bySeverity.risk / total) * 100) : 0,
    crisis: total ? Math.round((bySeverity.crisis / total) * 100) : 0,
  };

  // Ordena por count DESC, tie-break alfabético (determinismo)
  const topTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([topic, count]) => ({
      topic,
      label: TOPIC_LABELS[topic as SocialTopic] ?? topic,
      count,
    }));

  return { total, bySeverity, percentBySeverity, topTopics, highestSeverity };
}
