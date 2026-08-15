/** Verifies the framework-free host adapter does not require a real DSH instance. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, name } from '../src/dsh/plugin.mjs';

test('plugin applies an Arena service to a fake Cordis context', () => {
  const ctx = {};
  apply(ctx, { runsRoot: 'E:/arena/runs' });
  assert.equal(name, 'arena');
  assert.equal(ctx.arena.runsRoot, 'E:/arena/runs');
  assert.deepEqual(ctx.arena.getSnapshot(), { experiment: null, runs: [] });
});

test('disabled plugin does not mutate the context', () => {
  const ctx = {};
  apply(ctx, { enabled: false });
  assert.equal('arena' in ctx, false);
});
