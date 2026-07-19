// @rsl/policies -- Filesystem policy enforcement (SPEC.md §9.3, §16.1)
//
// Verifies that:
//   1. No writes have occurred to protected paths
//   2. The workspace stays within the configured disk budget
//   3. Violations are reported with actionable details

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────

export interface FilesystemViolation {
  type: "protected_path_write" | "disk_budget_exceeded";
  path?: string;
  reason: string;
  severity: "error" | "warning";
}

export interface FilesystemPolicyResult {
  /** Whether all checks passed */
  passed: boolean;
  /** Total disk usage in MB */
  diskUsageMb: number;
  /** Configured disk budget in MB */
  diskBudgetMb: number;
  /** Any violations found */
  violations: FilesystemViolation[];
}

// ── Constants ─────────────────────────────────────────────────────────────

const PROTECTED_PATH_NAMES = [
  "spec",
  "evaluator",
  "policies",
  "hidden",
  "benchmark-config",
];

// ── FilesystemPolicy ──────────────────────────────────────────────────────

export class FilesystemPolicy {
  private readonly protectedPaths: string[];
  private readonly diskBudgetMb: number;

  /**
   * @param workspacePath   - Absolute path to the run workspace root.
   * @param protectedPaths  - Additional protected path names (merged with built-in set).
   * @param diskBudgetMb    - Maximum allowed disk usage in MB (default: 1024).
   */
  constructor(
    private readonly workspacePath: string,
    protectedPaths?: string[],
    diskBudgetMb?: number,
  ) {
    this.protectedPaths = [
      ...PROTECTED_PATH_NAMES,
      ...(protectedPaths ?? []),
    ];
    this.diskBudgetMb = diskBudgetMb ?? 1024;
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Execute all filesystem policy checks.
   *
   * Checks:
   *   1. Protected path integrity -- no writes to protected directories
   *   2. Disk budget -- workspace size does not exceed configured limit
   *
   * @returns A FilesystemPolicyResult with violations and metrics.
   */
  enforce(): FilesystemPolicyResult {
    const violations: FilesystemViolation[] = [];

    // ── Check 1: Protected path integrity ─────────────────────────
    const protectedViolations = this.checkProtectedPaths();
    violations.push(...protectedViolations);

    // ── Check 2: Disk budget ──────────────────────────────────────
    const diskUsageMb = this.computeDiskUsage(this.workspacePath);
    const diskExceeded = diskUsageMb > this.diskBudgetMb;

    if (diskExceeded) {
      violations.push({
        type: "disk_budget_exceeded",
        reason: `Disk budget exceeded: ${diskUsageMb.toFixed(1)} MB > ${this.diskBudgetMb} MB`,
        severity: "error",
      });
    }

    return {
      passed: violations.length === 0,
      diskUsageMb,
      diskBudgetMb: this.diskBudgetMb,
      violations,
    };
  }

  // ── Protected Path Checks ─────────────────────────────────────────

  /**
   * Verify that none of the protected paths show signs of modification.
   *
   * A protected path is considered modified if there are files in it that
   * were not placed there by the mountProtectedAssets step (i.e., files
   * that are not part of the original benchmark config).
   *
   * For simplicity, checks if the directory contains entries beyond what
   * the benchmark explicitly mounted. A stricter check would compare
   * file hashes against a known-good manifest.
   */
  private checkProtectedPaths(): FilesystemViolation[] {
    const violations: FilesystemViolation[] = [];

    for (const name of this.protectedPaths) {
      const fullPath = resolve(this.workspacePath, name);

      if (!existsSync(fullPath)) {
        // Protected path doesn't exist yet -- not a violation
        continue;
      }

      try {
        const stat = statSync(fullPath);
        if (!stat.isDirectory()) {
          // Protected path was replaced with a non-directory (file, symlink)
          violations.push({
            type: "protected_path_write",
            path: fullPath,
            reason: `Protected path "${name}" exists but is not a directory -- possible tampering`,
            severity: "error",
          });
          continue;
        }

        // Check if there are unexpected entries
        const entries = readdirSync(fullPath);
        if (entries.length > 0) {
          // For benchmark-config, entries are expected (mounted by mountProtectedAssets)
          // For other paths, any entry not matching expected mount content is suspicious
          if (name === "benchmark-config") {
            // Benchmark config is populated by the runner; check if any entry
            // appears to be a modification (new file added by the agent)
            const suspiciousEntries = this.findSuspiciousEntries(fullPath, name);
            for (const entry of suspiciousEntries) {
              violations.push({
                type: "protected_path_write",
                path: join(fullPath, entry),
                reason: `Unexpected file in protected path "${name}": "${entry}" -- agent should not modify protected assets`,
                severity: "error",
              });
            }
          } else {
            // For /spec, /evaluator, /policies, /hidden -- any content could be a mount
            // We only flag if there's a non-symlink non-directory entry that looks
            // like a modification (writable files)
            const suspiciousEntries = this.findSuspiciousEntries(fullPath, name);
            for (const entry of suspiciousEntries) {
              violations.push({
                type: "protected_path_write",
                path: join(fullPath, entry),
                reason: `Unexpected file in protected path "${name}": "${entry}" -- protected assets must not be modified`,
                severity: "error",
              });
            }
          }
        }
      } catch (err: unknown) {
        violations.push({
          type: "protected_path_write",
          path: fullPath,
          reason: `Cannot inspect protected path "${name}": ${err instanceof Error ? err.message : String(err)}`,
          severity: "warning",
        });
      }
    }

    return violations;
  }

  /**
   * Find entries in a protected path that look like agent modifications.
   *
   * Entries matching known benchmark asset patterns (like config files
   * that were mounted) are excluded. Everything else is suspicious.
   */
  private findSuspiciousEntries(
    dirPath: string,
    protectedName: string,
  ): string[] {
    const suspicious: string[] = [];

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        // Skip hidden files that are part of the mount setup
        if (entry.name.startsWith(".")) {
          continue;
        }

        // For benchmark-config, known config files are expected
        if (protectedName === "benchmark-config") {
          // All entries in benchmark-config are placed by the runner;
          // flag any that appear to be agent-created
          if (this.isAgentCreatedFile(join(dirPath, entry.name))) {
            suspicious.push(entry.name);
          }
          continue;
        }

        // For other protected paths, flag entries that are regular files
        // or directories that weren't part of the original mount
        if (entry.isFile() || entry.isSymbolicLink()) {
          suspicious.push(entry.name);
        }
      }
    } catch {
      // unreadable
    }

    return suspicious;
  }

  /**
   * Heuristic: an agent-created file is one that does not match known
   * benchmark config file patterns (YAML, JSON, TOML mounted by the runner).
   *
   * For now, we assume any non-hidden entry in a protected path is suspicious
   * unless it matches a known-allowed pattern for that path.
   */
  private isAgentCreatedFile(filePath: string): boolean {
    try {
      const stat = statSync(filePath);

      // Directories are not suspicious by themselves
      if (stat.isDirectory()) {
        return false;
      }

      // Symlinks to files outside the workspace are expected mounts
      if (stat.isSymbolicLink()) {
        return false;
      }

      // Regular files could be modifications; flag them
      if (stat.isFile()) {
        // Snapshot the mtime -- files created after mount time could be modifications
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  // ── Disk Usage ─────────────────────────────────────────────────────

  /**
   * Compute the total disk usage of the workspace in megabytes.
   *
   * Uses a recursive synchronous scan. Returns 0 if the path does not exist.
   */
  private computeDiskUsage(dirPath: string): number {
    let totalBytes = 0;

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        // Skip protected paths themselves from the disk budget check
        if (entry.isDirectory() && this.protectedPaths.includes(entry.name)) {
          continue;
        }

        try {
          if (entry.isDirectory()) {
            totalBytes += this.computeDiskUsage(fullPath) * 1024 * 1024;
          } else if (entry.isFile()) {
            const s = statSync(fullPath);
            totalBytes += s.size;
          }
        } catch {
          // skip unreadable entries
        }
      }
    } catch {
      // directory doesn't exist or is unreadable
      return 0;
    }

    return totalBytes / (1024 * 1024);
  }
}
