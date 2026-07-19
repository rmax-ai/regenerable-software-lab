// @rsl/harness-fake — FakeHarness test suite
//
// Tests that each deterministic scenario produces the expected ExecutionResult
// status and that prepare/collectArtifacts round-trips correctly.

import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm, mkdir } from "node:fs/promises";
import { describe, it, expect, afterEach } from "vitest";

import { FakeHarness } from "./FakeHarness.js";
import type { ScenarioId } from "./scenarios.js";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Create a temporary workspace directory and return its path. */
function createTempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "fake-harness-test-"));
}

/** Expected scenario statuses keyed by scenario ID. */
const EXPECTED_STATUSES: Record<ScenarioId, string> = {
  success: "completed",
  buildFailure: "failed",
  timeout: "timeout",
  policyViolation: "policy_terminated",
  falseClaim: "completed",
  budgetExhausted: "budget_exhausted",
  partialImpl: "completed",
  repeatedCommands: "failed",
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("FakeHarness", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    // Clean up all temp dirs created during this test.
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  // ── Scenario tests ──────────────────────────────────────────────────────

  const scenarios: ScenarioId[] = [
    "success",
    "buildFailure",
    "timeout",
    "policyViolation",
    "falseClaim",
    "budgetExhausted",
    "partialImpl",
    "repeatedCommands",
  ];

  for (const scenarioId of scenarios) {
    it(`scenario "${scenarioId}" returns expected status`, async () => {
      const harness = new FakeHarness(scenarioId);
      const ws = createTempWorkspace();
      tempDirs.push(ws);

      // ── prepare ─────────────────────────────────────────────────────────
      const prepared = await harness.prepare({
        runId: `test-${scenarioId}`,
        workspacePath: ws,
        taskPrompt: `Simulate scenario: ${scenarioId}`,
        model: { provider: "fake", model: "fake-model" },
        limits: { wallClockSeconds: 600 },
        environment: {},
      });

      expect(prepared.runId).toBe(`test-${scenarioId}`);
      expect(prepared.workspacePath).toBe(ws);
      expect(prepared.scenario).toBe(scenarioId);

      // Verify that workspace files were actually written.
      const scenarioFiles = (SCENARIO_FILE_COUNTS as Record<string, number>)[scenarioId] ?? 0;
      if (scenarioFiles > 0) {
        // At least the workspace directory should exist.
        expect(existsSync(ws)).toBe(true);
      }

      // ── execute ─────────────────────────────────────────────────────────
      const result = await harness.execute({ runId: `test-${scenarioId}`, preparedRun: prepared });

      expect(result.status).toBe(EXPECTED_STATUSES[scenarioId]);
      expect(typeof result.startedAt).toBe("string");
      expect(typeof result.completedAt).toBe("string");

      // Verify specific result fields per scenario.
      switch (scenarioId) {
        case "success": {
          expect(result.exitCode).toBe(0);
          expect(result.reportedCompletion).toBe(true);
          expect(result.modelUsage).toBeDefined();
          break;
        }
        case "buildFailure": {
          expect(result.exitCode).toBe(1);
          expect(result.reportedCompletion).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error?.code).toBe("BUILD_FAILURE");
          break;
        }
        case "timeout": {
          expect(result.exitCode).toBeUndefined();
          expect(result.reportedCompletion).toBe(false);
          expect(result.error?.code).toBe("HARNESS_TIMEOUT");
          break;
        }
        case "policyViolation": {
          expect(result.exitCode).toBe(137);
          expect(result.reportedCompletion).toBe(false);
          expect(result.error?.code).toBe("PROTECTED_ASSET_MODIFICATION");
          expect(result.status).toBe("policy_terminated");
          break;
        }
        case "falseClaim": {
          expect(result.exitCode).toBe(0);
          expect(result.reportedCompletion).toBe(true);
          break;
        }
        case "budgetExhausted": {
          expect(result.exitCode).toBeUndefined();
          expect(result.reportedCompletion).toBe(false);
          expect(result.error?.code).toBe("RESOURCE_LIMIT_EXCEEDED");
          expect(result.status).toBe("budget_exhausted");
          break;
        }
        case "partialImpl": {
          expect(result.exitCode).toBe(0);
          expect(result.reportedCompletion).toBe(true);
          break;
        }
        case "repeatedCommands": {
          expect(result.exitCode).toBe(1);
          expect(result.reportedCompletion).toBe(false);
          expect(result.error?.code).toBe("REPEATED_UNPRODUCTIVE_LOOP");
          break;
        }
      }

      // ── terminate (no-op) ───────────────────────────────────────────────
      await expect(
        harness.terminate(`test-${scenarioId}`),
      ).resolves.toBeUndefined();

      // ── collectArtifacts ────────────────────────────────────────────────
      const artifacts = await harness.collectArtifacts(`test-${scenarioId}`);

      expect(Array.isArray(artifacts.files)).toBe(true);

      // Verify evidence report presence.
      const scenariosWithEvidence: ScenarioId[] = [
        "success",
        "falseClaim",
        "partialImpl",
      ];

      if (scenariosWithEvidence.includes(scenarioId)) {
        expect(artifacts.evidenceReport).toBeDefined();
        expect(artifacts.evidenceReport!.runId).toBe(`test-${scenarioId}`);
      } else {
        expect(artifacts.evidenceReport).toBeUndefined();
      }
    });
  }

  // ── Env var scenario selection ──────────────────────────────────────────

  it("reads SCENARIO from environment variable when no constructor arg", () => {
    const original = process.env.SCENARIO;
    try {
      process.env.SCENARIO = "timeout";
      const harness = new FakeHarness();
      expect(harness.getScenarioId()).toBe("timeout");
    } finally {
      process.env.SCENARIO = original;
    }
  });

  it("constructor arg overrides SCENARIO env var", () => {
    const original = process.env.SCENARIO;
    try {
      process.env.SCENARIO = "timeout";
      const harness = new FakeHarness("success");
      expect(harness.getScenarioId()).toBe("success");
    } finally {
      process.env.SCENARIO = original;
    }
  });

  it("defaults to success when no env var and no constructor arg", () => {
    const original = process.env.SCENARIO;
    try {
      delete process.env.SCENARIO;
      const harness = new FakeHarness();
      expect(harness.getScenarioId()).toBe("success");
    } finally {
      process.env.SCENARIO = original;
    }
  });

  // ── Workspace file presence ─────────────────────────────────────────────

  it("writes workspace files for success scenario", async () => {
    const harness = new FakeHarness("success");
    const ws = createTempWorkspace();
    tempDirs.push(ws);

    await harness.prepare({
      runId: "test-success-files",
      workspacePath: ws,
      taskPrompt: "test",
      model: { provider: "fake", model: "fake-model" },
      limits: { wallClockSeconds: 600 },
      environment: {},
    });

    expect(existsSync(join(ws, "src/routes/users.ts"))).toBe(true);
    expect(existsSync(join(ws, "src/routes/orders.ts"))).toBe(true);
    expect(existsSync(join(ws, "src/models.ts"))).toBe(true);
    expect(existsSync(join(ws, "src/index.ts"))).toBe(true);
    expect(existsSync(join(ws, "README.md"))).toBe(true);
  });

  it("writes broken TypeScript files for buildFailure scenario", async () => {
    const harness = new FakeHarness("buildFailure");
    const ws = createTempWorkspace();
    tempDirs.push(ws);

    await harness.prepare({
      runId: "test-build-failure-files",
      workspacePath: ws,
      taskPrompt: "test",
      model: { provider: "fake", model: "fake-model" },
      limits: { wallClockSeconds: 600 },
      environment: {},
    });

    const usersContent = readFileSync(join(ws, "src/routes/users.ts"), "utf-8");
    // Should contain the type error
    expect(usersContent).toContain("const count: string = 42");
  });

  it("writes repeated commands log for repeatedCommands scenario", async () => {
    const harness = new FakeHarness("repeatedCommands");
    const ws = createTempWorkspace();
    tempDirs.push(ws);

    await harness.prepare({
      runId: "test-repeated-commands-files",
      workspacePath: ws,
      taskPrompt: "test",
      model: { provider: "fake", model: "fake-model" },
      limits: { wallClockSeconds: 600 },
      environment: {},
    });

    const logContent = readFileSync(join(ws, "repeated-commands.log"), "utf-8");
    const lines = logContent.trim().split("\n");
    expect(lines).toHaveLength(50);
    expect(lines[0]).toBe('echo "invalid-command-0"');
    expect(lines[49]).toBe('echo "invalid-command-49"');
  });

  it("writes policy violation evidence file", async () => {
    const harness = new FakeHarness("policyViolation");
    const ws = createTempWorkspace();
    tempDirs.push(ws);

    await harness.prepare({
      runId: "test-policy-violation-files",
      workspacePath: ws,
      taskPrompt: "test",
      model: { provider: "fake", model: "fake-model" },
      limits: { wallClockSeconds: 600 },
      environment: {},
    });

    expect(existsSync(join(ws, ".policy-violation.log"))).toBe(true);
    const logContent = readFileSync(join(ws, ".policy-violation.log"), "utf-8");
    expect(logContent).toContain("PROTECTED_ASSET_MODIFICATION");
  });

  // ── Multiple run isolation ──────────────────────────────────────────────

  it("isolates artifacts between different runs", async () => {
    const harness = new FakeHarness("success");
    const ws1 = createTempWorkspace();
    const ws2 = createTempWorkspace();
    tempDirs.push(ws1, ws2);

    await harness.prepare({
      runId: "run-a",
      workspacePath: ws1,
      taskPrompt: "test",
      model: { provider: "fake", model: "fake-model" },
      limits: { wallClockSeconds: 600 },
      environment: {},
    });

    await harness.prepare({
      runId: "run-b",
      workspacePath: ws2,
      taskPrompt: "test",
      model: { provider: "fake", model: "fake-model" },
      limits: { wallClockSeconds: 600 },
      environment: {},
    });

    const artifactsA = await harness.collectArtifacts("run-a");
    const artifactsB = await harness.collectArtifacts("run-b");

    expect(artifactsA.evidenceReport?.runId).toBe("run-a");
    expect(artifactsB.evidenceReport?.runId).toBe("run-b");
    expect(artifactsA.evidenceReport?.runId).not.toBe(artifactsB.evidenceReport?.runId);
  });
});

// ── File count lookup for scenario tests ───────────────────────────────────

/** Rough count of files each scenario writes (used to skip dir-only checks). */
const SCENARIO_FILE_COUNTS: Record<string, number> = {
  success: 5,
  buildFailure: 3,
  timeout: 3,
  policyViolation: 3,
  falseClaim: 5,
  budgetExhausted: 3,
  partialImpl: 3,
  repeatedCommands: 2,
};
