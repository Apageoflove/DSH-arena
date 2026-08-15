/** Shared, dependency-free data contracts for the DSH Arena core. */

export type VerificationStatus = 'VERIFIED' | 'PARTIAL' | 'FAILED' | 'STALE' | 'UNVERIFIED' | 'NOT_APPLICABLE';
export type RunState = 'queued' | 'running' | 'passed' | 'failed' | 'blocked';
export type MetricName = 'quality' | 'success' | 'durationMs' | 'tokens' | 'cost' | 'errors';

/** Describes one reproducible DSH candidate without storing provider credentials. */
export interface CandidateProfile {
  model?: string;
  provider?: string;
  reasoning?: string;
  prompt?: string;
  agentPreset?: string;
  plugins?: string[];
  tools?: string[];
  budgets?: Record<string, number>;
}

/** Defines the invariant task and repository snapshot for one experiment. */
export interface ExperimentInput {
  task: string;
  repoSnapshot: string;
  dshCommit: string;
  candidates: CandidateProfile[];
}

/** A normalized arena experiment. */
export interface Experiment extends ExperimentInput {
  experimentId: string;
  createdAt: string;
}

/** Hard gate policy. Undefined fields do not impose a gate. */
export interface GatePolicy {
  expectedExitCode?: number;
  requiredFiles?: string[];
  forbiddenPaths?: string[];
  testCommand?: string;
  safetyViolation?: boolean;
}

/** Concrete evidence collected for a hard gate evaluation. */
export interface GateEvidence {
  exitCode?: number | null;
  files?: string[];
  changedPaths?: string[];
  test?: { command: string; exitCode: number | null; timedOut?: boolean };
  safetyViolation?: boolean;
}

/** Individual audit result produced by the deterministic hard-gate engine. */
export interface GateResult {
  name: string;
  status: VerificationStatus;
  message: string;
}

/** Measurements used for Pareto comparison; no LLM verdict is represented here. */
export interface RunMetrics {
  quality?: number;
  success?: number;
  durationMs?: number;
  tokens?: number;
  cost?: number;
  errors?: number;
}

/** Result of a candidate execution plus deterministic audit metadata. */
export interface ArenaRun {
  runId: string;
  experimentId: string;
  candidate: CandidateProfile;
  state: RunState;
  startedAt?: string;
  endedAt?: string;
  metrics: RunMetrics;
  gates: GateResult[];
  gateStatus: VerificationStatus;
  output?: string;
  auditAlerts?: string[];
}

/** Specifies whether each metric should be maximized or minimized. */
export type MetricDirections = Partial<Record<MetricName, 'max' | 'min'>>;
