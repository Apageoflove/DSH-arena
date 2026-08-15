/** Dependency-free test adapter mirroring the public service published by the official TS entrypoint. */

export const name = 'arena';

/** Attaches an Arena service to a duck-typed Cordis context for tests and safe host probing. */
export function apply(ctx, config = {}) {
  if (config.enabled === false) return;
  ctx.arena = { version: '0.1.0', runsRoot: config.runsRoot ?? '.dsh-arena/runs', getSnapshot: () => ({ experiment: null, runs: [] }) };
}
