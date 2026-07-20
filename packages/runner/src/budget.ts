// @rsl/runner — Budget enforcement (SPEC.md §15.4)
//
// Provides budget-limit checking functions used by the Runner to enforce
// wall-clock, model-usage, and disk-space limits per run.

import type { RunLimits, ModelUsage } from "@rsl/benchmark-core";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Exports ─────────────────────────────────────────────────────────────

export interface BudgetCheck {
  readonly exceeded: boolean;
  readonly reason?: string;
  readonly metric: string;
  readonly limit: number;
  readonly actual: number;
}

// ── Wall Clock ──────────────────────────────────────────────────────────

/**
 * Check whether the elapsed wall-clock time has exceeded the configured limit.
 *
 * @param startTime - Timestamp (ms) when the run started (e.g. Date.now()).
 * @param limit     - Maximum allowed wall-clock seconds from RunLimits.
 * @returns A BudgetCheck indicating whether the limit was exceeded.
 */
export function checkWallClock(startTime: number, limit: number): BudgetCheck {
  const elapsedMs = Date.now() - startTime;
  const elapsedSec = elapsedMs / 1000;

  return {
    exceeded: elapsedSec > limit,
    reason: elapsedSec > limit
      ? `Wall clock limit exceeded: ${elapsedSec.toFixed(1)}s > ${limit}s`
      : undefined,
    metric: "wallClockSeconds",
    limit,
    actual: elapsedSec,
  };
}

// ── Model Usage ─────────────────────────────────────────────────────────

/**
 * Check whether model-usage metrics have exceeded the configured limits.
 *
 * Evaluates each limit that is set (model calls, input tokens, output tokens,
 * estimated cost). Returns the *first* exceeded limit, or a pass result if
 * none are exceeded.
 *
 * @param usage  - Accumulated ModelUsage from the harness execution result.
 * @param limits - RunLimits containing optional maxModelCalls, maxInputTokens,
 *                 maxOutputTokens, and maxCostUsd.
 * @returns A BudgetCheck — exceeded is true if **any** limit was breached.
 */
export function checkModelUsage(
  usage: ModelUsage,
  limits: RunLimits,
): BudgetCheck {
  // Model calls
  if (
    limits.maxModelCalls !== undefined &&
    usage.modelCalls > limits.maxModelCalls
  ) {
    return {
      exceeded: true,
      reason: `Model call limit exceeded: ${usage.modelCalls} > ${limits.maxModelCalls}`,
      metric: "maxModelCalls",
      limit: limits.maxModelCalls,
      actual: usage.modelCalls,
    };
  }

  // Input tokens
  if (
    limits.maxInputTokens !== undefined &&
    usage.inputTokens > limits.maxInputTokens
  ) {
    return {
      exceeded: true,
      reason: `Input token limit exceeded: ${usage.inputTokens} > ${limits.maxInputTokens}`,
      metric: "maxInputTokens",
      limit: limits.maxInputTokens,
      actual: usage.inputTokens,
    };
  }

  // Output tokens
  if (
    limits.maxOutputTokens !== undefined &&
    usage.outputTokens > limits.maxOutputTokens
  ) {
    return {
      exceeded: true,
      reason: `Output token limit exceeded: ${usage.outputTokens} > ${limits.maxOutputTokens}`,
      metric: "maxOutputTokens",
      limit: limits.maxOutputTokens,
      actual: usage.outputTokens,
    };
  }

  // Cost
  if (
    limits.maxCostUsd !== undefined &&
    usage.estimatedCostUsd > limits.maxCostUsd
  ) {
    return {
      exceeded: true,
      reason: `Cost limit exceeded: $${usage.estimatedCostUsd.toFixed(4)} > $${limits.maxCostUsd.toFixed(4)}`,
      metric: "maxCostUsd",
      limit: limits.maxCostUsd,
      actual: usage.estimatedCostUsd,
    };
  }

  return {
    exceeded: false,
    metric: "modelUsage",
    limit: 0,
    actual: 0,
  };
}

// ── Disk Usage ──────────────────────────────────────────────────────────

/**
 * Check whether the workspace disk usage exceeds the configured limit.
 *
 * Uses an `fs.statSync`-based recursive scan to compute the total directory
 * size in megabytes.
 *
 * @param workspacePath - Absolute path to the workspace directory.
 * @param limitMb       - Maximum allowed disk usage in megabytes.
 * @returns A BudgetCheck indicating whether the limit was exceeded.
 */
export function checkDiskUsage(
  workspacePath: string,
  limitMb: number,
): BudgetCheck {
  const actualMb = getDirectorySizeMb(workspacePath);

  return {
    exceeded: actualMb > limitMb,
    reason: actualMb > limitMb
      ? `Disk usage limit exceeded: ${actualMb.toFixed(1)} MB > ${limitMb} MB`
      : undefined,
    metric: "maxDiskMb",
    limit: limitMb,
    actual: actualMb,
  };
}

// ── Internal Helpers ────────────────────────────────────────────────────

/**
 * Recursively compute the total size of a directory in megabytes.
 *
 * Uses synchronous APIs for simplicity and to match the synchronous
 * nature of budget checks. Returns 0 if the path does not exist.
 */
function getDirectorySizeMb(dirPath: string): number {

  let totalBytes = 0;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalBytes += getDirectorySizeMb(fullPath) * 1024 * 1024; // recurse in bytes
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          totalBytes += stat.size;
        } catch {
          // skip unreadable files
        }
      }
    }
  } catch {
    // directory doesn't exist or is unreadable
    return 0;
  }

  return totalBytes / (1024 * 1024);
}
