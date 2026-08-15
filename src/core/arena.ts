/** In-memory Arena state store used by the host plugin and deterministic tests. */

import { createExperiment } from './experiment.ts';
import { createReport, type ArenaReport } from './report.ts';
import type { ArenaRun, Experiment, ExperimentInput, MetricDirections } from './types.ts';

/** Read-only state exposed to the overlay or an adapter transport. */
export interface ArenaSnapshot { experiment: Experiment | null; runs: ArenaRun[] }

/** Coordinates one active experiment without executing hidden DSH commands. */
export class ArenaStore {
  private experiment: Experiment | null = null;
  private runs: ArenaRun[] = [];
  private readonly listeners = new Set<() => void>();

  /** Starts a fresh experiment and clears prior run state. */
  start(input: ExperimentInput, createdAt?: string): Experiment {
    this.experiment = createExperiment(input, createdAt);
    this.runs = [];
    this.emit();
    return this.experiment;
  }

  /** Records one run belonging to the active experiment. */
  record(run: ArenaRun): void {
    if (!this.experiment) throw new Error('cannot record a run before an experiment starts');
    if (run.experimentId !== this.experiment.experimentId) throw new Error('run belongs to another experiment');
    this.runs = [...this.runs.filter((item) => item.runId !== run.runId), structuredClone(run)]
      .sort((left, right) => left.runId.localeCompare(right.runId));
    this.emit();
  }

  /** Restores a validated persistence snapshot without exposing its mutable references. */
  restore(snapshot: ArenaSnapshot): void {
    if (snapshot.runs.length && !snapshot.experiment) throw new Error('cannot restore runs without an experiment');
    if (snapshot.experiment && snapshot.runs.some((run) => run.experimentId !== snapshot.experiment!.experimentId)) {
      throw new Error('persisted run belongs to another experiment');
    }
    this.experiment = snapshot.experiment ? structuredClone(snapshot.experiment) : null;
    this.runs = structuredClone(snapshot.runs).sort((left, right) => left.runId.localeCompare(right.runId));
    this.emit();
  }

  /** Clears all active state and notifies adapters exactly once. */
  clear(): void {
    this.experiment = null;
    this.runs = [];
    this.emit();
  }

  /** Returns a defensive snapshot so consumers cannot mutate the store. */
  getSnapshot(): ArenaSnapshot {
    return { experiment: this.experiment ? structuredClone(this.experiment) : null, runs: structuredClone(this.runs) };
  }

  /** Builds the redacted deterministic report for the current experiment. */
  report(directions?: MetricDirections): ArenaReport {
    if (!this.experiment) throw new Error('cannot report before an experiment starts');
    return createReport(this.experiment, this.runs, directions);
  }

  /** Subscribes to state changes and returns a disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Notifies UI adapters after an atomic state update. */
  private emit(): void {
    for (const listener of [...this.listeners]) {
      // One broken UI subscriber must never prevent persistence or other adapters from observing the update.
      try { listener(); } catch { /* Listener failures are intentionally isolated at this boundary. */ }
    }
  }
}
