// @rsl/harness-fake — FakeHarness implementation
//
// Deterministic fake harness implementing the AgentHarness interface.
// No real model calls or process execution — all results are driven by
// the selected scenario definition.
//
// The scenario is selected via:
//   1. Constructor argument (highest priority)
//   2. SCENARIO environment variable
//   3. Default: "success"
//
// During prepare(), the harness writes deterministic files to the workspace
// that correspond to the selected scenario's simulated outcome.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type {
  AgentHarness,
  PrepareInput,
  PreparedRun,
  ExecuteInput,
  ExecutionResult,
  HarnessArtifacts,
  EvidenceReport,
} from "@rsl/benchmark-core";
import { SCENARIOS, type ScenarioId, type ScenarioDefinition } from "./scenarios.js";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Resolve the scenario ID: constructor arg > env var > default. */
function resolveScenarioId(override?: ScenarioId): ScenarioId {
  if (override) return override;
  const env = process.env.SCENARIO;
  if (env && env in SCENARIOS) return env as ScenarioId;
  return "success";
}

/** Ensure a directory exists and write a file with deterministic content. */
async function writeWorkspaceFile(
  workspacePath: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = resolve(join(workspacePath, relativePath));
  await mkdir(new URL(".", new URL(`file://${fullPath}`)).pathname, { recursive: true });
  await writeFile(fullPath, content, "utf-8");
}

/** Write multiple workspace files from a record of path -> content. */
async function writeFiles(
  workspacePath: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    await writeWorkspaceFile(workspacePath, relativePath, content);
  }
}

// ── Scenario workspace content generators ─────────────────────────────────

function successFiles(): Record<string, string> {
  return {
    "src/routes/users.ts": [
      'import { Router } from "express";',
      "",
      "const router = Router();",
      "",
      "router.get(\"/\", (_, res) => res.json([]));",
      'router.post("/", (req, res) => res.status(201).json(req.body));',
      'router.get("/:id", (req, res) => res.json({ id: req.params.id }));',
      'router.put("/:id", (req, res) => res.json(req.body));',
      'router.delete("/:id", (_, res) => res.status(204).send());',
      "",
      "export default router;",
    ].join("\n"),
    "src/routes/orders.ts": [
      'import { Router } from "express";',
      "",
      "const router = Router();",
      "",
      "router.get(\"/\", (_, res) => res.json([]));",
      'router.post("/", (req, res) => res.status(201).json(req.body));',
      'router.get("/:id", (req, res) => res.json({ id: req.params.id }));',
      "",
      "export default router;",
    ].join("\n"),
    "src/models.ts": `export interface User {\n  id: string;\n  name: string;\n  email: string;\n}\n\nexport interface Order {\n  id: string;\n  userId: string;\n  total: number;\n  status: "pending" | "shipped" | "delivered";\n}\n`,
    "src/index.ts": [
      'import express from "express";',
      'import usersRouter from "./routes/users.js";',
      'import ordersRouter from "./routes/orders.js";',
      "",
      "const app = express();",
      'app.use("/users", usersRouter);',
      'app.use("/orders", ordersRouter);',
      "export default app;",
    ].join("\n"),
    "README.md": "# Implementation\n\nFull implementation of all routes.\n",
  };
}

function buildFailureFiles(): Record<string, string> {
  return {
    "src/routes/users.ts": [
      'import { Router } from "express";',
      "",
      "const router = Router();",
      "",
      'router.get("/", (_, res) => {',
      "  const count: string = 42;", // deliberate type error
      "  res.json([]);",
      "});",
      "",
      "export default router;",
    ].join("\n"),
    "src/routes/orders.ts": [
      'import { Router } from "express";',
      "",
      "const router = Router();",
      "// TODO: implement order routes",
      "export default router;",
    ].join("\n"),
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }, null, 2) + "\n",
  };
}

function timeoutFiles(): Record<string, string> {
  return {
    "src/routes/users.ts": "// partial implementation — timed out before completion\n",
    "src/routes/orders.ts": "// not implemented\n",
    "src/partial.ts": "// work in progress\n",
  };
}

function policyViolationFiles(): Record<string, string> {
  // Simulate files for a normal workspace, plus evidence of the violation.
  return {
    "src/routes/users.ts": "// file created before policy violation\n",
    "src/routes/orders.ts": "// file created before policy violation\n",
    ".policy-violation.log": `[${new Date().toISOString()}] AGENT_ACTION: write /spec/SPEC.md -- DENIED by policy guard (PROTECTED_ASSET_MODIFICATION)\n`,
  };
}

function falseClaimFiles(): Record<string, string> {
  return {
    "src/routes/users.ts": [
      'import { Router } from "express";',
      "",
      "const router = Router();",
      "",
      "router.get(\"/\", (_, res) => res.json([]));",
      "export default router;",
    ].join("\n"),
    "README.md": "# Implementation\n\nAll tests passing.\n",
    "test-results/unit-tests.log": "PASS: 42 tests passed, 0 failed\n",
    "test-results/integration-tests.log": "PASS: 18 tests passed, 0 failed\n",
    "test-results/e2e-tests.log": "PASS: 5 tests passed, 0 failed\n",
  };
}

function budgetExhaustedFiles(): Record<string, string> {
  return {
    "src/routes/users.ts": [
      'import { Router } from "express";',
      "",
      "const router = Router();",
      "",
      "router.get(\"/\", (_, res) => res.json([]));",
      'router.post("/", (req, res) => res.status(201).json(req.body));',
      "export default router;",
    ].join("\n"),
    "src/routes/orders.ts": "// not yet implemented\n",
    "src/models.ts": "// TODO: add models\n",
  };
}

function partialImplFiles(): Record<string, string> {
  return {
    "src/routes/users.ts": [
      'import { Router } from "express";',
      "",
      "const router = Router();",
      "",
      "router.get(\"/\", (_, res) => res.json([]));",
      'router.post("/", (req, res) => res.status(201).json(req.body));',
      'router.get("/:id", (req, res) => res.json({ id: req.params.id }));',
      "",
      "export default router;",
    ].join("\n"),
    "src/models.ts": `export interface User {\n  id: string;\n  name: string;\n  email: string;\n}\n`,
    "README.md": "# Implementation\n\nUser routes implemented. Order routes not started.\n",
  };
}

function repeatedCommandsFiles(): Record<string, string> {
  const commands: string[] = [];
  for (let i = 0; i < 50; i++) {
    commands.push(`echo "invalid-command-${i}"`);
  }
  return {
    "repeated-commands.log": commands.join("\n") + "\n",
    "src/routes/users.ts": "// started but never finished\n",
  };
}

/** Map scenario IDs to their workspace content generators. */
const SCENARIO_FILE_GENERATORS: Record<
  ScenarioId,
  (() => Record<string, string>) | undefined
> = {
  success: successFiles,
  buildFailure: buildFailureFiles,
  timeout: timeoutFiles,
  policyViolation: policyViolationFiles,
  falseClaim: falseClaimFiles,
  budgetExhausted: budgetExhaustedFiles,
  partialImpl: partialImplFiles,
  repeatedCommands: repeatedCommandsFiles,
};

// ── FakeHarness ─────────────────────────────────────────────────────────────

export class FakeHarness implements AgentHarness {
  readonly id = "fake";
  readonly version = "0.1.0";

  private readonly scenarioId: ScenarioId;
  private readonly scenario: ScenarioDefinition;
  private readonly workspaceFiles: Map<string, string[]> = new Map();
  private readonly evidenceReports: Map<string, EvidenceReport | undefined> = new Map();

  /**
   * @param scenarioId  Which deterministic scenario to simulate.
   *                    Falls back to SCENARIO env var, then "success".
   */
  constructor(scenarioId?: ScenarioId) {
    this.scenarioId = resolveScenarioId(scenarioId);
    this.scenario = SCENARIOS[this.scenarioId];
  }

  /** Return the resolved scenario ID (useful for tests). */
  getScenarioId(): ScenarioId {
    return this.scenarioId;
  }

  // ── prepare ──────────────────────────────────────────────────────────────

  async prepare(input: PrepareInput): Promise<PreparedRun> {
    const preparedRun: PreparedRun = {
      runId: input.runId,
      workspacePath: input.workspacePath,
      scenario: this.scenarioId,
    };

    // Write deterministic workspace files for this scenario.
    const generator = SCENARIO_FILE_GENERATORS[this.scenarioId];
    if (generator) {
      await writeFiles(input.workspacePath, generator());
    }

    // Store the scenario's listed workspace files for collectArtifacts.
    this.workspaceFiles.set(input.runId, this.scenario.workspaceFiles ?? []);

    // Populate evidence report with the correct runId.
    if (this.scenario.evidenceReport) {
      this.evidenceReports.set(input.runId, {
        ...this.scenario.evidenceReport,
        runId: input.runId,
      });
    } else {
      this.evidenceReports.set(input.runId, undefined);
    }

    return preparedRun;
  }

  // ── execute ──────────────────────────────────────────────────────────────

  async execute(_input: ExecuteInput): Promise<ExecutionResult> {
    // Return the scenario's deterministic result.
    return this.scenario.result;
  }

  // ── terminate ────────────────────────────────────────────────────────────

  async terminate(_runId: string): Promise<void> {
    // No-op: the fake harness does not run real processes.
  }

  // ── collectArtifacts ─────────────────────────────────────────────────────

  async collectArtifacts(runId: string): Promise<HarnessArtifacts> {
    const files = this.workspaceFiles.get(runId) ?? [];
    const evidenceReport = this.evidenceReports.get(runId);

    const artifacts: HarnessArtifacts = {
      files,
    };

    if (evidenceReport) {
      artifacts.evidenceReport = evidenceReport;
    }

    return artifacts;
  }
}
