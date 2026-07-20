// @rsl/evaluator — Individual verification stages (Stages 1-12)

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FailureCategory } from "@rsl/benchmark-core";
import type { StageResult } from "./types.js";
import { validateContract } from "./contract-validator.js";

// ── Stage function signature ────────────────────────────────────────────

/** A single verification stage: receives a workspace path and optional benchmark directory. */
export type StageFunction = (
  workspacePath: string,
  benchmarkDir?: string,
) => Promise<StageResult>;

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

export async function installStage(workspacePath: string): Promise<StageResult> {
  return runShellStage(1, "Install", workspacePath, "pnpm install", "ENVIRONMENT_FAILURE");
}

// ── Stage 2: Build ──────────────────────────────────────────────────────

export async function buildStage(workspacePath: string): Promise<StageResult> {
  return runShellStage(2, "Build", workspacePath, "pnpm build", "BUILD_FAILURE");
}

// ── Stage 3: Lint ───────────────────────────────────────────────────────

export async function lintStage(workspacePath: string): Promise<StageResult> {
  return runShellStage(3, "Lint", workspacePath, "pnpm lint", "BUILD_FAILURE");
}

// ── Stage 4: Typecheck ──────────────────────────────────────────────────

export async function typecheckStage(workspacePath: string): Promise<StageResult> {
  return runShellStage(4, "Typecheck", workspacePath, "pnpm typecheck", "TYPE_ERROR");
}

// ── Stage 5: Public Tests ───────────────────────────────────────────────

export async function testStage(workspacePath: string): Promise<StageResult> {
  return runShellStage(5, "Public Tests", workspacePath, "pnpm test", "PUBLIC_TEST_FAILURE");
}

// ── Stage 6: Contract Validation ────────────────────────────────────────

export async function contractStage(workspacePath: string): Promise<StageResult> {
  return validateContract(workspacePath);
}

// ── Stage 7: Hidden Tests ───────────────────────────────────────────────

/**
 * Run hidden tests from the benchmark's hidden directory against the
 * agent's candidate source code.
 *
 * Uses the `@candidate` vitest alias resolved via CANDIDATE_SRC env var
 * to point hidden test imports at the candidate source rather than the
 * reference implementation.
 */
export async function hiddenTestStage(
  workspacePath: string,
  benchmarkDir?: string,
): Promise<StageResult> {
  return runExternalVitestStage(
    7,
    "Hidden Tests",
    workspacePath,
    benchmarkDir,
    "hidden",
    "HIDDEN_TEST_FAILURE",
  );
}

// ── Stage 8: Property Tests ─────────────────────────────────────────────

export async function propertyTestStage(
  workspacePath: string,
  benchmarkDir?: string,
): Promise<StageResult> {
  return runExternalVitestStage(
    8,
    "Property Tests",
    workspacePath,
    benchmarkDir,
    "property",
    "PROPERTY_VIOLATION",
  );
}

// ── Stage 9: Mutation Testing ───────────────────────────────────────────

export async function mutationTestStage(
  workspacePath: string,
  benchmarkDir?: string,
): Promise<StageResult> {
  if (!benchmarkDir) {
    return {
      stage: 9,
      name: "Mutation Testing",
      status: "skipped",
      durationMs: 0,
      metrics: { reason: "No benchmark directory provided" },
      artifacts: [],
    };
  }

  // workspacePath is already the agent's source directory (set by runner).
  // Do NOT append "source" again.
  const sourceDir = workspacePath;
  const strykerConfig = resolve(benchmarkDir, "hidden", "stryker", "stryker.config.mjs");

  if (!existsSync(strykerConfig)) {
    return {
      stage: 9,
      name: "Mutation Testing",
      status: "skipped",
      durationMs: 0,
      metrics: { reason: `Stryker config not found: ${strykerConfig}` },
      artifacts: [],
    };
  }

  // Stryker mutates source files in place. Run it from the source directory
  // with a modified config pointing at the candidate source.
  const start = performance.now();

  try {
    execSync(`npx stryker run --configFile "${strykerConfig}"`, {
      cwd: sourceDir,
      stdio: "pipe",
      timeout: 600_000, // mutation testing is slow
      env: {
        ...process.env,
        CANDIDATE_SRC: sourceDir,
      },
    });
    const durationMs = Math.round(performance.now() - start);

    return {
      stage: 9,
      name: "Mutation Testing",
      status: "passed",
      durationMs,
      metrics: {},
      artifacts: [],
    };
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - start);
    return {
      stage: 9,
      name: "Mutation Testing",
      status: "failed",
      durationMs,
      metrics: { exitCode: extractExitCode(err) },
      failureCategory: "MUTATION_SURVIVOR",
      artifacts: [],
    };
  }
}

// ── External vitest runner (Stages 7-8) ─────────────────────────────────

/**
 * Run vitest from the benchmark's hidden directory against the candidate source.
 *
 * @param stage       - Stage number.
 * @param name        - Human-readable stage name.
 * @param workspacePath - Path to the run workspace (contains `source/` subdir).
 * @param benchmarkDir - Path to the benchmark definition root.
 * @param testMode    - "hidden" or "property" — controls which tests run.
 * @param failureCategory - Category to assign on failure.
 */
function runExternalVitestStage(
  stage: number,
  name: string,
  workspacePath: string,
  benchmarkDir: string | undefined,
  testMode: "hidden" | "property",
  failureCategory: FailureCategory,
): StageResult {
  if (!benchmarkDir) {
    return {
      stage,
      name,
      status: "skipped",
      durationMs: 0,
      metrics: { reason: "No benchmark directory provided" },
      artifacts: [],
    };
  }

  const hiddenDir = resolve(benchmarkDir, "hidden");
  const vitestConfig = resolve(hiddenDir, "vitest.config.ts");
  // workspacePath is already the agent's source directory (set by runner).
  // Do NOT append "source" again — that produces a double-nested path.
  const sourceDir = workspacePath;

  if (!existsSync(vitestConfig)) {
    return {
      stage,
      name,
      status: "skipped",
      durationMs: 0,
      metrics: { reason: `Vitest config not found: ${vitestConfig}` },
      artifacts: [],
    };
  }

  if (!existsSync(sourceDir)) {
    return {
      stage,
      name,
      status: "skipped",
      durationMs: 0,
      metrics: { reason: `Source directory not found: ${sourceDir}` },
      artifacts: [],
    };
  }

  const start = performance.now();

  try {
    // Run vitest from the agent's source directory so vitest/config resolves.
    // The vitest config file path is absolute, so cwd doesn't affect config loading.
    //
    // CANDIDATE_SRC: point to the agent's src/ subdirectory if it exists
    // (agents typically generate source in src/), otherwise use the root.
    const candidateSrc = existsSync(join(sourceDir, "src"))
      ? join(sourceDir, "src")
      : sourceDir;

    // Property tests need fast-check, which the agent may not have installed.
    // Install it best-effort — failure here is not a verification failure.
    if (testMode === "property") {
      try {
        execSync("pnpm add -D fast-check", {
          cwd: sourceDir,
          stdio: "pipe",
          timeout: 30_000,
        });
      } catch {
        // fast-check unavailable — property tests will report import errors.
      }
    }

    // Vitest resolves modules from its config root (hidden dir), not cwd.
    // Use the vitest binary from the agent's node_modules so Vite can
    // resolve fast-check, decimal.js, and other packages from there too.
    const vitestBin = existsSync(join(sourceDir, "node_modules", ".bin", "vitest"))
      ? join(sourceDir, "node_modules", ".bin", "vitest")
      : "npx vitest";

    execSync(
      `"${vitestBin}" run --config "${vitestConfig}"`,
      {
        cwd: sourceDir,
        stdio: "pipe",
        timeout: STAGE_TIMEOUT,
        env: {
          ...process.env,
          CANDIDATE_SRC: candidateSrc,
          TEST_MODE: testMode,
          AGENT_NODE_MODULES: join(sourceDir, "node_modules"),
        },
      },
    );
    const durationMs = Math.round(performance.now() - start);

    return {
      stage,
      name,
      status: "passed",
      durationMs,
      metrics: { exitCode: 0 },
      artifacts: [],
    };
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - start);
    return {
      stage,
      name,
      status: "failed",
      durationMs,
      metrics: { exitCode: extractExitCode(err) },
      failureCategory,
      artifacts: [],
    };
  }
}
