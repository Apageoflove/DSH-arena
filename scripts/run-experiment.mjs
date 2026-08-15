#!/usr/bin/env node
/**
 * DSH Arena experiment runner (CLI executor adapter).
 *
 * Runs ONE task across N candidate (provider:model) profiles through the
 * official headless app, records every run into a running dsh web host via
 * POST /plugins/arena/runs (so the Arena panel shows the matrix live), and
 * writes a local report JSON for offline import.
 *
 * Usage:
 *   node scripts/run-experiment.mjs \
 *     --task "Answer with exactly: OK" \
 *     --candidates "deepseek:deepseek-chat,zai-coding-cn:GLM-5.3,wawazz:claude-sonnet-5" \
 *     --cwd "E:/agent/DSH" \
 *     --base-url "http://127.0.0.1:3080"
 *
 * The per-candidate model override uses `dsh --profile headless --patch`,
 * targeting the composed `agent-default-model` entry; the headless profile
 * mounts no settings provider, so the patch config is authoritative.
 */

import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createExperiment, createRunId, stableId } from '../lib/core/experiment.js'
import { createReport } from '../lib/core/report.js'

const MAX_OUTPUT_BYTES = 64 * 1024

function parseArgs(argv) {
  const args = { task: undefined, candidates: undefined, cwd: process.cwd(), baseUrl: 'http://127.0.0.1:3080', timeoutMs: 300_000, out: 'arena-report.json', dsh: 'pnpm dsh', dshCommit: 'source' }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = () => argv[++i]
    if (flag === '--task') args.task = value()
    else if (flag === '--candidates') args.candidates = value()
    else if (flag === '--cwd') args.cwd = resolve(value())
    else if (flag === '--base-url') args.baseUrl = value().replace(/\/+$/, '')
    else if (flag === '--timeout-ms') args.timeoutMs = Number(value())
    else if (flag === '--out') args.out = value()
    else if (flag === '--dsh') args.dsh = value()
    else if (flag === '--dsh-commit') args.dshCommit = value()
    else { console.error(`unknown argument: ${flag}`); process.exit(2) }
  }
  if (!args.task) {
    console.error('usage: run-experiment.mjs --task <text> [--candidates provider:model,...] [--cwd dir] [--base-url url] [--timeout-ms n] [--out file]')
    console.error('without --candidates, the models enabled in the Arena panel (竞赛模型) are used')
    process.exit(2)
  }
  if (args.candidates) {
    args.candidates = args.candidates.split(',').map((spec) => {
      const [provider, model] = spec.split(':')
      if (!provider || !model) throw new Error(`bad candidate spec "${spec}" (want provider:model)`)
      return { provider, model }
    })
  }
  return args
}

/** Run one headless dsh job with a per-candidate default-model patch. */
function runCandidate(args, candidate, task) {
  const patch = `- id: agent-default-model\n  config:\n    provider: ${candidate.provider}\n    model: ${candidate.model}\n`
  const dir = mkdtempSync(join(tmpdir(), 'dsh-arena-patch-'))
  const patchFile = join(dir, 'model.patch.yml')
  writeFileSync(patchFile, patch, 'utf8')
  const [command, ...rest] = args.dsh.split(/\s+/)
  const quotedTask = JSON.stringify(task.replaceAll('"', "'"))
  const line = `${command} ${rest.join(' ')} --profile headless --patch ${JSON.stringify(patchFile)} ${quotedTask}`
  return new Promise((resolvePromise) => {
    const started = Date.now()
    const child = spawn(line, { cwd: args.cwd, shell: true, windowsHide: true })
    let output = ''
    let bytes = 0
    let truncated = false
    let timedOut = false
    const collect = (chunk) => {
      if (truncated) return
      const remaining = MAX_OUTPUT_BYTES - bytes
      if (remaining <= 0) { truncated = true; return }
      const kept = chunk.subarray(0, remaining)
      bytes += kept.length
      output += kept.toString('utf8')
      if (kept.length < chunk.length) truncated = true
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => { timedOut = true; child.kill() }, args.timeoutMs)
    child.once('error', (error) => { clearTimeout(timer); rmSync(dir, { recursive: true, force: true }); resolvePromise({ exitCode: null, output: String(error), durationMs: Date.now() - started, timedOut }) })
    child.once('close', (exitCode) => {
      clearTimeout(timer)
      rmSync(dir, { recursive: true, force: true })
      resolvePromise({ exitCode, output, durationMs: Date.now() - started, timedOut })
    })
  })
}

/** POST one JSON body to the host arena bridge. */
async function post(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const parsed = await response.json().catch(() => null)
  if (!response.ok || parsed?.ok === false) {
    throw new Error(`host answered ${response.status}: ${parsed?.error ?? 'unknown error'}`)
  }
  return parsed
}

const args = parseArgs(process.argv.slice(2))

// No explicit candidate list: use whatever the panel has enabled.
if (!args.candidates) {
  try {
    const list = await (await fetch(`${args.baseUrl}/plugins/arena/candidates`)).json()
    args.candidates = (list?.candidates ?? [])
      .filter((candidate) => candidate.enabled)
      .map((candidate) => ({ provider: candidate.provider, model: candidate.model }))
    if (!args.candidates.length) {
      console.error('no enabled candidates: every competition model is disabled in the Arena panel (竞赛模型).')
      console.error('Enable at least one model there, then retry.')
      process.exit(1)
    }
  } catch (error) {
    console.error(`cannot read the candidate list from ${args.baseUrl}: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

// Kill switch: the panel's execution switch must be ON, or we spend nothing.
try {
  const policy = await (await fetch(`${args.baseUrl}/plugins/arena/policy`)).json()
  if (policy?.executionPolicy === 'blocked') {
    console.error(`refusing to run: the Arena panel execution switch is OFF (${args.baseUrl}).`)
    console.error('Flip it ON in the panel (执行：开), then retry.')
    process.exit(1)
  }
} catch (error) {
  console.warn(`host policy unreachable (${error instanceof Error ? error.message : String(error)}) — proceeding without the switch check`)
}

// Per-model kill switch: only candidates enabled in the panel compete.
// A model absent from the policy counts as enabled (first use registers it).
let enabledKeys = new Set()
try {
  const list = await (await fetch(`${args.baseUrl}/plugins/arena/candidates`)).json()
  for (const candidate of list?.candidates ?? []) {
    if (candidate.enabled) enabledKeys.add(`${candidate.provider}:${candidate.model}`)
  }
} catch (error) {
  console.warn(`candidate policy unreachable (${error instanceof Error ? error.message : String(error)}) — running all requested candidates`)
  enabledKeys = new Set(args.candidates.map((candidate) => `${candidate.provider}:${candidate.model}`))
}
const selected = args.candidates.filter((candidate) => enabledKeys.has(`${candidate.provider}:${candidate.model}`))
const skipped = args.candidates.filter((candidate) => !enabledKeys.has(`${candidate.provider}:${candidate.model}`))
if (skipped.length) {
  console.log(`skipped (disabled in the panel): ${skipped.map((candidate) => `${candidate.provider}:${candidate.model}`).join(', ')}`)
}
if (!selected.length) {
  console.error('no enabled candidates: every requested model is disabled in the Arena panel (竞赛模型).')
  console.error('Enable at least one model there, then retry.')
  process.exit(1)
}
args.candidates = selected

const dshCommit = args.dshCommit
const repoSnapshot = args.cwd
const experiment = createExperiment({ task: args.task, repoSnapshot, dshCommit, candidates: args.candidates })
console.log(`experiment ${experiment.experimentId}: ${args.candidates.length} candidates, task="${args.task.slice(0, 80)}${args.task.length > 80 ? '…' : ''}"`)

const runs = []
for (const [index, candidate] of args.candidates.entries()) {
  const runId = createRunId(experiment.experimentId, candidate, index)
  const startedAt = new Date().toISOString()
  process.stdout.write(`  [${index + 1}/${args.candidates.length}] ${candidate.provider}:${candidate.model} … `)
  const { exitCode, output, durationMs, timedOut } = await runCandidate(args, candidate, args.task)
  const passed = exitCode === 0
  const endedAt = new Date().toISOString()
  const run = {
    runId,
    experimentId: experiment.experimentId,
    candidate,
    state: passed ? 'passed' : 'failed',
    startedAt,
    endedAt,
    metrics: { quality: passed ? 1 : 0, durationMs },
    gates: [{ name: 'exit-code', status: passed ? 'VERIFIED' : 'FAILED', message: `headless exit ${String(exitCode)}` }],
    gateStatus: passed ? 'VERIFIED' : 'FAILED',
    output: output.slice(-2000),
    auditAlerts: timedOut ? ['timed out'] : [],
  }
  runs.push(run)
  console.log(`${passed ? 'PASS' : 'FAIL'} (${(durationMs / 1000).toFixed(1)}s)`)
}

try {
  await post(args.baseUrl, '/plugins/arena/runs', { experiment: { task: args.task, repoSnapshot, dshCommit, candidates: args.candidates } })
  for (const run of runs) await post(args.baseUrl, '/plugins/arena/runs', { run })
  console.log('recorded into host:', args.baseUrl)
} catch (error) {
  console.warn(`host unreachable (${error instanceof Error ? error.message : String(error)}) — report still written locally`)
}

const report = createReport(experiment, runs)
writeFileSync(args.out, JSON.stringify(report, null, 2), 'utf8')
console.log(`report written: ${args.out}`)
console.log(`summary: ${runs.filter((run) => run.state === 'passed').length}/${runs.length} passed`)
