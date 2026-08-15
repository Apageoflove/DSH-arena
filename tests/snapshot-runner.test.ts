/** Exercises path containment and shell-free command execution. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorktreeArgs, validateRunPath } from '../src/core/snapshot.ts';
import { executeCommand } from '../src/core/runner.ts';

test('worktree targets must remain under the dedicated runs root', () => {
  assert.throws(() => validateRunPath('E:/arena/runs', 'E:/arena/other'), /nested/);
  assert.deepEqual(buildWorktreeArgs('E:/repo', 'E:/arena/runs', 'E:/arena/runs/run-1', 'abc'), ['-C', 'E:/repo', 'worktree', 'add', '--detach', 'E:\\arena\\runs\\run-1', 'abc']);
  assert.throws(() => buildWorktreeArgs('E:/repo', 'E:/arena/runs', 'E:/arena/runs/run-1', '--upload-pack=evil'), /dash/);
});

test('runner captures a declared process result without a shell', async () => {
  const result = await executeCommand({ command: process.execPath, args: ['-e', 'process.stdout.write("ok")'] });
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, 'ok');
  assert.equal(result.timedOut, false);
});
