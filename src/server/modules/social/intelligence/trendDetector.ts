/**
 * TrendDetector — §43-§45 do PRD Social Intelligence.
 *
 * REGRA §39 aplicada: DETERMINÍSTICO PRIMEIRO. Este módulo compara
 * séries temporais de contagens (por tópico, por provider, por content
 * type) contra baseline histórica e devolve tendência.
 *
 * REGRA §45 codificada no tipo: `state = 'insufficient_history'` quando
 * não há dados suficientes. Não inventamos baseline. Nunca.
 *
 * Módulo puro — sem I/O. O caller passa arrays com timestamps + counts
 * e escolhe a janela.
 *
 * O que o TrendDetector NÃO faz (fica pra passadas futuras):
 *   - Baseline por weekday (§43 pede quando há histórico suficiente)
 *     → parametrizado via `groupByWeekday: true`, mas ainda simples.
 *   - Correção sazonal por feriado
 *   - Extrapolação futura
 *   - Cruzar múltiplos providers (isso é o CrossNetworkCorrelator §46-§47)
 */

// ── Tipos ────────────────────────────────────────────────────────────

export type TrendWindow = '24h' | '7d' | '30d';

export type TrendDirection = 'rising' | 'falling' | 'stable';

export type TrendState =
  /** Tendência real detectada com base em histórico suficiente. */
  | 'trend'
  /** Sem histórico bastante — §45 do PRD. Frontend deve mostrar "coletando dados". */
  | 'insufficient_history'
  /** Histórico existe mas atual e baseline são tão próximos que não há sinal. */
  | 'stable_no_signal';

export interface TimestampedCount {
  /** Momento do ponto — pode ser data (agrupada por dia) ou timestamp exato. */
  at: Date;
  /** Valor observado (ex.: número de posts do tema, total de comments, etc.). */
  count: number;
}

export interface TrendResult {
  window: TrendWindow;
  state: TrendState;
  direction: TrendDirection;
  /** Contagem observada na janela atual. */
  currentTotal: number;
  /** Contagem estimada na janela baseline (mesmo tamanho, imediatamente anterior). */
  baselineTotal: number;
  /** (current - baseline) / baseline. `null` quando baseline=0 e state≠trend. */
  deltaPct: number | null;
  /** Number of points used in each side — expõe pra "por que a decisão". */
  samples: { current: number; baseline: number };
  /** Confidence 0-1. Baixa quando amostra é pequena; teta em 0.9 (§39: deixa espaço pra IA). */
  confidence: number;
  detectorVersion: string;
}

export interface DetectTrendOptions {
  /** Momento de referência — normalmente `new Date()`. Passar explicitamente
   *  facilita testes determinísticos. */
  now: Date;
  window: TrendWindow;
  /** Todos os pontos históricos disponíveis, ordenados ou não — o detector
   *  agrupa/soma pelo `at`. */
  series: TimestampedCount[];
  /** Mínimo de amostras em CADA lado (current + baseline) para considerar
   *  o resultado válido. Default: 3. Menos = `insufficient_history`. */
  minSamplesPerSide?: number;
  /** Se true, filtra baseline para só usar pontos do mesmo weekday que o
   *  período atual (§43). Requer amostra maior — default false para MVP. */
  groupByWeekday?: boolean;
  /** Threshold em módulo para considerar `stable_no_signal` (não é
   *  "trend"). Default: 0.05 (5%). */
  stableThreshold?: number;
}

export const TREND_DETECTOR_VERSION = '2026-08-27.v1';

// ── Helpers ──────────────────────────────────────────────────────────

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

function windowMs(w: TrendWindow): number {
  switch (w) {
    case '24h': return 24 * MS_PER_HOUR;
    case '7d': return 7 * MS_PER_DAY;
    case '30d': return 30 * MS_PER_DAY;
  }
}

function sumInRange(series: TimestampedCount[], from: number, to: number, weekdayFilter: number | null): { total: number; samples: number } {
  let total = 0;
  let samples = 0;
  for (const p of series) {
    const t = p.at.getTime();
    if (t < from || t >= to) continue;
    if (weekdayFilter !== null && p.at.getUTCDay() !== weekdayFilter) continue;
    total += p.count;
    samples += 1;
  }
  return { total, samples };
}

// ── API pública ─────────────────────────────────────────────────────

/**
 * Compara janela atual vs janela imediatamente anterior. Retorna sempre —
 * `state` diz se o resultado é confiável.
 */
export function detectTrend(opts: DetectTrendOptions): TrendResult {
  const {
    now,
    window,
    series,
    minSamplesPerSide = 3,
    groupByWeekday = false,
    stableThreshold = 0.05,
  } = opts;

  const win = windowMs(window);
  const currentEnd = now.getTime();
  const currentStart = currentEnd - win;
  const baselineEnd = currentStart;
  const baselineStart = currentStart - win;

  const weekdayFilter = groupByWeekday ? now.getUTCDay() : null;

  const cur = sumInRange(series, currentStart, currentEnd, weekdayFilter);
  const base = sumInRange(series, baselineStart, baselineEnd, weekdayFilter);

  // Estado: sem amostras suficientes
  if (cur.samples < minSamplesPerSide || base.samples < minSamplesPerSide) {
    return {
      window,
      state: 'insufficient_history',
      direction: 'stable',
      currentTotal: cur.total,
      baselineTotal: base.total,
      deltaPct: null,
      samples: { current: cur.samples, baseline: base.samples },
      confidence: 0,
      detectorVersion: TREND_DETECTOR_VERSION,
    };
  }

  // Baseline zero e current > 0 — trend clara pra rising, mas deltaPct indefinido
  if (base.total === 0) {
    if (cur.total === 0) {
      return {
        window,
        state: 'stable_no_signal',
        direction: 'stable',
        currentTotal: 0,
        baselineTotal: 0,
        deltaPct: 0,
        samples: { current: cur.samples, baseline: base.samples },
        confidence: 0.3,
        detectorVersion: TREND_DETECTOR_VERSION,
      };
    }
    return {
      window,
      state: 'trend',
      direction: 'rising',
      currentTotal: cur.total,
      baselineTotal: 0,
      deltaPct: null,
      samples: { current: cur.samples, baseline: base.samples },
      confidence: Math.min(0.85, 0.4 + Math.log10(cur.total + 1) * 0.15),
      detectorVersion: TREND_DETECTOR_VERSION,
    };
  }

  const deltaPct = (cur.total - base.total) / base.total;
  const absDelta = Math.abs(deltaPct);

  if (absDelta < stableThreshold) {
    return {
      window,
      state: 'stable_no_signal',
      direction: 'stable',
      currentTotal: cur.total,
      baselineTotal: base.total,
      deltaPct,
      samples: { current: cur.samples, baseline: base.samples },
      confidence: 0.5,
      detectorVersion: TREND_DETECTOR_VERSION,
    };
  }

  // Confidence: cresce com o tamanho da amostra e magnitude do delta
  const sampleFactor = Math.min(1, Math.min(cur.samples, base.samples) / 10);
  const magnitudeFactor = Math.min(1, absDelta * 2);
  const confidence = Math.min(0.9, 0.3 + sampleFactor * 0.3 + magnitudeFactor * 0.3);

  return {
    window,
    state: 'trend',
    direction: deltaPct > 0 ? 'rising' : 'falling',
    currentTotal: cur.total,
    baselineTotal: base.total,
    deltaPct,
    samples: { current: cur.samples, baseline: base.samples },
    confidence,
    detectorVersion: TREND_DETECTOR_VERSION,
  };
}

/**
 * Conveniência: roda `detectTrend` para as 3 janelas e devolve o mapa.
 * Se todas as 3 vierem `insufficient_history`, o consumer sabe que essa
 * campanha é fresh e não deve mostrar tendências ainda.
 */
export function detectAllWindows(
  opts: Omit<DetectTrendOptions, 'window'>,
): Record<TrendWindow, TrendResult> {
  return {
    '24h': detectTrend({ ...opts, window: '24h' }),
    '7d': detectTrend({ ...opts, window: '7d' }),
    '30d': detectTrend({ ...opts, window: '30d' }),
  };
}
