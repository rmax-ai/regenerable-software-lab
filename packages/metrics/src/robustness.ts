// @rsl/metrics — Robustness metric computation

import type { VerificationResult } from "@rsl/benchmark-core";

export interface RobustnessMetrics {
  /** Absolute difference between hidden-test and public-test pass rates (0–1). */
  hiddenPublicGap: number;
  /** Fraction of mutants that survived (1 - mutationScore, 0–1). */
  mutationSurvivalRate: number;
  /**
   * Variance of results across seeds.  Requires multiple runs with
   * different seeds.  Returns 0 when only a single run is available.
   */
  seedVariance: number;
}

// ── Helpers ────────────────────────────────────────────────────────────

const PUBLIC_RE = /^(public|visible)/i;
const HIDDEN_RE = /^hidden/i;
const MUTATION_RE = /mutation/i;

function passRate(results: VerificationResult[]): number {
  if (results.length === 0) return 1;
  const passed = results.filter((r) => r.status === "passed").length;
  return passed / results.length;
}

// ── Computation ────────────────────────────────────────────────────────

/**
 * Compute robustness metrics from a list of verification results.
 *
 * @param verification — verification results for a single run
 * @param allResults — optional, results from multiple runs for seed variance
 */
export function computeRobustnessMetrics(
  verification: VerificationResult[],
  allResults?: VerificationResult[][],
): RobustnessMetrics {
  const publicTests = verification.filter((r) => PUBLIC_RE.test(r.stage));
  const hiddenTests = verification.filter((r) => HIDDEN_RE.test(r.stage));

  const publicRate = passRate(publicTests);
  const hiddenRate = passRate(hiddenTests);
  const hiddenPublicGap = Math.abs(hiddenRate - publicRate);

  // Mutation survival = 1 - mutationScore
  const mutationStage = verification.find((r) => MUTATION_RE.test(r.stage));
  let mutationScore = 0;
  if (mutationStage) {
    const raw =
      mutationStage.metrics["mutationScore"] ??
      mutationStage.metrics["score"];
    if (typeof raw === "number") mutationScore = raw;
  }
  const mutationSurvivalRate = 1 - mutationScore;

  // Seed variance: compute per-run public test pass rates across multiple
  // runs, then take the sample variance.
  let seedVariance = 0;
  if (allResults && allResults.length > 1) {
    const rates: number[] = [];
    for (const results of allResults) {
      const pub = results.filter((r) => PUBLIC_RE.test(r.stage));
      rates.push(passRate(pub));
    }
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    seedVariance =
      rates.reduce((sum, r) => sum + (r - mean) ** 2, 0) / rates.length;
  }

  return {
    hiddenPublicGap,
    mutationSurvivalRate,
    seedVariance,
  };
}
