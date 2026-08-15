/** Deterministic hard-gate evaluation; failures take precedence over scored comparisons. */

                                                                                           

/** Evaluates all configured gates without executing arbitrary commands. */
export function evaluateGates(policy            , evidence              )               {
  const results               = [];
  if (policy.safetyViolation || evidence.safetyViolation) results.push(result('safety', 'FAILED', 'Safety violation was declared.'));
  if (policy.expectedExitCode !== undefined) {
    const actual = evidence.exitCode;
    results.push(actual === undefined || actual === null
      ? result('exitCode', 'UNVERIFIED', 'Expected exit code has no execution evidence.')
      : actual === policy.expectedExitCode ? result('exitCode', 'VERIFIED', `Exit code ${actual} matched.`) : result('exitCode', 'FAILED', `Expected exit code ${policy.expectedExitCode}, received ${actual}.`));
  }
  if (policy.requiredFiles?.length) {
    const files = new Set(evidence.files ?? []);
    const missing = policy.requiredFiles.filter((file) => !files.has(file));
    results.push(!evidence.files ? result('requiredFiles', 'UNVERIFIED', 'Required-file evidence is absent.')
      : missing.length ? result('requiredFiles', 'FAILED', `Missing required files: ${missing.join(', ')}.`) : result('requiredFiles', 'VERIFIED', 'All required files exist.'));
  }
  if (policy.forbiddenPaths?.length) {
    const changed = evidence.changedPaths;
    const hits = changed?.filter((path) => policy.forbiddenPaths .some((forbidden) => path === forbidden || path.startsWith(`${forbidden}/`))) ?? [];
    results.push(!changed ? result('forbiddenPaths', 'UNVERIFIED', 'Changed-path evidence is absent.')
      : hits.length ? result('forbiddenPaths', 'FAILED', `Forbidden paths changed: ${hits.join(', ')}.`) : result('forbiddenPaths', 'VERIFIED', 'No forbidden paths changed.'));
  }
  if (policy.testCommand) {
    const test = evidence.test;
    results.push(!test ? result('testCommand', 'UNVERIFIED', `No result for required test command: ${policy.testCommand}`)
      : test.command !== policy.testCommand ? result('testCommand', 'STALE', `Evidence command differs from policy: ${test.command}`)
      : test.timedOut ? result('testCommand', 'FAILED', 'Required test command timed out.')
      : test.exitCode === 0 ? result('testCommand', 'VERIFIED', 'Required test command passed.') : result('testCommand', 'FAILED', `Required test command exited ${String(test.exitCode)}.`));
  }
  return results.length ? results : [result('policy', 'NOT_APPLICABLE', 'No hard gates were configured.')];
}

/** Collapses individual results, with FAILED always winning and unknown evidence never becoming verified. */
export function summarizeGateStatus(results              )                     {
  const statuses = new Set(results.map((item) => item.status));
  if (statuses.has('FAILED')) return 'FAILED';
  if (statuses.has('UNVERIFIED')) return 'UNVERIFIED';
  if (statuses.has('STALE')) return 'STALE';
  if (statuses.has('PARTIAL')) return 'PARTIAL';
  if (statuses.has('VERIFIED')) return 'VERIFIED';
  return 'NOT_APPLICABLE';
}

/** Builds one consistently shaped audit result. */
function result(name        , status                    , message        )             {
  return { name, status, message };
}


//# sourceURL=E:\agent\DSH_UI\dsh-arena\src\core\gates.ts