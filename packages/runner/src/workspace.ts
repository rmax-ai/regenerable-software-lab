// @rsl/runner — Workspace management (SPEC.md §15.2)
//
// Provides workspace lifecycle functions used by the Runner to create,
// populate, and manage run workspaces.

import { existsSync, mkdirSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

// ── Constants ───────────────────────────────────────────────────────────

/** Root directory under which per-run workspaces are created. */
const RUNS_DIR = "runs";

/** Relative path (within a benchmark) where visible assets live. */
const VISIBLE_ASSETS_REL = "visible";

/** Protected subdirectory names that must exist in the workspace. */
const PROTECTED_PATHS = [
  "spec",
  "evaluator",
  "policies",
  "hidden",
  "benchmark-config",
];

// ── Create Workspace ────────────────────────────────────────────────────

/**
 * Create a run workspace directory under `runs/<runId>/`.
 *
 * Creates the directory along with standard subdirectories:
 *  - `source/`  — where the agent's candidate implementation lives
 *  - `trace/`   — where trace files are written
 *  - `artifacts/` — where verification artifacts are stored
 *
 * @param runId - Unique run identifier.
 * @param baseDir - Base directory for run workspaces (defaults to CWD/runs).
 * @returns The absolute path to the created workspace root.
 */
export function createWorkspace(
  runId: string,
  baseDir?: string,
): string {
  const root = baseDir ?? process.cwd();
  const workspacePath = resolve(root, RUNS_DIR, runId);

  mkdirSync(workspacePath, { recursive: true });
  mkdirSync(join(workspacePath, "source"), { recursive: true });
  mkdirSync(join(workspacePath, "trace"), { recursive: true });
  mkdirSync(join(workspacePath, "artifacts"), { recursive: true });

  return workspacePath;
}

// ── Copy Visible Assets ─────────────────────────────────────────────────

/**
 * Copy the visible assets from a benchmark definition into the workspace.
 *
 * Visible assets live at `benchmarks/<benchmarkId>/visible/` and contain
 * everything the agent is allowed to see (spec stub, public tests, config
 * templates, etc.).
 *
 * Assets are copied into the `source/` subdirectory of the workspace so that
 * the agent works from a clean copy.
 *
 * @param benchmarkId  - The benchmark identifier (e.g. "order-pricing").
 * @param workspacePath - Absolute path to the run workspace.
 */
export function copyVisibleAssets(
  benchmarkId: string,
  workspacePath: string,
): void {
  const repoRoot = findRepoRoot(workspacePath);
  const visibleDir = resolve(
    repoRoot,
    "benchmarks",
    benchmarkId,
    VISIBLE_ASSETS_REL,
  );

  if (!existsSync(visibleDir)) {
    // Not all benchmarks have visible assets; that's acceptable.
    return;
  }

  const sourceDir = join(workspacePath, "source");

  // Copy everything from visible/ into source/
  const entries = readdirSync(visibleDir);
  for (const entry of entries) {
    const src = join(visibleDir, entry);
    const dest = join(sourceDir, entry);
    cpSync(src, dest, { recursive: true, force: true });
  }
}

// ── Mount Protected Assets ──────────────────────────────────────────────

/**
 * Ensure that protected asset paths exist in the workspace.
 *
 * Protected paths represent assets the agent must never modify (SPEC.md §9.3):
 * `/spec`, `/evaluator`, `/policies`, `/hidden`, `/benchmark-config`.
 *
 * If a protected path already exists as a regular directory, it is left as-is
 * (typically symlinked or mounted by the container runtime). If it does not
 * exist, an empty directory is created as a placeholder.
 *
 * @param benchmarkId  - The benchmark identifier.
 * @param workspacePath - Absolute path to the run workspace.
 */
export function mountProtectedAssets(
  benchmarkId: string,
  workspacePath: string,
): void {
  // Protected paths live at the workspace root (not inside source/)
  for (const protectedName of PROTECTED_PATHS) {
    const protectedPath = join(workspacePath, protectedName);

    if (!existsSync(protectedPath)) {
      mkdirSync(protectedPath, { recursive: true });
    }
  }

  // Also mount benchmark config from the benchmark definition
  const repoRoot = findRepoRoot(workspacePath);
  const benchmarkConfigDir = resolve(
    repoRoot,
    "benchmarks",
    benchmarkId,
    "benchmark-config",
  );

  if (existsSync(benchmarkConfigDir)) {
    const dest = join(workspacePath, "benchmark-config");
    if (!existsSync(dest)) {
      mkdirSync(dest, { recursive: true });
    }

    // Merge files from the benchmark's config into the workspace
    const entries = readdirSync(benchmarkConfigDir);
    for (const entry of entries) {
      const src = join(benchmarkConfigDir, entry);
      const tgt = join(dest, entry);
      if (!existsSync(tgt)) {
        cpSync(src, tgt, { recursive: true, force: false });
      }
    }
  }
}

// ── Internal Helpers ────────────────────────────────────────────────────

/**
 * Walk up the directory tree from `workspacePath` to find the repository root.
 *
 * The root is identified by the presence of a `package.json` with a
 * `"workspaces"` field (pnpm workspace root) or a `.git` directory.
 *
 * Falls back to the workspace path itself if no root is found.
 */
export function findRepoRoot(workspacePath: string): string {
  let current = resolve(workspacePath);

  while (true) {
    const parent = resolve(current, "..");

    // Stop if we've reached the filesystem root
    if (parent === current) {
      return workspacePath;
    }

    // Check for pnpm workspace root
    const pkgJsonPath = join(current, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pkg = require(pkgJsonPath) as { workspaces?: unknown };
        if (pkg.workspaces) {
          return current;
        }
      } catch {
        // ignore parse errors
      }
    }

    // Check for .git directory
    if (existsSync(join(current, ".git"))) {
      return current;
    }

    current = parent;
  }
}
