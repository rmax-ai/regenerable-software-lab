// @rsl/metrics — Correctness metric computation

import type { VerificationResult } from "@rsl/benchmark-core";

export interface CorrectnessMetrics {
  /** Fraction of public / visible tests that passed (0–1). */
  publicTestPassRate: number;
  /** Fraction of hidden tests that passed (0–1). */
  hiddenTestPassRate: number;
  /** Fraction of property / invariant tests that passed (0–1). */
  propertyTestPassRate: number;
  /** Mutation score from the mutation test stage (0–1), or 0 if absent. */
  mutationScore: number;
  /** Number of explicit contract / property / invariant violations. */
  invariantViolations: number;
}

// ── Stage-name heuristics ──────────────────────────────────────────────

const PUBLIC_RE = /^(public|visible)/i;
const HIDDEN_RE = /^hidden/i;
const PROPERTY_RE = /^(property|invariant|contract)/i;
const MUTATION_RE = /mutation/i;
const VIOLATION_CATEGORIES = new Set([
  "PROPERTY_VIOLATION",
  "CONTRACT_VIOLATION",
]);

// ── Computation ────────────────────────────────────────────────────────

function passRate(results: VerificationResult[]): number {
  if (results.length === 0) return 1; // no tests → vacuously passing
  const passed = results.filter((r) => r.status === "passed").length;
  return passed / results.length;
}

/**
 * Compute correctness metrics from an array of verification results.
 * Stages are classified by name heuristics documented above.
 */
export function computeCorrectnessMetrics(
  verification: VerificationResult[],
): CorrectnessMetrics {
  const publicTests = verification.filter((r) => PUBLIC_RE.test(r.stage));
  const hiddenTests = verification.filter((r) => HIDDEN_RE.test(r.stage));
  const propertyTests = verification.filter((r) => PROPERTY_RE.test(r.stage));

  // Mutation score: look for a numeric metric named "mutationScore" or
  // "score" inside the first mutation-stage result.
  const mutationStage = verification.find((r) => MUTATION_RE.test(r.stage));
  let mutationScore = 0;
  if (mutationStage) {
    const raw =
      mutationStage.metrics["mutationScore"] ??
      mutationStage.metrics["score"];
    if (typeof raw === "number") mutationScore = raw;
  }

  const invariantViolations = verification.filter(
    (r) =>
      r.failureCategory != null && VIOLATION_CATEGORIES.has(r.failureCategory),
  ).length;

  return {
    publicTestPassRate: passRate(publicTests),
    hiddenTestPassRate: passRate(hiddenTests),
    propertyTestPassRate: passRate(propertyTests),
    mutationScore,
    invariantViolations,
  };
}
