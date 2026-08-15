/** Verifies all report formats preserve audit status while redacting secrets. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperiment } from '../src/core/experiment.ts';
import { createReport, exportJson, exportJsonl, exportMarkdown } from '../src/core/report.ts';
import type { ArenaRun } from '../src/core/types.ts';

test('report exports include DSH commit, audit state, and no raw API key', () => {
  const experiment = createExperiment({ task: 'api_key=bad', repoSnapshot: 'sha', dshCommit: '47f9438', candidates: [{}] }, '2026-01-01T00:00:00.000Z');
  const run: ArenaRun = { runId: 'run1', experimentId: experiment.experimentId, candidate: {}, state: 'passed', metrics: { quality: 1 }, gateStatus: 'VERIFIED', gates: [{ name: 'test', status: 'VERIFIED', message: 'passed' }], auditAlerts: ['token=private'] };
  const report = createReport(experiment, [run]);
  for (const output of [exportJson(report), exportJsonl(report), exportMarkdown(report)]) {
    assert.match(output, /47f9438/);
    assert.match(output, /VERIFIED/);
    assert.doesNotMatch(output, /private|bad/);
  }
});
