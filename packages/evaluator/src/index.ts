// @rsl/evaluator — Evaluator class (Stages 1-6)

import type { VerificationResult } from "@rsl/benchmark-core";
import { runPipeline, type StageDefinition } from "./pipeline.js";
import {
  installStage,
  buildStage,
  lintStage,
  typecheckStage,
  testStage,
  contractStage,
} from "./stages.js";

// Re-export public API
export { runPipeline, type StageDefinition } from "./pipeline.js";
export type { StageResult, StageStatus } from "./types.js";
export type { StageFunction } from "./stages.js";
export {
  installStage,
  buildStage,
  lintStage,
  typecheckStage,
  testStage,
  contractStage,
} from "./stages.js";

// ── Default pipeline (Stages 1-6) ───────────────────────────────────────

/**
 * The default set of visible verification stages.
 *
 * Stages 1-5 are fatal — if any of these fail, the pipeline stops.
 * Stage 6 (Contract Validation) is non-fatal because it depends on the
 * server being built and running, but a failure there should be collected
 * rather than blocking evaluation.
 *
 * Dependency rules:
 *  - Lint (3), Typecheck (4), Tests (5) depend on Build (2).
 *  - Contract (6) depends on Tests (5).
 */
export const DEFAULT_STAGES: StageDefinition[] = [
  { stage: 1, name: "Install",               fn: installStage,    fatal: false },
  { stage: 2, name: "Build",                 fn: buildStage,      fatal: true  },
  { stage: 3, name: "Lint",                  fn: lintStage,       fatal: false, dependsOn: [2] },
  { stage: 4, name: "Typecheck",             fn: typecheckStage,  fatal: false, dependsOn: [2] },
  { stage: 5, name: "Public Tests",          fn: testStage,       fatal: false, dependsOn: [2] },
  { stage: 6, name: "Contract Validation",   fn: contractStage,   fatal: false, dependsOn: [5] },
];

// ── Evaluator ───────────────────────────────────────────────────────────

/**
 * The Evaluator runs the verification pipeline against a candidate workspace.
 *
 * Usage:
 * ```ts
 * const evaluator = new Evaluator("/path/to/workspace");
 * const results = await evaluator.evaluate();
 * // results is VerificationResult[] with entries for each stage
 * ```
 */
export class Evaluator {
  /** Absolute path to the candidate workspace being evaluated. */
  readonly workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Run the full verification pipeline.
   *
   * @param stages - Ordered list of stage definitions. Defaults to
   *                 `DEFAULT_STAGES` (Stages 1-6: Install, Build, Lint,
   *                 Typecheck, Public Tests, Contract Validation).
   * @returns An array of `VerificationResult` objects, one per stage.
   */
  async evaluate(stages?: StageDefinition[]): Promise<VerificationResult[]> {
    const pipeline = stages ?? DEFAULT_STAGES;
    return runPipeline(this.workspacePath, pipeline);
  }
}
