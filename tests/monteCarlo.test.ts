import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runMonteCarlo } from '../src/server/modules/scenarios/monteCarloService';

describe('runMonteCarlo', () => {
  test('rejects empty candidate list', () => {
    assert.throws(() => runMonteCarlo([], 1000), /At least one candidate/);
  });

  test('rejects out-of-range iteration counts', () => {
    assert.throws(() => runMonteCarlo([{ id: 'a', name: 'A', baseShare: 0.5, margin: 0.05 }], 50));
    assert.throws(() => runMonteCarlo([{ id: 'a', name: 'A', baseShare: 0.5, margin: 0.05 }], 200_000));
  });

  test('produces normalised shares (sum ≈ 1)', () => {
    const result = runMonteCarlo(
      [
        { id: 'a', name: 'A', baseShare: 0.5, margin: 0.05 },
        { id: 'b', name: 'B', baseShare: 0.5, margin: 0.05 },
      ],
      2000,
    );
    const sumOfMeans = result.candidates.reduce((s, c) => s + c.meanShare, 0);
    assert.ok(Math.abs(sumOfMeans - 1) < 0.05, `sum should be ~1 but was ${sumOfMeans}`);
  });

  test('win probabilities sum to 1', () => {
    const result = runMonteCarlo(
      [
        { id: 'a', name: 'A', baseShare: 0.6, margin: 0.05 },
        { id: 'b', name: 'B', baseShare: 0.4, margin: 0.05 },
      ],
      2000,
    );
    const sum = result.candidates.reduce((s, c) => s + c.winProbability, 0);
    assert.ok(Math.abs(sum - 1) < 0.01, `win probs should sum to 1, got ${sum}`);
  });

  test('higher base share has higher win probability', () => {
    const result = runMonteCarlo(
      [
        { id: 'lead', name: 'Lead', baseShare: 0.7, margin: 0.03 },
        { id: 'trail', name: 'Trail', baseShare: 0.3, margin: 0.03 },
      ],
      2000,
    );
    const lead = result.candidates.find(c => c.candidateId === 'lead')!;
    const trail = result.candidates.find(c => c.candidateId === 'trail')!;
    assert.ok(lead.winProbability > trail.winProbability);
    assert.ok(lead.winProbability > 0.95, `clear leader should win >95% of the time, got ${lead.winProbability}`);
  });

  test('TSE-compliant disclaimer is embedded', () => {
    const result = runMonteCarlo([{ id: 'a', name: 'A', baseShare: 0.5, margin: 0.05 }], 200);
    assert.match(result.disclaimer, /TSE/);
    assert.match(result.disclaimer, /simula/i);
  });
});
