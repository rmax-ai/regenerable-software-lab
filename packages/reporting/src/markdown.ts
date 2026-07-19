// @rsl/reporting — Markdown report generation

import type { Metrics } from "@rsl/metrics";

export interface RunEntry {
  runId: string;
  label?: string;
  metrics: Metrics;
}

/**
 * Generate a Markdown report containing a summary table and per-run detail
 * sections.
 */
export function generateMarkdownReport(runs: RunEntry[]): string {
  const lines: string[] = [];

  lines.push("# Regenerable Software Lab — Benchmark Report", "");

  if (runs.length === 0) {
    lines.push("_No runs recorded._", "");
    return lines.join("\n");
  }

  // ── Summary table ──────────────────────────────────────────────────
  lines.push("## Summary");
  lines.push("");
  lines.push(
    [
      "| Run",
      "Public%",
      "Hidden%",
      "Mutation",
      "Gap",
      "Time(s)",
      "Calls",
      "Cost($)",
      "Safe",
      "Agree%",
      "Compl%",
      "|",
    ].join(" "),
  );
  lines.push(
    [
      "| ---",
      "----:",
      "----:",
      "------:",
      "--:",
      "----:",
      "---:",
      "----:",
      "---:",
      "----:",
      "----:",
      "|",
    ].join(" "),
  );

  for (const run of runs) {
    const label = run.label ?? run.runId.slice(0, 8);
    const m = run.metrics;
    lines.push(
      [
        `| ${label}`,
        fmtPct(m.correctness.publicTestPassRate),
        fmtPct(m.correctness.hiddenTestPassRate),
        fmtPct(m.correctness.mutationScore),
        fmtPct(m.robustness.hiddenPublicGap),
        fmtNum(m.efficiency.wallClockTime),
        String(m.efficiency.modelCalls),
        fmtNum(m.efficiency.estimatedCostUsd),
        safetyIcon(m.safety),
        fmtPct(m.evidence.claimedVsObservedAgreement),
        fmtPct(m.evidence.traceCompleteness),
        "|",
      ].join(" "),
    );
  }
  lines.push("");

  // ── Per-run detail sections ─────────────────────────────────────────
  for (const run of runs) {
    const label = run.label ?? run.runId;
    lines.push(`---`, "");
    lines.push(`## Run: ${label}`, "");
    lines.push(`**Run ID:** \`${run.runId}\``, "");
    lines.push("", "### Correctness", "");
    const c = run.metrics.correctness;
    lines.push(`- Public-test pass rate: ${fmtPct(c.publicTestPassRate)}`);
    lines.push(`- Hidden-test pass rate: ${fmtPct(c.hiddenTestPassRate)}`);
    lines.push(`- Property-test pass rate: ${fmtPct(c.propertyTestPassRate)}`);
    lines.push(`- Mutation score: ${fmtPct(c.mutationScore)}`);
    lines.push(`- Invariant violations: ${c.invariantViolations}`);
    lines.push("");

    lines.push("### Efficiency", "");
    const e = run.metrics.efficiency;
    lines.push(`- Wall-clock time: ${fmtNum(e.wallClockTime)} s`);
    if (e.timeToGreen !== undefined) {
      lines.push(`- Time to green: ${fmtNum(e.timeToGreen)} s`);
    }
    lines.push(`- Model calls: ${e.modelCalls}`);
    lines.push(`- Total tokens: ${e.totalTokens.toLocaleString()}`);
    lines.push(`- Estimated cost: \$${fmtNum(e.estimatedCostUsd)}`);
    lines.push(`- Shell commands: ${e.shellCommands}`);
    lines.push(`- Verification iterations: ${e.verificationIterations}`);
    lines.push("");

    lines.push("### Safety", "");
    const s = run.metrics.safety;
    lines.push(`- Protected-file attempts: ${s.protectedFileAttempts}`);
    lines.push(`- Network attempts: ${s.networkAttempts}`);
    lines.push(`- Disallowed dependencies: ${s.disallowedDeps}`);
    lines.push(`- Secret findings: ${s.secretFindings}`);
    lines.push("");

    lines.push("### Robustness", "");
    const r = run.metrics.robustness;
    lines.push(`- Hidden/public gap: ${fmtPct(r.hiddenPublicGap)}`);
    lines.push(`- Mutation survival rate: ${fmtPct(r.mutationSurvivalRate)}`);
    lines.push(`- Seed variance: ${r.seedVariance.toFixed(4)}`);
    lines.push("");

    lines.push("### Evidence", "");
    const ev = run.metrics.evidence;
    lines.push(
      `- Claimed-vs-observed agreement: ${fmtPct(ev.claimedVsObservedAgreement)}`,
    );
    lines.push(`- False claims: ${ev.falseClaims}`);
    lines.push(`- Trace completeness: ${fmtPct(ev.traceCompleteness)}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ── Format helpers ─────────────────────────────────────────────────────

function fmtPct(value: number): string {
  return (value * 100).toFixed(1) + "%";
}

function fmtNum(value: number): string {
  return value.toFixed(2);
}

function safetyIcon(s: {
  protectedFileAttempts: number;
  networkAttempts: number;
  disallowedDeps: number;
  secretFindings: number;
}): string {
  const total =
    s.protectedFileAttempts +
    s.networkAttempts +
    s.disallowedDeps +
    s.secretFindings;
  return total === 0 ? ":white_check_mark:" : ":warning:";
}
