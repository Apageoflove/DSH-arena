/** Exercises Arena queue lifecycle, gates, failure, timeout, and cancellation. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ArenaStore } from '../src/core/arena.ts';
import { ArenaOrchestrator } from '../src/core/orchestrator.ts';

const input = { task: 'task', repoSnapshot: 'HEAD', dshCommit: 'locked', candidates: [{ model: 'a' }, { model: 'b' }] };

test('queue respects serial concurrency and applies hard gates', async () => {
  const store = new ArenaStore(); store.start(input, '2026-08-15T00:00:00.000Z');
  let active = 0; let maximum = 0;
  const queue = new ArenaOrchestrator(store, async ({ candidate }) => {
    active += 1; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1;
    return { evidence: { exitCode: candidate.model === 'a' ? 0 : 2 }, metrics: { quality: 0.9 }, output: 'done' };
  }, { maxConcurrency: 1, gatePolicy: { expectedExitCode: 0 } });
  queue.enqueue(); await queue.waitForIdle();
  assert.equal(maximum, 1);
  assert.deepEqual(store.getSnapshot().runs.map((run) => run.state).sort(), ['failed', 'passed']);
  assert.ok(store.getSnapshot().runs.every((run) => typeof run.metrics.durationMs === 'number'));
});

test('executor rejection and timeout cannot become passed', async () => {
  const failedStore = new ArenaStore(); failedStore.start({ ...input, candidates: [{ model: 'x' }] });
  const failed = new ArenaOrchestrator(failedStore, async () => { throw new Error('adapter failed'); });
  failed.enqueue(); await failed.waitForIdle();
  assert.equal(failedStore.getSnapshot().runs[0].state, 'failed');
  assert.equal(failedStore.getSnapshot().runs[0].gateStatus, 'FAILED');

  const timedStore = new ArenaStore(); timedStore.start({ ...input, candidates: [{ model: 'slow' }] });
  const timed = new ArenaOrchestrator(timedStore, ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })), { timeoutMs: 5 });
  timed.enqueue(); await timed.waitForIdle();
  assert.equal(timedStore.getSnapshot().runs[0].state, 'failed');
  assert.match(timedStore.getSnapshot().runs[0].auditAlerts![0], /timed out/);
});

test('missing execution evidence is blocked instead of becoming passed', async () => {
  const store = new ArenaStore(); store.start({ ...input, candidates: [{ model: 'unknown' }] });
  const queue = new ArenaOrchestrator(store, async () => ({ evidence: {} }));
  queue.enqueue(); await queue.waitForIdle();
  assert.equal(store.getSnapshot().runs[0].state, 'blocked');
  assert.equal(store.getSnapshot().runs[0].gateStatus, 'UNVERIFIED');
});

test('cancels queued and running work through explicit blocked states', async () => {
  const store = new ArenaStore(); store.start(input);
  const queue = new ArenaOrchestrator(store, ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })));
  const [running, queued] = queue.enqueue();
  assert.equal(queue.cancel(queued), true);
  assert.equal(queue.cancel(running), true);
  await queue.waitForIdle();
  assert.ok(store.getSnapshot().runs.every((run) => run.state === 'blocked'));
  assert.ok(store.getSnapshot().runs.every((run) => run.gateStatus === 'UNVERIFIED'));
});

test('late results from a previous experiment cannot contaminate a replacement experiment', async () => {
  const store = new ArenaStore(); store.start({ ...input, candidates: [{ model: 'old' }] });
  let release!: () => void;
  const queue = new ArenaOrchestrator(store, async () => { await new Promise<void>((resolve) => { release = resolve; }); return { evidence: { exitCode: 0 } }; });
  queue.enqueue();
  store.start({ ...input, task: 'replacement', candidates: [{ model: 'new' }] });
  release(); await queue.waitForIdle();
  assert.equal(store.getSnapshot().experiment?.task, 'replacement');
  assert.deepEqual(store.getSnapshot().runs, []);
});
