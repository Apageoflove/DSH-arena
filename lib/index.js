/** Official DSH loader entrypoint; publishes the dependency-injected Arena service. */

import Schema from '@deepseek-ai/schemastery';
                                                   
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArenaStore } from './core/arena.js';
import { ArenaOrchestrator,                                                 } from './core/orchestrator.js';
import { loadSnapshot, saveSnapshot } from './core/persistence.js';
import { createReport } from './core/report.js';
                                                                  

/** Stable plugin identity used by Cordis patch entries. */
export const name = 'arena';

/** The browser bridge needs the web server; Cordis parks this entry until it is up. */
export const inject = ['webServer'];

/** Validates the small host-side configuration surface using DSH's Schemastery convention. */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('Enable the DSH Arena service.'),
  runsRoot: Schema.string().default('.dsh-arena/runs').description('Dedicated directory for isolated worktrees.'),
  dataRoot: Schema.string().default('.dsh-arena').description('Root that confines all Arena persistence paths.'),
  persistencePath: Schema.union([Schema.string(), Schema.const(false)]).default('state.json').description('Snapshot path under dataRoot, or false to disable persistence.'),
  persistenceDebounceMs: Schema.number().min(0).default(150).description('Delay used to coalesce snapshot writes.'),
  executionPolicy: Schema.union([Schema.const('allowed'), Schema.const('blocked')]).default('allowed').description('Kill switch for experiment execution: blocked makes the CLI executor refuse to run (no token spend).'),
});

                                                                                                                                                                                               

/** Registers a minimal public service without assuming a private DSH Client or Host API. */
export function apply(ctx         , config         = {})       {
  if (config.enabled === false) return;
  const store = new ArenaStore();
  const dataRoot = config.dataRoot ?? '.dsh-arena';
  const persistencePath = config.persistencePath === undefined ? 'state.json' : config.persistencePath;
  const debounceMs = config.persistenceDebounceMs ?? 150;
  let timer                                           ;
  let pendingWrite                = Promise.resolve();
  let initialized = persistencePath === false;
  let persistenceError         ;
  const flush = async () => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (persistencePath === false) return pendingWrite;
    // A failed write is reported, but it must not poison every future retry in the serialization chain.
    pendingWrite = pendingWrite.catch(() => undefined).then(() => saveSnapshot(dataRoot, persistencePath, store.getSnapshot()));
    try { await pendingWrite; persistenceError = undefined; }
    catch (error) { persistenceError = error; throw error; }
  };
  const ready = persistencePath === false ? Promise.resolve() : loadSnapshot(dataRoot, persistencePath)
    .then((snapshot) => store.restore(snapshot))
    .catch((error         ) => {
      // A first run may lack a state file; malformed or unreadable state remains visible through status and mutation guards.
      if ((error                     )?.code !== 'ENOENT') persistenceError = error;
    })
    .finally(() => { initialized = true; });
  const assertReady = () => {
    if (!initialized) throw new Error('Arena persistence is still loading; await arena.ready before mutating state.');
    if (persistenceError) throw new Error(`Arena persistence is unavailable: ${persistenceError instanceof Error ? persistenceError.message : String(persistenceError)}`);
  };
  const service = {
    version: '0.1.0',
    runsRoot: config.runsRoot ?? '.dsh-arena/runs',
    ready,    getSnapshot: () => store.getSnapshot(),
    startExperiment: (...args                                 ) => { assertReady(); return store.start(...args); },
    recordRun: (...args                                  ) => { assertReady(); return store.record(...args); },
    clear: () => { assertReady(); return store.clear(); },
    report: store.report.bind(store),
    subscribe: store.subscribe.bind(store),
    flush,
    getPersistenceStatus: () => ({ ready: initialized, error: persistenceError instanceof Error ? persistenceError.message : persistenceError === undefined ? undefined : String(persistenceError) }),
    /** Binds only a caller-confirmed DSH adapter; constructing the service never runs commands. */
    bindExecutor: (executor                  , options                      ) => { assertReady(); return new ArenaOrchestrator(store, executor, options); },
  };
  // `provide` is the public Cordis service seam; the fallback keeps the entry testable with a tiny fake context.
  const provide = (ctx                                                                   ).provide;
  if (typeof provide === 'function') provide.call(ctx, 'arena', service);
  else (ctx                                      ).arena = service;

  const installEffect = (ctx                                                                                ).effect;
  const attachPersistence = () => {
    if (persistencePath === false) return () => undefined;
    const unsubscribe = store.subscribe(() => {
      if (timer) clearTimeout(timer);
      // Background failures are retained in service status instead of surfacing as unhandled rejections.
      timer = setTimeout(() => { void flush().catch(() => undefined); }, debounceMs);
    });
    return async () => { unsubscribe(); await flush(); };
  };
  // Cordis owns teardown where available; the fallback still initializes persistence for minimal hosts.
  if (typeof installEffect === 'function') installEffect.call(ctx, attachPersistence);
  else attachPersistence();

  // Kill switch for experiment execution: the CLI executor refuses to run
  // while blocked, so no candidate consumes tokens. Flippable from the panel.
  let executionPolicy                        = config.executionPolicy ?? 'allowed';
  const setExecutionPolicy = (policy                       )       => { executionPolicy = policy; };

  // Per-candidate kill switch: expensive models only join an experiment when
  // enabled here. The CLI executor skips disabled candidates entirely.
  const candidatePolicy = new Map                 ();
  const policyFile = join(dataRoot, 'candidate-policy.json');
  try {
    const raw = readFileSync(policyFile, 'utf8');
    for (const [key, value] of Object.entries(JSON.parse(raw)                           )) {
      if (typeof value === 'boolean') candidatePolicy.set(key, value);
    }
  } catch { /* missing or malformed policy file: every candidate starts enabled */ }
  const persistCandidatePolicy = ()       => {
    try { writeFileSync(policyFile, JSON.stringify(Object.fromEntries(candidatePolicy), null, 2)); } catch { /* best effort */ }
  };
  const candidateKey = (provider                    , model                    )         => `${provider ?? ''}:${model ?? ''}`;
  const candidateList = ()                                                          =>
    [...candidatePolicy].map(([key, enabled]) => {
      const [provider, model] = key.split(':');
      return { provider, model, enabled };
    });

  // In-panel experiment start: the host spawns the CLI runner as a child so
  // the whole flow stays inside DSH. One run at a time.
  const runnerScript = fileURLToPath(new URL('../scripts/run-experiment.mjs', import.meta.url));
  let running = false;
  let lastRunError                    ;
  const startExperimentRun = (task        )                                  => {
    if (executionPolicy === 'blocked') return { ok: false, error: 'experiment execution is disabled (panel switch is off)' };
    if (running) return { ok: false, error: 'an experiment is already running' };
    if (!task.trim()) return { ok: false, error: 'task must not be empty' };
    if (task.length > 4000) return { ok: false, error: 'task too long (max 4000 chars)' };
    const port = (webServer                                 )?.port;
    if (typeof port !== 'number') return { ok: false, error: 'webServer port unavailable' };
    const child = spawn(process.execPath, [runnerScript, '--base-url', `http://127.0.0.1:${port}`, '--task', task, '--cwd', process.cwd()], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    running = true;
    lastRunError = undefined;
    let output = '';
    const collect = (chunk        )       => { output = (output + chunk.toString('utf8')).slice(-4096); };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.once('error', (error) => { running = false; lastRunError = error.message; });
    child.once('close', (code) => {
      running = false;
      if (code !== 0) lastRunError = output.slice(-1000) || `runner exited with code ${String(code)}`;
    });
    return { ok: true };
  };

  // Browser bridge routes, served once the injected webServer is up.
  // Registered through a method call so `this` stays bound to the server.
  const webServer = (ctx                                                                           ).webServer;
  if (typeof webServer?.register === 'function') {
    const json = (res                                                                                                    , body         , status = 200)       => {
      // writeHead() marks headers as sent in current Node, so the content-type
      // must ride in the same call; a later setHeader() would throw.
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    webServer.register({ kind: 'exact', path: '/plugins/arena/policy', handler: async (req                                                                                , res                            ) => {
      if (req.method === 'POST') {
        const chunks           = [];
        try {
          await new Promise      ((resolve, reject) => {
            req.on?.('data', (chunk        ) => chunks.push(chunk));
            req.on?.('end', resolve);
            req.on?.('error', reject);
          });
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))                                ;
          if (payload.executionPolicy !== 'allowed' && payload.executionPolicy !== 'blocked') {
            json(res, { ok: false, error: 'executionPolicy must be "allowed" or "blocked"' }, 400);
            return;
          }
          setExecutionPolicy(payload.executionPolicy);
          json(res, { ok: true, executionPolicy });
        } catch (error) {
          json(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
        }
        return;
      }
      json(res, { ok: true, executionPolicy, running });
    }});
    webServer.register({ kind: 'exact', path: '/plugins/arena/start', handler: async (req                                                               , res                            ) => {
      const chunks           = [];
      try {
        await new Promise      ((resolve, reject) => {
          req.on?.('data', (chunk        ) => chunks.push(chunk));
          req.on?.('end', resolve);
          req.on?.('error', reject);
        });
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))                     ;
        const result = startExperimentRun(payload.task ?? '');
        json(res, { ok: result.ok, error: result.error, running }, result.ok ? 200 : 400);
      } catch (error) {
        json(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
      }
    }});
    webServer.register({ kind: 'exact', path: '/plugins/arena/candidates', handler: async (req                                                                                , res                            ) => {
      if (req.method === 'POST') {
        const chunks           = [];
        try {
          await new Promise      ((resolve, reject) => {
            req.on?.('data', (chunk        ) => chunks.push(chunk));
            req.on?.('end', resolve);
            req.on?.('error', reject);
          });
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))                                                            ;
          if (typeof payload.provider !== 'string' || typeof payload.model !== 'string' || typeof payload.enabled !== 'boolean') {
            json(res, { ok: false, error: 'candidate POST needs provider, model, and enabled' }, 400);
            return;
          }
          candidatePolicy.set(candidateKey(payload.provider, payload.model), payload.enabled);
          persistCandidatePolicy();
          json(res, { ok: true, candidates: candidateList() });
        } catch (error) {
          json(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
        }
        return;
      }
      json(res, { ok: true, candidates: candidateList() });
    }});
    webServer.register({ kind: 'exact', path: '/plugins/arena/snapshot', handler: async (_req         , res                            ) => {
      // store.report() throws before any experiment exists; the panel still
      // needs a valid empty report to render its empty state.
      const snapshot = store.getSnapshot();
      json(res, createReport(snapshot.experiment, snapshot.runs));
    }});
    webServer.register({ kind: 'exact', path: '/plugins/arena/runs', handler: async (req                                                               , res                            ) => {
      const chunks           = [];
      let bytes = 0;
      const cap = 1024 * 1024;
      const fail = (message        , status = 400)       => json(res, { ok: false, error: message }, status);
      try {
        await new Promise      ((resolve, reject) => {
          req.on?.('data', (chunk        ) => {
            bytes += chunk.length;
            if (bytes > cap) { reject(new Error('payload too large')); return; }
            chunks.push(chunk);
          });
          req.on?.('end', resolve);
          req.on?.('error', reject);
        });
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))                                                    ;
        if (executionPolicy === 'blocked') {
          fail('experiment execution is disabled (panel switch is off)', 403);
          return;
        }
        if (payload.experiment) {
          for (const candidate of payload.experiment.candidates) {
            const key = candidateKey(candidate.provider, candidate.model);
            if (!candidatePolicy.has(key)) candidatePolicy.set(key, true);
          }
          store.start(payload.experiment);
          persistCandidatePolicy();
        }
        if (payload.run) {
          store.record(payload.run);
          void flush().catch(() => undefined);
        }
        json(res, { ok: true, report: store.report() });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    }});
  }
}


//# sourceURL=E:\agent\DSH_UI\dsh-arena\src\dsh\plugin.ts