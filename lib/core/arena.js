/** In-memory Arena state store used by the host plugin and deterministic tests. */

import { createExperiment } from './experiment.js';
import { createReport,                  } from './report.js';
                                                                                          

/** Read-only state exposed to the overlay or an adapter transport. */
                                                                                  

/** Coordinates one active experiment without executing hidden DSH commands. */
export class ArenaStore {
          experiment                    = null;
          runs             = [];
                   listeners = new Set            ();

  /** Starts a fresh experiment and clears prior run state. */
  start(input                 , createdAt         )             {
    this.experiment = createExperiment(input, createdAt);
    this.runs = [];
    this.emit();
    return this.experiment;
  }

  /** Records one run belonging to the active experiment. */
  record(run          )       {
    if (!this.experiment) throw new Error('cannot record a run before an experiment starts');
    if (run.experimentId !== this.experiment.experimentId) throw new Error('run belongs to another experiment');
    this.runs = [...this.runs.filter((item) => item.runId !== run.runId), structuredClone(run)]
      .sort((left, right) => left.runId.localeCompare(right.runId));
    this.emit();
  }

  /** Restores a validated persistence snapshot without exposing its mutable references. */
  restore(snapshot               )       {
    if (snapshot.runs.length && !snapshot.experiment) throw new Error('cannot restore runs without an experiment');
    if (snapshot.experiment && snapshot.runs.some((run) => run.experimentId !== snapshot.experiment .experimentId)) {
      throw new Error('persisted run belongs to another experiment');
    }
    this.experiment = snapshot.experiment ? structuredClone(snapshot.experiment) : null;
    this.runs = structuredClone(snapshot.runs).sort((left, right) => left.runId.localeCompare(right.runId));
    this.emit();
  }

  /** Clears all active state and notifies adapters exactly once. */
  clear()       {
    this.experiment = null;
    this.runs = [];
    this.emit();
  }

  /** Returns a defensive snapshot so consumers cannot mutate the store. */
  getSnapshot()                {
    return { experiment: this.experiment ? structuredClone(this.experiment) : null, runs: structuredClone(this.runs) };
  }

  /** Builds the redacted deterministic report for the current experiment. */
  report(directions                   )              {
    if (!this.experiment) throw new Error('cannot report before an experiment starts');
    return createReport(this.experiment, this.runs, directions);
  }

  /** Subscribes to state changes and returns a disposer. */
  subscribe(listener            )             {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Notifies UI adapters after an atomic state update. */
          emit()       {
    for (const listener of [...this.listeners]) {
      // One broken UI subscriber must never prevent persistence or other adapters from observing the update.
      try { listener(); } catch { /* Listener failures are intentionally isolated at this boundary. */ }
    }
  }
}


//# sourceURL=E:\agent\DSH_UI\dsh-arena\src\core\arena.ts