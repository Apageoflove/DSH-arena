/** Covers the stateful host-facing Arena store contract. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ArenaStore } from '../src/core/arena.ts';
import type { ArenaRun } from '../src/core/types.ts';

const input = { task: 'make a change', repoSnapshot: 'HEAD', dshCommit: '47f943859bef60e4160492346772ded9b24f765a', candidates: [{ model: 'deepseek' }] };

test('store starts, records, reports, and notifies without leaking mutable state', () => {
  const store = new ArenaStore();
  let changes = 0;
  store.subscribe(() => { changes += 1; });
  const experiment = store.start(input, '2026-08-15T00:00:00.000Z');
  const run: ArenaRun = { runId: 'run-1', experimentId: experiment.experimentId, candidate: { model: 'deepseek' }, state: 'passed', metrics: { quality: 1 }, gates: [{ name: 'policy', status: 'VERIFIED', message: 'ok' }], gateStatus: 'VERIFIED' };
  store.record(run);
  const snapshot = store.getSnapshot();
  snapshot.runs[0].metrics.quality = 0;
  assert.equal(store.getSnapshot().runs[0].metrics.quality, 1);
  assert.equal(store.report().paretoRunIds[0], 'run-1');
  assert.equal(changes, 2);
});

test('store rejects runs from a different experiment', () => {
  const store = new ArenaStore();
  store.start(input, '2026-08-15T00:00:00.000Z');
  assert.throws(() => store.record({ runId: 'run-1', experimentId: 'other', candidate: {}, state: 'failed', metrics: {}, gates: [], gateStatus: 'FAILED' }), /another experiment/);
});

test('store restores deterministically, clears, and isolates listener failures', () => {
  const store = new ArenaStore();
  const experiment = store.start(input, '2026-08-15T00:00:00.000Z');
  let observed = 0;
  store.subscribe(() => { throw new Error('broken view'); });
  store.subscribe(() => { observed += 1; });
  const base = { experimentId: experiment.experimentId, candidate: {}, state: 'passed' as const, metrics: {}, gates: [], gateStatus: 'VERIFIED' as const };
  store.restore({ experiment, runs: [{ ...base, runId: 'run-z' }, { ...base, runId: 'run-a' }] });
  assert.deepEqual(store.getSnapshot().runs.map((run) => run.runId), ['run-a', 'run-z']);
  assert.equal(observed, 1);
  store.clear();
  assert.deepEqual(store.getSnapshot(), { experiment: null, runs: [] });
  assert.equal(observed, 2);
});

test('store rejects a persisted run for another experiment', () => {
  const store = new ArenaStore();
  const experiment = store.start(input, '2026-08-15T00:00:00.000Z');
  assert.throws(() => store.restore({ experiment, runs: [{ runId: 'run-x', experimentId: 'other', candidate: {}, state: 'failed', metrics: {}, gates: [], gateStatus: 'FAILED' }] }), /another experiment/);
});
