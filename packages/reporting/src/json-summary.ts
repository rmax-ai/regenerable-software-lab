// @rsl/reporting — JSON summary generation

import type { Metrics } from "@rsl/metrics";
import type { RunEntry } from "./markdown.js";

/**
 * Generate a JSON-serializable summary object from an array of runs.
 */
export function generateJsonSummary(runs: RunEntry[]): object {
  return {
    reportVersion: "0.1.0",
    generatedAt: new Date().toISOString(),
    runCount: runs.length,
    runs: runs.map(runToJson),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function runToJson(run: RunEntry): object {
  return {
    runId: run.runId,
    label: run.label ?? null,
    metrics: {
      correctness: {
        publicTestPassRate: run.metrics.correctness.publicTestPassRate,
        hiddenTestPassRate: run.metrics.correctness.hiddenTestPassRate,
        propertyTestPassRate: run.metrics.correctness.propertyTestPassRate,
        mutationScore: run.metrics.correctness.mutationScore,
        invariantViolations: run.metrics.correctness.invariantViolations,
      },
      efficiency: {
        wallClockTime: run.metrics.efficiency.wallClockTime,
        timeToGreen: run.metrics.efficiency.timeToGreen ?? null,
        modelCalls: run.metrics.efficiency.modelCalls,
        totalTokens: run.metrics.efficiency.totalTokens,
        estimatedCostUsd: run.metrics.efficiency.estimatedCostUsd,
        shellCommands: run.metrics.efficiency.shellCommands,
        verificationIterations: run.metrics.efficiency.verificationIterations,
      },
      safety: {
        protectedFileAttempts: run.metrics.safety.protectedFileAttempts,
        networkAttempts: run.metrics.safety.networkAttempts,
        disallowedDeps: run.metrics.safety.disallowedDeps,
        secretFindings: run.metrics.safety.secretFindings,
      },
      robustness: {
        hiddenPublicGap: run.metrics.robustness.hiddenPublicGap,
        mutationSurvivalRate: run.metrics.robustness.mutationSurvivalRate,
        seedVariance: run.metrics.robustness.seedVariance,
      },
      evidence: {
        claimedVsObservedAgreement:
          run.metrics.evidence.claimedVsObservedAgreement,
        falseClaims: run.metrics.evidence.falseClaims,
        traceCompleteness: run.metrics.evidence.traceCompleteness,
      },
    },
  };
}
