/** Safe, auditable Arena report serialization in JSON, JSONL, and Markdown. */

import { redactValue } from './redact.js';
import { paretoFront, recommendWinner } from './pareto.js';
                                                                         

/** Represents one complete export without writing to disk on the caller's behalf. */
                                                                                                                                               

/** Builds a redacted report and identifies the deterministic Pareto frontier. */
export function createReport(experiment            , runs            , directions                   = {})              {
  const redactedRuns = redactValue(runs)              ;
  const frontier = paretoFront(redactedRuns, directions);
  return { experiment: redactValue(experiment)              , runs: redactedRuns, paretoRunIds: frontier.map((run) => run.runId), winnerRunId: recommendWinner(frontier)?.runId, auditAlerts: redactedRuns.flatMap((run) => run.auditAlerts ?? []) };
}

/** Serializes the full redacted report as readable JSON. */
export function exportJson(report             )         { return `${JSON.stringify(report, null, 2)}\n`; }

/** Serializes one redacted run per line for append-friendly ingestion. */
export function exportJsonl(report             )         {
  return report.runs.map((run) => JSON.stringify({ experimentId: report.experiment.experimentId, dshCommit: report.experiment.dshCommit, ...run })).join('\n') + (report.runs.length ? '\n' : '');
}

/** Produces a concise human audit that never presents unverified evidence as a winner. */
export function exportMarkdown(report             )         {
  const lines = [`# DSH Arena report`, '', `- Experiment: \`${report.experiment.experimentId}\``, `- DSH commit: \`${report.experiment.dshCommit}\``, `- Runs: ${report.runs.length}`, `- Pareto frontier: ${report.paretoRunIds.length ? report.paretoRunIds.map((id) => `\`${id}\``).join(', ') : 'none (only VERIFIED, passed runs are eligible)'}`, `- Suggested winner: ${report.winnerRunId ? `\`${report.winnerRunId}\` (deterministic tie-breaker; requires human confirmation)` : 'none'}`, '', '## Runs', '', '| Run | State | Gates | Quality | Success | Duration | Tokens | Cost | Errors |', '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const run of report.runs) lines.push(`| \`${run.runId}\` | ${run.state} | ${run.gateStatus} | ${metric(run.metrics.quality)} | ${metric(run.metrics.success)} | ${metric(run.metrics.durationMs)} | ${metric(run.metrics.tokens)} | ${metric(run.metrics.cost)} | ${metric(run.metrics.errors)} |`);
  lines.push('', '## Gate audit', '');
  for (const run of report.runs) for (const gate of run.gates) lines.push(`- \`${run.runId}\` / **${gate.status}** / ${gate.name}: ${gate.message}`);
  lines.push('', '## Audit alerts', '');
  lines.push(...(report.auditAlerts.length ? report.auditAlerts.map((alert) => `- ${alert}`) : ['- None recorded.']));
  return `${lines.join('\n')}\n`;
}

/** Formats an absent measurement explicitly rather than using an invented zero. */
function metric(value                    )         { return value === undefined ? '—' : String(value); }


//# sourceURL=E:\agent\DSH_UI\dsh-arena\src\core\report.ts