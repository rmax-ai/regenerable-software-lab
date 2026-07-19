// @rsl/reporting — CSV result generation

import type { RunEntry } from "./markdown.js";

/**
 * Generate a CSV string with one header row and one data row per run.
 *
 * Columns cover correctness, efficiency, safety, robustness, and evidence
 * metrics in a flat structure, plus model/harness/profile metadata if available.
 */
export function generateCsvResults(runs: RunEntry[]): string {
  // ── Header ──────────────────────────────────────────────────────────
  const headers = [
    "runId",
    "label",
    "modelProvider",
    "modelName",
    "harness",
    "profile",
    "publicTestPassRate",
    "hiddenTestPassRate",
    "propertyTestPassRate",
    "mutationScore",
    "invariantViolations",
    "wallClockTime",
    "timeToGreen",
    "modelCalls",
    "totalTokens",
    "estimatedCostUsd",
    "shellCommands",
    "verificationIterations",
    "protectedFileAttempts",
    "networkAttempts",
    "disallowedDeps",
    "secretFindings",
    "hiddenPublicGap",
    "mutationSurvivalRate",
    "seedVariance",
    "claimedVsObservedAgreement",
    "falseClaims",
    "traceCompleteness",
  ];

  const rows: string[] = [headers.map(csvQuote).join(",")];

  for (const run of runs) {
    const m = run.metrics;
    const row = [
      run.runId,
      run.label ?? "",
      run.modelProvider ?? "",
      run.modelName ?? "",
      run.harness ?? "",
      run.profile ?? "",
      m.correctness.publicTestPassRate,
      m.correctness.hiddenTestPassRate,
      m.correctness.propertyTestPassRate,
      m.correctness.mutationScore,
      m.correctness.invariantViolations,
      m.efficiency.wallClockTime,
      m.efficiency.timeToGreen ?? "",
      m.efficiency.modelCalls,
      m.efficiency.totalTokens,
      m.efficiency.estimatedCostUsd,
      m.efficiency.shellCommands,
      m.efficiency.verificationIterations,
      m.safety.protectedFileAttempts,
      m.safety.networkAttempts,
      m.safety.disallowedDeps,
      m.safety.secretFindings,
      m.robustness.hiddenPublicGap,
      m.robustness.mutationSurvivalRate,
      m.robustness.seedVariance,
      m.evidence.claimedVsObservedAgreement,
      m.evidence.falseClaims,
      m.evidence.traceCompleteness,
    ];
    rows.push(row.map(csvQuote).join(","));
  }

  return rows.join("\n") + "\n";
}

// ── CSV quoting helper ─────────────────────────────────────────────────

function csvQuote(value: unknown): string {
  const str = String(value);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
