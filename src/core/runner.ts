/** Injectable command execution with timeout and bounded output capture. */

import { spawn } from 'node:child_process';

/** A command intentionally supplied by the caller; Arena never synthesizes DSH stream commands. */
export interface CommandSpec { command: string; args?: string[]; cwd?: string; timeoutMs?: number; maxOutputBytes?: number; }
export interface CommandResult { exitCode: number | null; timedOut: boolean; output: string; truncated: boolean; }
export type CommandRunner = (spec: CommandSpec) => Promise<CommandResult>;
export type RunExecutor<T> = (input: T, runner: CommandRunner) => Promise<CommandResult>;

/** Executes a declared command without a shell, preserving exact argument boundaries. */
export const executeCommand: CommandRunner = async (spec) => new Promise((resolve, reject) => {
  if (!spec.command.trim()) return reject(new Error('command must not be empty.'));
  const limit = spec.maxOutputBytes ?? 64 * 1024;
  const child = spawn(spec.command, spec.args ?? [], { cwd: spec.cwd, shell: false, windowsHide: true });
  let output = ''; let bytes = 0; let truncated = false; let timedOut = false;
  const collect = (chunk: Buffer) => {
    if (truncated) return;
    const remaining = limit - bytes;
    if (remaining <= 0) { truncated = true; return; }
    const kept = chunk.subarray(0, remaining);
    bytes += kept.length; output += kept.toString('utf8');
    if (kept.length < chunk.length) truncated = true;
  };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  const timer = spec.timeoutMs ? setTimeout(() => { timedOut = true; child.kill(); }, spec.timeoutMs) : undefined;
  child.once('error', (error) => { if (timer) clearTimeout(timer); reject(error); });
  child.once('close', (exitCode) => { if (timer) clearTimeout(timer); resolve({ exitCode, timedOut, output, truncated }); });
});
