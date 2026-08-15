/** Stable experiment and run identity helpers. */

import { createHash } from 'node:crypto';
import type { CandidateProfile, Experiment, ExperimentInput } from './types.ts';

/** Produces a canonical JSON representation so object key ordering cannot alter identity. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Hashes a stable payload using a short, filesystem-safe identifier. */
export function stableId(prefix: string, payload: unknown): string {
  return `${prefix}_${createHash('sha256').update(stableStringify(payload)).digest('hex').slice(0, 16)}`;
}

/** Creates a reproducible experiment identity from task, snapshot, DSH commit, and profiles. */
export function createExperiment(input: ExperimentInput, createdAt = new Date().toISOString()): Experiment {
  const candidates = input.candidates.map(normalizeCandidate);
  return { ...input, candidates, createdAt, experimentId: stableId('exp', { ...input, candidates }) };
}

/** Creates an id stable for a candidate within a fixed experiment. */
export function createRunId(experimentId: string, candidate: CandidateProfile, ordinal = 0): string {
  return stableId('run', { experimentId, candidate: normalizeCandidate(candidate), ordinal });
}

/** Removes incidental ordering from profile arrays and undefined properties. */
export function normalizeCandidate(candidate: CandidateProfile): CandidateProfile {
  const normalized: CandidateProfile = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) normalized[key as keyof CandidateProfile] = [...value].sort() as never;
    else if (key === 'budgets') normalized.budgets = Object.fromEntries(Object.entries(value as Record<string, number>).sort(([a], [b]) => a.localeCompare(b)));
    else normalized[key as keyof CandidateProfile] = value as never;
  }
  return normalized;
}
