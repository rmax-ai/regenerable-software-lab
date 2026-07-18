// @rsl/harness-fake — FakeHarness implementation
//
// Deterministic fake harness implementing the AgentHarness interface.
// No real model calls or process execution — all results are driven by
// the selected scenario definition.

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

// ── FakeHarness ─────────────────────────────────────────────────────────────

export class FakeHarness implements AgentHarness {
  readonly id = "fake";
  readonly version = "0.1.0";

  private readonly scenarioId: ScenarioId;
  private readonly scenario: ScenarioDefinition;
  private readonly workspaceFiles: Map<string, string[]> = new Map();
  private readonly evidenceReports: Map<string, EvidenceReport | undefined> = new Map();

  /**
   * @param scenarioId  Which deterministic scenario to simulate (default: "success").
   */
  constructor(scenarioId: ScenarioId = "success") {
    this.scenarioId = scenarioId;
    this.scenario = SCENARIOS[scenarioId];
  }

  // ── prepare ────────────────────────────────────────────────────────────────

  async prepare(input: PrepareInput): Promise<PreparedRun> {
    const preparedRun: PreparedRun = {
      runId: input.runId,
      workspacePath: input.workspacePath,
      scenario: this.scenarioId,
    };

    // Store the scenario's workspace files keyed by runId so collectArtifacts
    // can return them later.
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

  // ── execute ────────────────────────────────────────────────────────────────

  async execute(input: ExecuteInput): Promise<ExecutionResult> {
    // Return the scenario's deterministic result.
    return this.scenario.result;
  }

  // ── terminate ──────────────────────────────────────────────────────────────

  async terminate(_runId: string): Promise<void> {
    // No-op: the fake harness does not run real processes.
  }

  // ── collectArtifacts ───────────────────────────────────────────────────────

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
