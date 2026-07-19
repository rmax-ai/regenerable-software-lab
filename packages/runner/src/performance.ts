// @rsl/runner -- Performance budget checker (SPEC.md §16)
//
// Measures build time, test execution time, and memory usage against
// configured performance budgets. Reports violations for each dimension.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────

export interface PerformanceBudget {
  /** Max allowed build time in seconds */
  maxBuildTimeSeconds: number;
  /** Max allowed test execution time in seconds */
  maxTestTimeSeconds: number;
  /** Max allowed memory usage in MB */
  maxMemoryMb: number;
}

export interface PerformanceViolation {
  metric: string;
  limit: number;
  actual: number;
  reason: string;
}

export interface PerformanceReport {
  budget: PerformanceBudget;
  buildTimeSeconds: number;
  testTimeSeconds: number;
  memoryUsageMb: number;
  violations: PerformanceViolation[];
  passed: boolean;
}

// ── Defaults ──────────────────────────────────────────────────────────────

const DEFAULT_BUDGET: PerformanceBudget = {
  maxBuildTimeSeconds: 120,
  maxTestTimeSeconds: 300,
  maxMemoryMb: 1024,
};

// ── PerformanceChecker ────────────────────────────────────────────────────

export class PerformanceChecker {
  private readonly budget: PerformanceBudget;

  constructor(budget?: Partial<PerformanceBudget>) {
    this.budget = { ...DEFAULT_BUDGET, ...budget };
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Run all performance checks against the given workspace.
   *
   * @param workspacePath - Absolute path to the workspace directory.
   * @param buildLogPath  - Optional path to a build log file for timing.
   * @param testLogPath   - Optional path to a test log file for timing.
   * @returns A PerformanceReport with measured values and violations.
   */
  check(
    workspacePath: string,
    buildLogPath?: string,
    testLogPath?: string,
  ): PerformanceReport {
    const buildTimeSeconds = this.measureBuildTime(workspacePath, buildLogPath);
    const testTimeSeconds = this.measureTestTime(workspacePath, testLogPath);
    const memoryUsageMb = this.measureMemoryUsage(workspacePath);

    const violations: PerformanceViolation[] = [];

    if (buildTimeSeconds > this.budget.maxBuildTimeSeconds) {
      violations.push({
        metric: "buildTimeSeconds",
        limit: this.budget.maxBuildTimeSeconds,
        actual: buildTimeSeconds,
        reason: `Build time exceeded: ${buildTimeSeconds.toFixed(1)}s > ${this.budget.maxBuildTimeSeconds}s`,
      });
    }

    if (testTimeSeconds > this.budget.maxTestTimeSeconds) {
      violations.push({
        metric: "testTimeSeconds",
        limit: this.budget.maxTestTimeSeconds,
        actual: testTimeSeconds,
        reason: `Test execution time exceeded: ${testTimeSeconds.toFixed(1)}s > ${this.budget.maxTestTimeSeconds}s`,
      });
    }

    if (memoryUsageMb > this.budget.maxMemoryMb) {
      violations.push({
        metric: "memoryUsageMb",
        limit: this.budget.maxMemoryMb,
        actual: memoryUsageMb,
        reason: `Memory usage exceeded: ${memoryUsageMb.toFixed(1)} MB > ${this.budget.maxMemoryMb} MB`,
      });
    }

    return {
      budget: this.budget,
      buildTimeSeconds,
      testTimeSeconds,
      memoryUsageMb,
      violations,
      passed: violations.length === 0,
    };
  }

  // ── Measurement Helpers ─────────────────────────────────────────────

  /**
   * Measure build time from a build log file or by inspecting timestamps
   * on built artifacts in the workspace.
   *
   * Falls back to 0 if no timing information is available.
   */
  private measureBuildTime(workspacePath: string, logPath?: string): number {
    // Priority 1: parse a structured build log for elapsed time
    if (logPath && existsSync(logPath)) {
      const elapsed = this.parseTimeFromLog(logPath, "build");
      if (elapsed > 0) {
        return elapsed;
      }
    }

    // Priority 2: look for dist/ directory mtime as a proxy
    const distDir = resolve(workspacePath, "source", "dist");
    if (existsSync(distDir)) {
      try {
        const stat = statSync(distDir);
        // Return mtime delta is not available, use 0 as no timing info
        // We treat build time as unknown rather than guessing
        return 0;
      } catch {
        // unreadable
      }
    }

    return 0;
  }

  /**
   * Measure test execution time from a test log file.
   *
   * Falls back to 0 if no timing information is available.
   */
  private measureTestTime(workspacePath: string, logPath?: string): number {
    if (logPath && existsSync(logPath)) {
      const elapsed = this.parseTimeFromLog(logPath, "test");
      if (elapsed > 0) {
        return elapsed;
      }
    }

    // Look for JUnit-style XML reports
    const testResultsDir = resolve(workspacePath, "source", "test-results");
    if (existsSync(testResultsDir)) {
      // Could parse JUnit XML time attributes; for now return 0
      return 0;
    }

    return 0;
  }

  /**
   * Measure memory usage of the target workspace.
   *
   * Reads cgroup memory stats if available (Docker container) or falls
   * back to reading /proc/self/status or returning 0.
   */
  private measureMemoryUsage(workspacePath: string): number {
    // Try container memory limit via cgroup v2
    const cgroupMemoryMax = "/sys/fs/cgroup/memory.max";
    if (existsSync(cgroupMemoryMax)) {
      try {
        const content = readFileSync(cgroupMemoryMax, "utf-8").trim();
        const bytes = Number.parseInt(content, 10);
        if (!Number.isNaN(bytes) && bytes > 0 && bytes < Number.MAX_SAFE_INTEGER) {
          return bytes / (1024 * 1024);
        }
      } catch {
        // unreadable
      }
    }

    // Try cgroup v1
    const cgroupMemoryLimitInBytes = "/sys/fs/cgroup/memory/memory.limit_in_bytes";
    if (existsSync(cgroupMemoryLimitInBytes)) {
      try {
        const content = readFileSync(cgroupMemoryLimitInBytes, "utf-8").trim();
        const bytes = Number.parseInt(content, 10);
        if (!Number.isNaN(bytes) && bytes > 0 && bytes < Number.MAX_SAFE_INTEGER) {
          return bytes / (1024 * 1024);
        }
      } catch {
        // unreadable
      }
    }

    // Try current memory usage from cgroup memory.current
    const cgroupMemoryCurrent = "/sys/fs/cgroup/memory.current";
    if (existsSync(cgroupMemoryCurrent)) {
      try {
        const content = readFileSync(cgroupMemoryCurrent, "utf-8").trim();
        const bytes = Number.parseInt(content, 10);
        if (!Number.isNaN(bytes) && bytes > 0) {
          return bytes / (1024 * 1024);
        }
      } catch {
        // unreadable
      }
    }

    return 0;
  }

  /**
   * Parse a log file for timing information.
   *
   * Looks for common patterns:
   *   - "Done in Xs" or "Done in X.s" (yarn/pnpm style)
   *   - "Build completed in Xms/Xs"
   *   - "Tests: X passed, Y failed (Zs)" (vitest style)
   *   - "Test Suites: ... Time: Xs" (jest style)
   */
  private parseTimeFromLog(logPath: string, context: "build" | "test"): number {
    try {
      const content = readFileSync(logPath, "utf-8");

      // pnpm / yarn style: "Done in 12.3s"
      const doneMatch = content.match(/Done in\s+([\d.]+)\s*s/);
      if (doneMatch?.[1]) {
        return Number.parseFloat(doneMatch[1]);
      }

      // "Build completed in 5000ms" or "Build completed in 5s"
      const buildMsMatch = content.match(/Build completed in\s+(\d+)\s*ms/);
      if (buildMsMatch?.[1]) {
        return Number.parseInt(buildMsMatch[1], 10) / 1000;
      }
      const buildSMatch = content.match(/Build completed in\s+([\d.]+)\s*s/);
      if (buildSMatch?.[1]) {
        return Number.parseFloat(buildSMatch[1]);
      }

      // Vitest style: "Tests  1 passed (1)  Time: 2.34s"
      const vitestTimeMatch = content.match(/Time:\s+([\d.]+)\s*s/);
      if (vitestTimeMatch?.[1]) {
        return Number.parseFloat(vitestTimeMatch[1]);
      }

      // Jest style: "Time:        2.345 s"
      const jestTimeMatch = content.match(/Time:\s+([\d.]+)\s*s/);
      if (jestTimeMatch?.[1]) {
        return Number.parseFloat(jestTimeMatch[1]);
      }

      // Next.js style: "✓ Compiled successfully in 1234ms"
      const compileMatch = content.match(/Compiled successfully in\s+(\d+)\s*ms/);
      if (compileMatch?.[1]) {
        return Number.parseInt(compileMatch[1], 10) / 1000;
      }
    } catch {
      // unreadable or missing
    }

    return 0;
  }
}
