/** Stable experiment and run identity helpers. */

import { createHash } from 'node:crypto';
                                                                                

/** Produces a canonical JSON representation so object key ordering cannot alter identity. */
export function stableStringify(value         )         {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value                           ;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Hashes a stable payload using a short, filesystem-safe identifier. */
export function stableId(prefix        , payload         )         {
  return `${prefix}_${createHash('sha256').update(stableStringify(payload)).digest('hex').slice(0, 16)}`;
}

/** Creates a reproducible experiment identity from task, snapshot, DSH commit, and profiles. */
export function createExperiment(input                 , createdAt = new Date().toISOString())             {
  const candidates = input.candidates.map(normalizeCandidate);
  return { ...input, candidates, createdAt, experimentId: stableId('exp', { ...input, candidates }) };
}

/** Creates an id stable for a candidate within a fixed experiment. */
export function createRunId(experimentId        , candidate                  , ordinal = 0)         {
  return stableId('run', { experimentId, candidate: normalizeCandidate(candidate), ordinal });
}

/** Removes incidental ordering from profile arrays and undefined properties. */
export function normalizeCandidate(candidate                  )                   {
  const normalized                   = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) normalized[key                          ] = [...value].sort()         ;
    else if (key === 'budgets') normalized.budgets = Object.fromEntries(Object.entries(value                          ).sort(([a], [b]) => a.localeCompare(b)));
    else normalized[key                          ] = value         ;
  }
  return normalized;
}


//# sourceURL=E:\agent\DSH_UI\dsh-arena\src\core\experiment.ts