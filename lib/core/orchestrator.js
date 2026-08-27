/** Explicit-adapter run queue for DSH Arena experiments. */

import { createRunId } from './experiment.js';
import { evaluateGates, summarizeGateStatus } from './gates.js';
                                             
                                                                                                               

/** Input delivered only to a caller-supplied DSH adapter. */
                                                                                                                                 

/** Auditable output expected from an explicit execution adapter. */
                                                                                                                              

/** A confirmed adapter owns all DSH invocation details; Arena never guesses a command. */
                                                                                             

/** Queue controls with conservative serial execution by default. */
                                                                                                              

                                                                                                                                                               

/** Coordinates candidate lifecycle, cancellation, timeouts, gates, and store updates. */
export class ArenaOrchestrator {
                   store            ;
                   executor                  ;
                   options                     ;
                   pending              = [];
                   active = new Map                   ();
                   idleWaiters = new Set            ();
                   maxConcurrency        ;

  constructor(store            , executor                  , options                      = {}) {
    this.store = store;
    this.executor = executor;
    this.options = options;
    this.maxConcurrency = options.maxConcurrency ?? 1;
    if (!Number.isInteger(this.maxConcurrency) || this.maxConcurrency < 1) throw new Error('maxConcurrency must be a positive integer');
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error('timeoutMs must be positive');
  }

  /** Enqueues candidates for the active experiment and starts work up to the concurrency limit. */
  enqueue(candidates                     )           {
    const snapshot = this.store.getSnapshot();
    if (!snapshot.experiment) throw new Error('cannot enqueue before an experiment starts');
    const selected = candidates ?? snapshot.experiment.candidates;
    const offset = snapshot.runs.length;
    const ids = selected.map((candidate, index) => {
      const item            = { candidate: structuredClone(candidate), experiment: structuredClone(snapshot.experiment ), ordinal: offset + index, runId: createRunId(snapshot.experiment .experimentId, candidate, offset + index) };
      this.pending.push(item);
      this.store.record(this.makeRun(snapshot.experiment , item, 'queued'));
      return item.runId;
    });
    this.pump();
    return ids;
  }

  /** Cancels a queued or running candidate; running adapters receive AbortSignal. */
  cancel(runId        )          {
    const queuedIndex = this.pending.findIndex((item) => item.runId === runId);
    if (queuedIndex >= 0) {
      const [item] = this.pending.splice(queuedIndex, 1);
      item.cancelled = true;
      this.finishCancelled(item);
      this.resolveIdleIfNeeded();
      return true;
    }
    const active = this.active.get(runId);
    if (!active) return false;
    active.cancelled = true;
    active.controller?.abort(new Error('Arena run cancelled'));
    return true;
  }

  /** Resolves after both the pending queue and active adapter set are empty. */
  waitForIdle()                {
    if (!this.pending.length && !this.active.size) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  /** Starts queued work while respecting the configured concurrency boundary. */
          pump()       {
    while (this.active.size < this.maxConcurrency && this.pending.length) {
      const item = this.pending.shift() ;
      void this.execute(item);
    }
    this.resolveIdleIfNeeded();
  }

  /** Executes one item and converts every terminal path into explicit Arena evidence. */
          async execute(item           )                {
    const experiment = item.experiment;
    if (!this.isCurrent(experiment.experimentId)) return;
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    item.controller = new AbortController();
    this.active.set(item.runId, item);
    if (!this.recordIfCurrent({ ...this.makeRun(experiment, item, 'running'), startedAt })) return;
    let timeout                                           ;
    try {
      const timeoutPromise = this.options.timeoutMs === undefined ? undefined : new Promise       ((_, reject) => {
        timeout = setTimeout(() => {
          item.controller .abort(new Error('Arena run timed out'));
          reject(new Error('Arena run timed out'));
        }, this.options.timeoutMs);
      });
      const result = await (timeoutPromise ? Promise.race([this.executor({ experiment, candidate: item.candidate, runId: item.runId, signal: item.controller.signal }), timeoutPromise]) : this.executor({ experiment, candidate: item.candidate, runId: item.runId, signal: item.controller.signal }));
      if (item.cancelled) { this.finishCancelled(item, startedAt, started); return; }
      const executorFailed = result.evidence.exitCode !== undefined && result.evidence.exitCode !== null && result.evidence.exitCode !== 0;
      const gates = evaluateGates(this.options.gatePolicy ?? {}, result.evidence);
      if (this.options.gatePolicy?.expectedExitCode === undefined) {
        const exitCode = result.evidence.exitCode;
        gates.push(exitCode === undefined || exitCode === null
          ? { name: 'execution', status: 'UNVERIFIED', message: 'Execution adapter returned no exit-code evidence.' }
          : exitCode === 0
            ? { name: 'execution', status: 'VERIFIED', message: 'Execution exited successfully.' }
            : { name: 'execution', status: 'FAILED', message: `Execution exited ${String(exitCode)}.` });
      }
      const gateStatus = summarizeGateStatus(gates);
      const state = executorFailed || gateStatus === 'FAILED' ? 'failed' : gateStatus === 'UNVERIFIED' || gateStatus === 'STALE' || gateStatus === 'PARTIAL' ? 'blocked' : 'passed';
      this.recordIfCurrent({ runId: item.runId, experimentId: experiment.experimentId, candidate: item.candidate, state, startedAt, endedAt: new Date().toISOString(), metrics: { ...result.metrics, durationMs: result.metrics?.durationMs ?? Date.now() - started }, gates, gateStatus, output: result.output, auditAlerts: result.auditAlerts });
    } catch (error) {
      const cancelled = item.cancelled;
      const message = error instanceof Error ? error.message : String(error);
      this.recordIfCurrent({ runId: item.runId, experimentId: experiment.experimentId, candidate: item.candidate, state: cancelled ? 'blocked' : 'failed', startedAt, endedAt: new Date().toISOString(), metrics: { durationMs: Date.now() - started, errors: cancelled ? 0 : 1 }, gates: [{ name: cancelled ? 'cancellation' : 'execution', status: cancelled ? 'UNVERIFIED' : 'FAILED', message }], gateStatus: cancelled ? 'UNVERIFIED' : 'FAILED', auditAlerts: [message] });
    } finally {
      if (timeout) clearTimeout(timeout);
      this.active.delete(item.runId);
      this.pump();
    }
  }

  /** Records cancellation without allowing the run to enter ranking. */
          finishCancelled(item           , startedAt         , started         )       {
    const experiment = item.experiment;
    this.recordIfCurrent({ runId: item.runId, experimentId: experiment.experimentId, candidate: item.candidate, state: 'blocked', startedAt, endedAt: new Date().toISOString(), metrics: started === undefined ? {} : { durationMs: Date.now() - started }, gates: [{ name: 'cancellation', status: 'UNVERIFIED', message: 'Run was cancelled.' }], gateStatus: 'UNVERIFIED', auditAlerts: ['Run was cancelled.'] });
  }

  /** Creates a consistent non-terminal run record. */
          makeRun(experiment            , item           , state                      )           {
    return { runId: item.runId, experimentId: experiment.experimentId, candidate: item.candidate, state, metrics: {}, gates: [], gateStatus: 'UNVERIFIED' };
  }

  /** Prevents late results from an older experiment from contaminating a newly started one. */
          recordIfCurrent(run          )          {
    if (!this.isCurrent(run.experimentId)) return false;
    this.store.record(run);
    return true;
  }

  /** Checks the active experiment identity at the exact mutation boundary. */
          isCurrent(experimentId        )          {
    return this.store.getSnapshot().experiment?.experimentId === experimentId;
  }

  /** Releases all waiters once no work remains. */
          resolveIdleIfNeeded()       {
    if (this.pending.length || this.active.size) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}


//# sourceURL=E:\agent\DSH_UI\dsh-arena\src\core\orchestrator.ts