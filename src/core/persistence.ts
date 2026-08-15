/** Atomic, path-confined JSON persistence for DSH Arena snapshots. */

import { randomUUID } from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { ArenaSnapshot } from './arena.ts';

/** Minimal filesystem seam used to test atomic persistence without touching a real disk. */
export interface PersistenceFs {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeFile(path: string, data: string, encoding: 'utf8'): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  unlink?(path: string): Promise<unknown>;
}

/** Resolves a data file and rejects absolute or relative traversal outside dataRoot. */
export function resolveDataPath(dataRoot: string, filePath: string): string {
  const root = resolve(dataRoot);
  const target = isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath);
  const fromRoot = relative(root, target);
  if (fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) {
    throw new Error(`persistence path escapes dataRoot: ${filePath}`);
  }
  return target;
}

/** Persists a snapshot through a same-directory temporary file followed by atomic rename. */
export async function saveSnapshot(dataRoot: string, filePath: string, snapshot: ArenaSnapshot, fs: PersistenceFs = nodeFs): Promise<void> {
  assertArenaSnapshot(snapshot);
  const target = resolveDataPath(dataRoot, filePath);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.mkdir(dirname(target), { recursive: true });
  try {
    await fs.writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    // Rename within one directory prevents observers from reading a partially written snapshot.
    await fs.rename(temporary, target);
  } catch (error) {
    if (fs.unlink) await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/** Reads and validates one snapshot; malformed JSON and invalid shapes remain explicit failures. */
export async function loadSnapshot(dataRoot: string, filePath: string, fs: PersistenceFs = nodeFs): Promise<ArenaSnapshot> {
  const target = resolveDataPath(dataRoot, filePath);
  const parsed = JSON.parse(await fs.readFile(target, 'utf8')) as unknown;
  assertArenaSnapshot(parsed);
  return structuredClone(parsed);
}

/** Performs the minimum runtime validation needed before persisted data enters ArenaStore. */
export function assertArenaSnapshot(value: unknown): asserts value is ArenaSnapshot {
  const verificationStatuses = new Set(['VERIFIED', 'PARTIAL', 'FAILED', 'STALE', 'UNVERIFIED', 'NOT_APPLICABLE']);
  if (!isRecord(value) || !('experiment' in value) || !Array.isArray(value.runs)) throw new Error('invalid Arena snapshot: expected experiment and runs');
  if (value.experiment !== null) {
    const experiment = value.experiment;
    if (!isRecord(experiment) || !isString(experiment.experimentId) || !isString(experiment.task) || !isString(experiment.repoSnapshot)
      || !isString(experiment.dshCommit) || !isString(experiment.createdAt) || !Array.isArray(experiment.candidates)) {
      throw new Error('invalid Arena snapshot: malformed experiment');
    }
  }
  for (const run of value.runs) {
    if (!isRecord(run) || !isString(run.runId) || !isString(run.experimentId) || !isRecord(run.candidate)
      || !['queued', 'running', 'passed', 'failed', 'blocked'].includes(String(run.state)) || !isRecord(run.metrics)
      || !Array.isArray(run.gates) || !isString(run.gateStatus) || !verificationStatuses.has(run.gateStatus)) {
      throw new Error('invalid Arena snapshot: malformed run');
    }
    if (run.gates.some((gate) => !isRecord(gate) || !isString(gate.name) || !isString(gate.message)
      || !isString(gate.status) || !verificationStatuses.has(gate.status))) {
      throw new Error('invalid Arena snapshot: malformed gate evidence');
    }
    if (Object.values(run.metrics).some((metric) => metric !== undefined && (typeof metric !== 'number' || !Number.isFinite(metric)))) {
      throw new Error('invalid Arena snapshot: malformed metrics');
    }
  }
}

/** Narrows unknown JSON values to a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

/** Narrows required identifier fields. */
function isString(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
