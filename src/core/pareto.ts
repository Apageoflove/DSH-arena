/** Pareto ranking for hard-gate-eligible Arena runs. */

import type { ArenaRun, MetricDirections, MetricName } from './types.ts';

const DEFAULT_DIRECTIONS: Required<MetricDirections> = { quality: 'max', success: 'max', durationMs: 'min', tokens: 'min', cost: 'min', errors: 'min' };

/** Returns true only when left is at least as good on every observed metric and better on one. */
export function dominates(left: ArenaRun, right: ArenaRun, directions: MetricDirections = {}): boolean {
  let strictlyBetter = false;
  for (const metric of Object.keys(DEFAULT_DIRECTIONS) as MetricName[]) {
    const a = left.metrics[metric];
    const b = right.metrics[metric];
    // Missing measurements cannot be invented or used to dominate another run.
    if (a === undefined || b === undefined) continue;
    const direction = directions[metric] ?? DEFAULT_DIRECTIONS[metric];
    if (direction === 'max' ? a < b : a > b) return false;
    if (a !== b) strictlyBetter = true;
  }
  return strictlyBetter;
}

/** Filters to hard-gate-passing runs and returns their non-dominated frontier. */
export function paretoFront(runs: ArenaRun[], directions: MetricDirections = {}): ArenaRun[] {
  const eligible = runs.filter((run) => run.gateStatus === 'VERIFIED' && run.state === 'passed');
  return eligible.filter((candidate) => !eligible.some((other) => other.runId !== candidate.runId && dominates(other, candidate, directions)));
}

/** Selects a transparent tie-breaker from the Pareto frontier without asserting a judge verdict. */
export function recommendWinner(frontier: ArenaRun[]): ArenaRun | undefined {
  return [...frontier].sort((a, b) => {
    const quality = (b.metrics.quality ?? Number.NEGATIVE_INFINITY) - (a.metrics.quality ?? Number.NEGATIVE_INFINITY);
    if (quality) return quality;
    const success = (b.metrics.success ?? Number.NEGATIVE_INFINITY) - (a.metrics.success ?? Number.NEGATIVE_INFINITY);
    if (success) return success;
    const cost = (a.metrics.cost ?? Number.POSITIVE_INFINITY) - (b.metrics.cost ?? Number.POSITIVE_INFINITY);
    if (cost) return cost;
    return a.runId.localeCompare(b.runId);
  })[0];
}
