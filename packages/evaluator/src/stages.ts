// @rsl/evaluator — Individual verification stages (Stages 1-12)

import { execSync } from "node:child_process";
import type { FailureCategory } from "@rsl/benchmark-core";
import type { StageResult } from "./types.js";
import { validateContract } from "./contract-validator.js";

// ── Stage function signature ────────────────────────────────────────────

/** A single verification stage: receives a workspace path and produces a result. */
export type StageFunction = (workspacePath: string) => Promise<StageResult>;

// ── Helpers ─────────────────────────────────────────────────────────────

/** Maximum time (ms) to wait for a shell-based stage to complete. */
const STAGE_TIMEOUT = 120_000;

/** Run a shell command in the workspace and produce a StageResult. */
function runShellStage(
  stage: number,
  name: string,
  workspacePath: string,
  command: string,
  failureCategory: FailureCategory,
): StageResult {
  const start = performance.now();

  try {
    const result = execSync(command, {
      cwd: workspacePath,
      stdio: "pipe",
      timeout: STAGE_TIMEOUT,
      env: { ...process.env },
    });
    const durationMs = Math.round(performance.now() - start);

    return {
      stage,
      name,
      status: "passed",
      durationMs,
      metrics: { exitCode: 0, outputLength: result.toString().length },
      artifacts: [],
    };
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - start);
    const exitCode = extractExitCode(err);

    return {
      stage,
      name,
      status: "failed",
      durationMs,
      metrics: { exitCode },
      failureCategory,
      artifacts: [],
    };
  }
}

/** Extract the exit code from an execSync error, defaulting to 1. */
function extractExitCode(err: unknown): number {
  if (err && typeof err === "object") {
    const e = err as { status?: number; code?: string };
    if (typeof e.status === "number") return e.status;
    if (e.code === "ETIMEDOUT") return 124;
  }
  return 1;
}

// ── Stage 1: Install ────────────────────────────────────────────────────

/**
 * Install dependencies via `pnpm install`.
 * Failure category: ENVIRONMENT_FAILURE (environment issue rather than
 * candidate logic issue — the candidate's install is still required to pass).
 */
export async function installStage(workspacePath: string): Promise<StageResult> {
  return runShellStage(1, "Install", workspacePath, "pnpm install", "ENVIRONMENT_FAILURE");
}

// ── Stage 2: Build ──────────────────────────────────────────────────────

/**
 * Compile TypeScript via `pnpm build` (which runs tsc).
 * A build failure is a fatal candidate error.
 */
export async function buildStage(workspacePath: string): Promise<StageResult> {
  return runShellStage(2, "Build", workspacePath, "pnpm build", "BUILD_FAILURE");
}

// ── Stage 3: Lint ───────────────────────────────────────────────────────

/**
 * Run ESLint via `pnpm lint`.
 * Lint failures may indicate code quality issues.
 */
export async function lintStage(workspacePath: string): Promise<StageResult> {
  return runShellStage(3, "Lint", workspacePath, "pnpm lint", "BUILD_FAILURE");
}

// ── Stage 4: Typecheck ──────────────────────────────────────────────────

/**
 * Run the TypeScript compiler in type-check-only mode via `pnpm typecheck`.
 * Type errors indicate the candidate did not satisfy the type contract.
 */
export async function typecheckStage(workspacePath: string): Promise<StageResult> {
  return runShellStage(4, "Typecheck", workspacePath, "pnpm typecheck", "TYPE_ERROR");
}

// ── Stage 5: Public Tests ───────────────────────────────────────────────

/**
 * Run the public test suite via `pnpm test` (vitest run).
 * Public test failures indicate functional bugs.
 */
export async function testStage(workspacePath: string): Promise<StageResult> {
  return runShellStage(5, "Public Tests", workspacePath, "pnpm test", "PUBLIC_TEST_FAILURE");
}

// ── Stage 6: Contract Validation ────────────────────────────────────────

/**
 * Validate the running application's API responses against the OpenAPI spec.
 * Requires temporarily starting the server.
 */
export async function contractStage(workspacePath: string): Promise<StageResult> {
  return validateContract(workspacePath);
}

// ── Stage 7: Hidden Tests ───────────────────────────────────────────────

/**
 * Run hidden tests that the agent never saw.
 * Hidden tests exercise edge cases, adversarial inputs, and error paths
 * not covered by public tests. These run outside the agent workspace.
 * Failure category: HIDDEN_TEST_FAILURE
 */
export async function hiddenTestStage(workspacePath: string): Promise<StageResult> {
  return runShellStage(7, "Hidden Tests", workspacePath, "pnpm test:hidden", "HIDDEN_TEST_FAILURE");
}

// ── Stage 8: Property Tests ─────────────────────────────────────────────

/**
 * Run fast-check property-based tests that verify domain invariants hold
 * across randomly generated inputs.
 * Failure category: PROPERTY_VIOLATION
 */
export async function propertyTestStage(workspacePath: string): Promise<StageResult> {
  return runShellStage(8, "Property Tests", workspacePath, "pnpm test:property", "PROPERTY_VIOLATION");
}

// ── Stage 9: Mutation Testing ───────────────────────────────────────────

/**
 * Run StrykerJS mutation testing to evaluate whether the test suite catches
 * intentionally injected defects.
 * Failure category: MUTATION_SURVIVOR
 */
export async function mutationTestStage(workspacePath: string): Promise<StageResult> {
  return runShellStage(9, "Mutation Testing", workspacePath, "pnpm test:mutation", "MUTATION_SURVIVOR");
}
