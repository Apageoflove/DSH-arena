/** Verifies Pareto eligibility and credential redaction. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { dominates, paretoFront, recommendWinner } from '../src/core/pareto.ts';
import { redactText, redactValue } from '../src/core/redact.ts';
import type { ArenaRun } from '../src/core/types.ts';

const run = (runId: string, quality: number, cost: number, gateStatus: ArenaRun['gateStatus'] = 'VERIFIED'): ArenaRun => ({ runId, experimentId: 'exp', candidate: {}, state: 'passed', metrics: { quality, success: 1, cost, durationMs: 1, tokens: 1, errors: 0 }, gates: [], gateStatus });

test('Pareto excludes non-verified runs and keeps non-dominated tradeoffs', () => {
  const cheap = run('cheap', 0.8, 1);
  const quality = run('quality', 0.9, 2);
  const blocked = run('blocked', 1, 0, 'FAILED');
  assert.equal(dominates(quality, cheap), false);
  assert.deepEqual(paretoFront([cheap, quality, blocked]).map((item) => item.runId).sort(), ['cheap', 'quality']);
  assert.equal(recommendWinner([cheap, quality])?.runId, 'quality');
});

test('redaction removes field values and inline provider credentials', () => {
  assert.equal(redactText('Authorization: Bearer top-secret API_KEY=abc'), 'Authorization:[REDACTED] API_KEY=[REDACTED]');
  assert.deepEqual(redactValue({ apiKey: 'abc', nested: { password: 'pw', note: 'token=xyz' } }), { apiKey: '[REDACTED]', nested: { password: '[REDACTED]', note: 'token=[REDACTED]' } });
});

test('redaction preserves numeric token-count metrics for Pareto reports', () => {
  assert.deepEqual(redactValue({ metrics: { tokens: 42 } }), { metrics: { tokens: 42 } });
});
