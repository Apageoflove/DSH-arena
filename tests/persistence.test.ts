/** Verifies confined, atomic, schema-checked Arena persistence. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { assertArenaSnapshot, loadSnapshot, resolveDataPath, saveSnapshot, type PersistenceFs } from '../src/core/persistence.ts';
import type { ArenaSnapshot } from '../src/core/arena.ts';

const snapshot: ArenaSnapshot = { experiment: null, runs: [] };

/** Builds a deterministic in-memory filesystem and records write ordering. */
function fakeFs(initial = new Map<string, string>()) {
  const files = initial;
  const calls: string[] = [];
  const fs: PersistenceFs = {
    async mkdir(path) { calls.push(`mkdir:${path}`); },
    async writeFile(path, data) { calls.push(`write:${path}`); files.set(path, data); },
    async rename(from, to) { calls.push(`rename:${from}->${to}`); files.set(to, files.get(from)!); files.delete(from); },
    async readFile(path) { if (!files.has(path)) throw new Error('ENOENT'); return files.get(path)!; },
    async unlink(path) { files.delete(path); },
  };
  return { fs, files, calls };
}

test('persistence rejects traversal outside dataRoot', () => {
  assert.throws(() => resolveDataPath('E:/arena/data', '../escape.json'), /escapes dataRoot/);
  assert.throws(() => resolveDataPath('E:/arena/data', 'E:/elsewhere/state.json'), /escapes dataRoot/);
});

test('save writes a same-directory temporary file before atomic rename', async () => {
  const memory = fakeFs();
  await saveSnapshot('E:/arena/data', 'state.json', snapshot, memory.fs);
  assert.match(memory.calls[1], /state\.json\..*\.tmp$/);
  assert.match(memory.calls[2], /^rename:.*\.tmp->.*state\.json$/);
  assert.deepEqual(JSON.parse([...memory.files.values()][0]), snapshot);
});

test('load rejects malformed JSON and invalid snapshot schemas', async () => {
  const target = resolveDataPath('E:/arena/data', 'state.json');
  await assert.rejects(() => loadSnapshot('E:/arena/data', 'state.json', fakeFs(new Map([[target, '{bad']])).fs), SyntaxError);
  await assert.rejects(() => loadSnapshot('E:/arena/data', 'state.json', fakeFs(new Map([[target, '{"experiment":null,"runs":[{}]}']])).fs), /malformed run/);
});

test('validation rejects invented gate states and non-finite metrics', () => {
  const base = { experiment: { experimentId: 'exp', task: 'task', repoSnapshot: 'HEAD', dshCommit: 'sha', createdAt: 'now', candidates: [{}] }, runs: [{ runId: 'run', experimentId: 'exp', candidate: {}, state: 'passed', metrics: { quality: 1 }, gates: [], gateStatus: 'VERIFIED' }] };
  assert.throws(() => assertArenaSnapshot({ ...base, runs: [{ ...base.runs[0], gateStatus: 'MAYBE' }] }), /malformed run/);
  assert.throws(() => assertArenaSnapshot({ ...base, runs: [{ ...base.runs[0], metrics: { quality: Number.NaN } }] }), /malformed metrics/);
});
