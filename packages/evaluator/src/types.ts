// @rsl/evaluator — Stage definition types

import type { FailureCategory } from "@rsl/benchmark-core";

/** The status of a single verification stage. */
export type StageStatus = "passed" | "failed" | "skipped" | "error";

/**
 * The result produced by a single stage execution.
 *
 * This is the internal representation used within the pipeline.
 * It is converted to `VerificationResult` (from @rsl/benchmark-core)
 * when the pipeline returns its final output.
 */
export interface StageResult {
  /** 0-based or 1-based stage number matching the pipeline definition. */
  stage: number;

  /** Human-readable stage name (e.g. "Install", "Build"). */
  name: string;

  /** Outcome of the stage. */
  status: StageStatus;

  /** Wall-clock duration in milliseconds. */
  durationMs: number;

  /** Arbitrary numeric/string/boolean metrics (e.g. exit code, test count). */
  metrics: Record<string, number | string | boolean>;

  /**
   * Optional failure category from the shared taxonomy
   * (@rsl/benchmark-core FailureCategory).
   */
  failureCategory?: FailureCategory;

  /** Paths to artifact files produced by this stage. */
  artifacts: string[];

  /** Process exit code, if applicable. */
  exitCode?: number;
}
