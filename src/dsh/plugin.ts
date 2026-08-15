/** Official DSH loader entrypoint; publishes the dependency-injected Arena service. */

import Schema from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
import { spawn } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArenaStore } from '../core/arena.ts';
import { ArenaOrchestrator, type ArenaRunExecutor, type OrchestratorOptions } from '../core/orchestrator.ts';
import { loadSnapshot, saveSnapshot } from '../core/persistence.ts';
import { createReport } from '../core/report.ts';
import type { ArenaRun, ExperimentInput } from '../core/types.ts';

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

export interface Config { enabled?: boolean; runsRoot?: string; dataRoot?: string; persistencePath?: string | false; persistenceDebounceMs?: number; executionPolicy?: 'allowed' | 'blocked'; }

/** Registers a minimal public service without assuming a private DSH Client or Host API. */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return;
  const store = new ArenaStore();
  const dataRoot = config.dataRoot ?? '.dsh-arena';
  const persistencePath = config.persistencePath === undefined ? 'state.json' : config.persistencePath;
  const debounceMs = config.persistenceDebounceMs ?? 150;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingWrite: Promise<void> = Promise.resolve();
  let initialized = persistencePath === false;
  let persistenceError: unknown;
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
    .catch((error: unknown) => {
      // A first run may lack a state file; malformed or unreadable state remains visible through status and mutation guards.
      if ((error as { code?: string })?.code !== 'ENOENT') persistenceError = error;
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
    startExperiment: (...args: Parameters<ArenaStore['start']>) => { assertReady(); return store.start(...args); },
    recordRun: (...args: Parameters<ArenaStore['record']>) => { assertReady(); return store.record(...args); },
    clear: () => { assertReady(); return store.clear(); },
    report: store.report.bind(store),
    subscribe: store.subscribe.bind(store),
    flush,
    getPersistenceStatus: () => ({ ready: initialized, error: persistenceError instanceof Error ? persistenceError.message : persistenceError === undefined ? undefined : String(persistenceError) }),
    /** Binds only a caller-confirmed DSH adapter; constructing the service never runs commands. */
    bindExecutor: (executor: ArenaRunExecutor, options?: OrchestratorOptions) => { assertReady(); return new ArenaOrchestrator(store, executor, options); },
  };
  // `provide` is the public Cordis service seam; the fallback keeps the entry testable with a tiny fake context.
  const provide = (ctx as unknown as { provide?: (name: string, value: unknown) => void }).provide;
  if (typeof provide === 'function') provide.call(ctx, 'arena', service);
  else (ctx as unknown as Record<string, unknown>).arena = service;

  const installEffect = (ctx as unknown as { effect?: (effect: () => (() => void | Promise<void>)) => void }).effect;
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
  let executionPolicy: 'allowed' | 'blocked' = config.executionPolicy ?? 'allowed';
  const setExecutionPolicy = (policy: 'allowed' | 'blocked'): void => { executionPolicy = policy; };

  // Per-candidate kill switch: expensive models only join an experiment when
  // enabled here. The CLI executor skips disabled candidates entirely.
  // The whole policy (master + per-model) lives in ONE file under the user's
  // home so the browser version and the desktop app share identical state:
  // toggling the master never touches the model switches, and a restart on
  // either host does not reset them.
  const candidatePolicy = new Map<string, boolean>();
  const policyFile = join(homedir(), '.dsh', 'arena-policy.json');
  let policyMtime = 0;
  const loadPolicyFile = (): void => {
    try {
      const mtime = statSync(policyFile).mtimeMs;
      if (mtime === policyMtime) return;
      const raw = readFileSync(policyFile, 'utf8');
      const parsed = JSON.parse(raw) as { executionPolicy?: string; candidates?: Record<string, unknown> };
      if (parsed.executionPolicy === 'allowed' || parsed.executionPolicy === 'blocked') executionPolicy = parsed.executionPolicy;
      if (parsed.candidates && typeof parsed.candidates === 'object') {
        for (const [key, value] of Object.entries(parsed.candidates)) {
          if (typeof value === 'boolean') candidatePolicy.set(key, value);
        }
      }
      policyMtime = mtime;
    } catch { /* missing or malformed policy file: keep the current state */ }
  };
  const persistPolicy = (): void => {
    try {
      const file = JSON.stringify({ executionPolicy, candidates: Object.fromEntries(candidatePolicy) }, null, 2);
      writeFileSync(policyFile, file);
      policyMtime = statSync(policyFile).mtimeMs;
    } catch { /* best effort */ }
  };
  loadPolicyFile();
  const candidateKey = (provider: string | undefined, model: string | undefined): string => `${provider ?? ''}:${model ?? ''}`;
  const candidateList = (): { provider: string; model: string; enabled: boolean }[] =>
    [...candidatePolicy].map(([key, enabled]) => {
      const [provider, model] = key.split(':');
      return { provider, model, enabled };
    });

  // In-panel experiment start: the host spawns the CLI runner as a child so
  // the whole flow stays inside DSH. One run at a time.
  const runnerScript = fileURLToPath(new URL('../scripts/run-experiment.mjs', import.meta.url));
  let running = false;
  let lastRunError: string | undefined;
  const startExperimentRun = (task: string): { ok: boolean; error?: string } => {
    if (executionPolicy === 'blocked') return { ok: false, error: 'experiment execution is disabled (panel switch is off)' };
    if (running) return { ok: false, error: 'an experiment is already running' };
    if (!task.trim()) return { ok: false, error: 'task must not be empty' };
    if (task.length > 4000) return { ok: false, error: 'task too long (max 4000 chars)' };
    const port = (webServer as { port?: number } | undefined)?.port;
    if (typeof port !== 'number') return { ok: false, error: 'webServer port unavailable' };
    const child = spawn(process.execPath, [runnerScript, '--base-url', `http://localhost:${port}`, '--task', task, '--cwd', process.cwd()], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    running = true;
    lastRunError = undefined;
    let output = '';
    const collect = (chunk: Buffer): void => { output = (output + chunk.toString('utf8')).slice(-4096); };
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
  const webServer = (ctx as unknown as { webServer?: { register: (route: unknown) => () => void } }).webServer;
  if (typeof webServer?.register === 'function') {
    const json = (res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (b: string) => void }, body: unknown, status = 200): void => {
      // writeHead() marks headers as sent in current Node, so the content-type
      // must ride in the same call; a later setHeader() would throw.
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    webServer.register({ kind: 'exact', path: '/plugins/arena/policy', handler: async (req: { method?: string; on?: (event: string, cb: (chunk: Buffer) => void) => void }, res: Parameters<typeof json>[0]) => {
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        try {
          await new Promise<void>((resolve, reject) => {
            req.on?.('data', (chunk: Buffer) => chunks.push(chunk));
            req.on?.('end', resolve);
            req.on?.('error', reject);
          });
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { executionPolicy?: string };
          if (payload.executionPolicy !== 'allowed' && payload.executionPolicy !== 'blocked') {
            json(res, { ok: false, error: 'executionPolicy must be "allowed" or "blocked"' }, 400);
            return;
          }
          setExecutionPolicy(payload.executionPolicy);
          persistPolicy();
          json(res, { ok: true, executionPolicy });
        } catch (error) {
          json(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
        }
        return;
      }
      loadPolicyFile();
      json(res, { ok: true, executionPolicy, running });
    }});
    webServer.register({ kind: 'exact', path: '/plugins/arena/start', handler: async (req: { on?: (event: string, cb: (chunk: Buffer) => void) => void }, res: Parameters<typeof json>[0]) => {
      const chunks: Buffer[] = [];
      try {
        await new Promise<void>((resolve, reject) => {
          req.on?.('data', (chunk: Buffer) => chunks.push(chunk));
          req.on?.('end', resolve);
          req.on?.('error', reject);
        });
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { task?: string };
        const result = startExperimentRun(payload.task ?? '');
        json(res, { ok: result.ok, error: result.error, running }, result.ok ? 200 : 400);
      } catch (error) {
        json(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
      }
    }});
    webServer.register({ kind: 'exact', path: '/plugins/arena/candidates', handler: async (req: { method?: string; on?: (event: string, cb: (chunk: Buffer) => void) => void }, res: Parameters<typeof json>[0]) => {
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        try {
          await new Promise<void>((resolve, reject) => {
            req.on?.('data', (chunk: Buffer) => chunks.push(chunk));
            req.on?.('end', resolve);
            req.on?.('error', reject);
          });
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { provider?: string; model?: string; enabled?: boolean };
          if (typeof payload.provider !== 'string' || typeof payload.model !== 'string' || typeof payload.enabled !== 'boolean') {
            json(res, { ok: false, error: 'candidate POST needs provider, model, and enabled' }, 400);
            return;
          }
          candidatePolicy.set(candidateKey(payload.provider, payload.model), payload.enabled);
          persistPolicy();
          json(res, { ok: true, candidates: candidateList() });
        } catch (error) {
          json(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
        }
        return;
      }
      loadPolicyFile();
      json(res, { ok: true, candidates: candidateList() });
    }});
    webServer.register({ kind: 'exact', path: '/plugins/arena/snapshot', handler: async (_req: unknown, res: Parameters<typeof json>[0]) => {
      // store.report() throws before any experiment exists; the panel still
      // needs a valid empty report to render its empty state.
      const snapshot = store.getSnapshot();
      json(res, createReport(snapshot.experiment, snapshot.runs));
    }});
    webServer.register({ kind: 'exact', path: '/plugins/arena/runs', handler: async (req: { on?: (event: string, cb: (chunk: Buffer) => void) => void }, res: Parameters<typeof json>[0]) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      const cap = 1024 * 1024;
      const fail = (message: string, status = 400): void => json(res, { ok: false, error: message }, status);
      try {
        await new Promise<void>((resolve, reject) => {
          req.on?.('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > cap) { reject(new Error('payload too large')); return; }
            chunks.push(chunk);
          });
          req.on?.('end', resolve);
          req.on?.('error', reject);
        });
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { experiment?: ExperimentInput; run?: ArenaRun };
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
          persistPolicy();
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
