/**
 * Monte Carlo electoral simulation service.
 *
 * Runs N iterations sampling from vote-share distributions and returns
 * a histogram + summary statistics per candidate/scenario bucket.
 *
 * IMPORTANT: results are clearly labelled as simulations and MUST NOT be
 * published or presented as official polling data (TSE prohibition).
 */

export interface CandidateInput {
  id: string;
  name: string;
  /** Estimated vote share 0–1 */
  baseShare: number;
  /** Symmetric uncertainty margin 0–1 (like a poll ±margin) */
  margin: number;
}

export interface BucketResult {
  candidateId: string;
  name: string;
  meanShare: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  winProbability: number;
}

export interface SimulationResult {
  iterations: number;
  disclaimer: string;
  candidates: BucketResult[];
  /** Normalised iteration samples — sparse sample for charting (max 500 points) */
  samples: Array<{ iteration: number; shares: Record<string, number> }>;
}

/** Box-Muller normal variate */
function randn(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

export function runMonteCarlo(
  candidates: CandidateInput[],
  iterations = 10_000,
): SimulationResult {
  if (candidates.length === 0) throw new Error('At least one candidate required');
  if (iterations < 100 || iterations > 100_000) throw new Error('iterations must be 100–100000');

  const sigma = candidates.map(c => c.margin / 1.96); // 95 % CI → 1 σ
  const accumulated: number[][] = candidates.map(() => []);
  const wins = new Array<number>(candidates.length).fill(0);
  const SPARSE_EVERY = Math.max(1, Math.floor(iterations / 500));
  const samples: SimulationResult['samples'] = [];

  for (let i = 0; i < iterations; i++) {
    // Sample raw shares
    const raw = candidates.map((c, j) => clamp(c.baseShare + sigma[j] * randn()));
    // Normalise so they sum to 1
    const total = raw.reduce((s, v) => s + v, 0) || 1;
    const normed = raw.map(v => v / total);
    // Record
    normed.forEach((v, j) => accumulated[j].push(v));
    // Winner
    const maxIdx = normed.indexOf(Math.max(...normed));
    wins[maxIdx]++;
    // Sparse sample for chart
    if (i % SPARSE_EVERY === 0) {
      const shares: Record<string, number> = {};
      candidates.forEach((c, j) => { shares[c.id] = normed[j]; });
      samples.push({ iteration: i, shares });
    }
  }

  const quantile = (arr: number[], q: number) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };

  const buckets: BucketResult[] = candidates.map((c, j) => ({
    candidateId: c.id,
    name: c.name,
    meanShare: accumulated[j].reduce((s, v) => s + v, 0) / iterations,
    p10: quantile(accumulated[j], 0.1),
    p25: quantile(accumulated[j], 0.25),
    p50: quantile(accumulated[j], 0.5),
    p75: quantile(accumulated[j], 0.75),
    p90: quantile(accumulated[j], 0.9),
    winProbability: wins[j] / iterations,
  }));

  return {
    iterations,
    disclaimer:
      'Esta é uma simulação estatística para uso interno de campanha. ' +
      'NÃO constitui pesquisa eleitoral registrada no TSE e não deve ser divulgada ao público.',
    candidates: buckets,
    samples,
  };
}
