// @rsl/evaluator — Evaluator class (Stages 1-12)

import type { VerificationResult } from "@rsl/benchmark-core";
import { runPipeline, type StageDefinition } from "./pipeline.js";
import {
  installStage,
  buildStage,
  lintStage,
  typecheckStage,
  testStage,
  contractStage,
  hiddenTestStage,
  propertyTestStage,
  mutationTestStage,
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
  hiddenTestStage,
  propertyTestStage,
  mutationTestStage,
} from "./stages.js";

// ── Profile A: Basic (Stages 1-6) ────────────────────────────────────────

/**
 * Profile A default stages: Install, Build, Lint, Typecheck, Public Tests, Contract Validation.
 * These are the visible verification stages run inside the agent workspace.
 */
export const PROFILE_A_STAGES: StageDefinition[] = [
  { stage: 1, name: "Install",               fn: installStage,    fatal: false },
  { stage: 2, name: "Build",                 fn: buildStage,      fatal: true  },
  { stage: 3, name: "Lint",                  fn: lintStage,       fatal: false, dependsOn: [2] },
  { stage: 4, name: "Typecheck",             fn: typecheckStage,  fatal: false, dependsOn: [2] },
  { stage: 5, name: "Public Tests",          fn: testStage,       fatal: false, dependsOn: [2] },
  { stage: 6, name: "Contract Validation",   fn: contractStage,   fatal: false, dependsOn: [5] },
];

// ── Profile B: Behavioral (Stages 1-9) ───────────────────────────────────

/**
 * Profile B adds hidden tests, property tests, and mutation testing.
 * Stages 7-9 run outside the agent workspace.
 */
export const PROFILE_B_STAGES: StageDefinition[] = [
  ...PROFILE_A_STAGES,
  { stage: 7, name: "Hidden Tests",          fn: hiddenTestStage,    fatal: false, dependsOn: [5] },
  { stage: 8, name: "Property Tests",        fn: propertyTestStage,  fatal: false, dependsOn: [5] },
  { stage: 9, name: "Mutation Testing",      fn: mutationTestStage,  fatal: false, dependsOn: [5] },
];

/** @deprecated Use PROFILE_A_STAGES instead. */
export const DEFAULT_STAGES = PROFILE_A_STAGES;

// ── Evaluator ───────────────────────────────────────────────────────────

/**
 * The Evaluator runs the verification pipeline against a candidate workspace.
 */
export class Evaluator {
  readonly workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Run the verification pipeline.
   * @param stages - Ordered list of stage definitions. Defaults to PROFILE_A_STAGES.
   */
  async evaluate(stages?: StageDefinition[]): Promise<VerificationResult[]> {
    const pipeline = stages ?? PROFILE_A_STAGES;
    return runPipeline(this.workspacePath, pipeline);
  }
}
