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

export const PROFILE_A_STAGES: StageDefinition[] = [
  { stage: 1, name: "Install",             fn: installStage,      fatal: false },
  { stage: 2, name: "Build",               fn: buildStage,        fatal: true  },
  { stage: 3, name: "Lint",                fn: lintStage,         fatal: false, dependsOn: [2] },
  { stage: 4, name: "Typecheck",           fn: typecheckStage,    fatal: false, dependsOn: [2] },
  { stage: 5, name: "Public Tests",        fn: testStage,         fatal: false, dependsOn: [2] },
  { stage: 6, name: "Contract Validation", fn: contractStage,     fatal: false, dependsOn: [5] },
];

// ── Profile B: Behavioral (Stages 1-9) ───────────────────────────────────

export const PROFILE_B_STAGES: StageDefinition[] = [
  ...PROFILE_A_STAGES,
  { stage: 7, name: "Hidden Tests",      fn: hiddenTestStage,    fatal: false, dependsOn: [5] },
  { stage: 8, name: "Property Tests",    fn: propertyTestStage,  fatal: false, dependsOn: [5] },
  { stage: 9, name: "Mutation Testing",  fn: mutationTestStage,  fatal: false, dependsOn: [5] },
];

// ── Profile C: Operational (Stages 1-9, placeholder for 10-12) ───────────

export const PROFILE_C_STAGES: StageDefinition[] = [...PROFILE_B_STAGES];

// ── Evaluator ───────────────────────────────────────────────────────────

export class Evaluator {
  readonly workspacePath: string;
  readonly benchmarkDir?: string;

  constructor(workspacePath: string, benchmarkDir?: string) {
    this.workspacePath = workspacePath;
    this.benchmarkDir = benchmarkDir;
  }

  async evaluate(stages?: StageDefinition[]): Promise<VerificationResult[]> {
    const pipeline = stages ?? PROFILE_A_STAGES;
    return runPipeline(this.workspacePath, pipeline, this.benchmarkDir);
  }
}
