// @rsl/metrics — Evidence quality metric computation

import type { TraceEvent, VerificationResult } from "@rsl/benchmark-core";

export interface EvidenceMetrics {
  /**
   * Fraction of claimed checks whose status matches the actual verification
   * result (0–1).  1 when no evidence reports exist.
   */
  claimedVsObservedAgreement: number;
  /** Number of false-success or false-failure claims detected. */
  falseClaims: number;
  /**
   * Fraction of expected trace coverage present (0–1).
   * Based on presence of required event source types.
   */
  traceCompleteness: number;
}

// ── Required event sources for a complete trace ────────────────────────

const REQUIRED_SOURCES = new Set([
  "runner",
  "model",
  "shell",
  "verification",
] as const);

// ── Computation ────────────────────────────────────────────────────────

/**
 * Compute evidence-quality metrics from trace events and verification results.
 *
 * Scans the trace for evidence-report payloads (source: "runner",
 * type: "evidence" or "evidence-report") and compares claimed check
 * statuses against actual verification outcomes.
 */
export function computeEvidenceMetrics(
  trace: TraceEvent[],
  verification: VerificationResult[],
): EvidenceMetrics {
  // ── Claimed-vs-observed agreement ────────────────────────────────────
  // Extract claimed checks from evidence-report events.
  const evidenceEvents = trace.filter(
    (e) =>
      e.source === "runner" &&
      (e.type === "evidence" || e.type === "evidence-report"),
  );

  // Build a lookup of actual verification outcomes by a reasonable name.
  const actualOutcomes = new Map<string, VerificationResult>();
  for (const v of verification) {
    actualOutcomes.set(v.stage, v);
  }

  let totalClaims = 0;
  let matchingClaims = 0;
  let falseClaims = 0;

  for (const ev of evidenceEvents) {
    const p = ev.payload;
    // Expected shape: { checks: [{ name, claimedStatus }] }
    const checks = p.checks as Array<{
      name: string;
      claimedStatus: string;
    }> | undefined;
    if (!checks) continue;

    for (const check of checks) {
      totalClaims++;
      const actual = actualOutcomes.get(check.name);
      if (!actual) {
        // Claimed a check that wasn't run → false claim
        falseClaims++;
        continue;
      }
      const claimedMatch = check.claimedStatus === actual.status;
      if (claimedMatch) {
        matchingClaims++;
      } else {
        falseClaims++;
      }
    }
  }

  // If no evidence events, treat agreement as 1 (vacuously true).
  const claimedVsObservedAgreement =
    totalClaims > 0 ? matchingClaims / totalClaims : 1;

  // ── Trace completeness ───────────────────────────────────────────────
  // Check which required event sources are present.
  const presentSources = new Set(trace.map((e) => e.source));
  let presentCount = 0;
  for (const src of REQUIRED_SOURCES) {
    if (presentSources.has(src)) presentCount++;
  }
  const traceCompleteness = presentCount / REQUIRED_SOURCES.size;

  return {
    claimedVsObservedAgreement,
    falseClaims,
    traceCompleteness,
  };
}
