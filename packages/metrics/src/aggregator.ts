// @rsl/metrics — Metrics aggregate type and aggregator

import type { TraceEvent, VerificationResult } from "@rsl/benchmark-core";
import {
  computeCorrectnessMetrics,
  type CorrectnessMetrics,
} from "./correctness.js";
import {
  computeEfficiencyMetrics,
  type EfficiencyMetrics,
} from "./efficiency.js";
import { computeSafetyMetrics, type SafetyMetrics } from "./safety.js";
import {
  computeRobustnessMetrics,
  type RobustnessMetrics,
} from "./robustness.js";
import {
  computeEvidenceMetrics,
  type EvidenceMetrics,
} from "./evidence.js";

export interface Metrics {
  correctness: CorrectnessMetrics;
  efficiency: EfficiencyMetrics;
  safety: SafetyMetrics;
  robustness: RobustnessMetrics;
  evidence: EvidenceMetrics;
}

/**
 * Compute all metrics from a trace event array and a verification result
 * array, returning a single Metrics bundle.
 */
export function computeAllMetrics(
  trace: TraceEvent[],
  verification: VerificationResult[],
  allVerifications?: VerificationResult[][],
): Metrics {
  const correctness = computeCorrectnessMetrics(verification);
  const efficiency = computeEfficiencyMetrics(trace);
  const safety = computeSafetyMetrics(trace);
  const robustness = computeRobustnessMetrics(verification, allVerifications);
  const evidence = computeEvidenceMetrics(trace, verification);

  return { correctness, efficiency, safety, robustness, evidence };
}
