/** Verifies stable, credential-free experiment identities. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperiment, createRunId } from '../src/core/experiment.ts';

test('experiment and run ids remain stable despite profile key and array order', () => {
  const base = { task: 'fix test', repoSnapshot: 'abc123', dshCommit: '47f9438', candidates: [{ model: 'x', plugins: ['b', 'a'], budgets: { tokens: 20, time: 10 } }] };
  const swapped = { ...base, candidates: [{ budgets: { time: 10, tokens: 20 }, plugins: ['a', 'b'], model: 'x' }] };
  const first = createExperiment(base, '2026-01-01T00:00:00.000Z');
  const second = createExperiment(swapped, '2026-02-01T00:00:00.000Z');
  assert.equal(first.experimentId, second.experimentId);
  assert.equal(createRunId(first.experimentId, first.candidates[0]), createRunId(second.experimentId, second.candidates[0]));
});
