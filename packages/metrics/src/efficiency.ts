// @rsl/metrics — Efficiency metric computation

import type { TraceEvent } from "@rsl/benchmark-core";

export interface EfficiencyMetrics {
  /** Total wall-clock time in seconds across all trace events. */
  wallClockTime: number;
  /** Wall-clock time (s) until the first "passed" verification, or undefined. */
  timeToGreen?: number;
  /** Number of model-call events in the trace. */
  modelCalls: number;
  /** Sum of input + output tokens reported in model-use payloads. */
  totalTokens: number;
  /** Estimated total cost in USD from model-call payloads. */
  estimatedCostUsd: number;
  /** Number of shell-command events in the trace. */
  shellCommands: number;
  /** Number of verification-attempt events in the trace. */
  verificationIterations: number;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Parse an ISO-8601 timestamp string → epoch ms. */
function parseTime(ts: string): number {
  return new Date(ts).getTime();
}

// ── Computation ────────────────────────────────────────────────────────

/**
 * Compute efficiency metrics from an ordered array of trace events.
 * Assumes events are in chronological order.
 */
export function computeEfficiencyMetrics(
  trace: TraceEvent[],
): EfficiencyMetrics {
  if (trace.length === 0) {
    return {
      wallClockTime: 0,
      modelCalls: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      shellCommands: 0,
      verificationIterations: 0,
    };
  }

  // Wall-clock time: first event → last event
  const first = parseTime(trace[0]!.timestamp);
  const last = parseTime(trace[trace.length - 1]!.timestamp);
  const wallClockTime = Math.max(0, (last - first) / 1000);

  // Model-call events
  const modelEvents = trace.filter((e) => e.source === "model");
  const modelCalls = modelEvents.length;

  // Token & cost aggregation from model event payloads
  let totalTokens = 0;
  let estimatedCostUsd = 0;
  for (const ev of modelEvents) {
    const p = ev.payload;
    if (typeof p.inputTokens === "number") totalTokens += p.inputTokens;
    if (typeof p.outputTokens === "number") totalTokens += p.outputTokens;
    if (typeof p.estimatedCostUsd === "number")
      estimatedCostUsd += p.estimatedCostUsd;
  }

  // Shell commands
  const shellCommands = trace.filter((e) => e.source === "shell").length;

  // Verification iterations (each verification-attempt event counts)
  const verificationIterations = trace.filter(
    (e) => e.source === "verification",
  ).length;

  // Time-to-green: find the first verification event with type "result"
  // and status "passed" in its payload.
  const firstPassed = trace.find(
    (e) =>
      e.source === "verification" &&
      e.type === "result" &&
      e.payload.status === "passed",
  );
  let timeToGreen: number | undefined;
  if (firstPassed) {
    const candidate = (parseTime(firstPassed.timestamp) - first) / 1000;
    timeToGreen = Math.max(0, candidate);
  }

  return {
    wallClockTime,
    timeToGreen,
    modelCalls,
    totalTokens,
    estimatedCostUsd,
    shellCommands,
    verificationIterations,
  };
}
