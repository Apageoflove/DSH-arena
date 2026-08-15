/** Verifies the browser module remains import-safe and validates local reports. */

import test from 'node:test';
import assert from 'node:assert/strict';

// The browser half registers with the host loader; materialize its exports
// the same way DSH's web shell does.
let exportsObj;
globalThis.window = { __ModuleLoader__: { load: (spec) => { exportsObj = spec.factory(); } } };
try {
  await import('../src/dsh/client.mjs');
} finally {
  delete globalThis.window;
}
const { apply, createArenaViewModel, parseArenaReport, resolveArenaViewModel } = exportsObj;

test('client import is safe without a browser and exposes an empty view model', () => {
  assert.equal(typeof apply(), 'function');
  assert.deepEqual(createArenaViewModel(), { experiment: null, runs: [], paretoRunIds: [], winnerRunId: undefined, auditAlerts: [] });
});

test('local report parser preserves comparison fields and rejects unrelated JSON', () => {
  const model = parseArenaReport(JSON.stringify({ experiment: { experimentId: 'exp-1' }, runs: [{ runId: 'r1', auditAlerts: ['gate failed'] }], paretoRunIds: ['r1'], winnerRunId: 'r1', auditAlerts: ['review'] }));
  assert.equal(model.winnerRunId, 'r1');
  assert.deepEqual(model.paretoRunIds, ['r1']);
  assert.throws(() => parseArenaReport('{"hello":"world"}'), /not a DSH Arena report/);
  assert.throws(() => parseArenaReport('{bad'), SyntaxError);
});

test('live model falls back to an empty snapshot when report is not ready', () => {
  const model = resolveArenaViewModel({ arena: { getSnapshot: () => ({ experiment: null, runs: [] }), report: () => { throw new Error('no experiment'); } } });
  assert.deepEqual(model, { experiment: null, runs: [], paretoRunIds: [], winnerRunId: undefined, auditAlerts: [] });
});
