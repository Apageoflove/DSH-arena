/** Covers hard-gate precedence and evidence status behavior. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGates, summarizeGateStatus } from '../src/core/gates.ts';

test('a safety failure overrides otherwise verified gates', () => {
  const gates = evaluateGates({ expectedExitCode: 0, safetyViolation: true }, { exitCode: 0 });
  assert.equal(summarizeGateStatus(gates), 'FAILED');
  assert.equal(gates[0].name, 'safety');
});

test('missing evidence stays unverified rather than passing', () => {
  const gates = evaluateGates({ requiredFiles: ['out.txt'], testCommand: 'npm test' }, {});
  assert.equal(summarizeGateStatus(gates), 'UNVERIFIED');
  assert.deepEqual(gates.map((item) => item.status), ['UNVERIFIED', 'UNVERIFIED']);
});

test('stale test evidence is not treated as verified', () => {
  const gates = evaluateGates({ testCommand: 'node --test' }, { test: { command: 'npm test', exitCode: 0 } });
  assert.equal(gates[0].status, 'STALE');
});
