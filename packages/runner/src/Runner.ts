// @rsl/runner — Runner class (SPEC.md §15)
//
// The Runner orchestrates the full experiment lifecycle:
//  1. load config, create workspace, copy visible assets, mount protected
//  2. initialize harness, execute agent
//  3. record trace, enforce budgets
//  4. run verification (evaluator pipeline)
//  5. store artifacts, produce final report

import { existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type RunConfiguration,
  type TraceEvent,
  type VerificationResult,
  type AgentHarness,
  type ExecutionResult,
  type ModelUsage,
  type RunLimits,
  type HarnessConfiguration,
  type ModelConfiguration,
} from "@rsl/benchmark-core";
import { Evaluator, PROFILE_A_STAGES } from "@rsl/evaluator";
import { createWorkspace, copyVisibleAssets, mountProtectedAssets } from "./workspace.js";
import {
  checkWallClock,
  checkModelUsage,
  checkDiskUsage,
  type BudgetCheck,
} from "./budget.js";

// ── Run Result ──────────────────────────────────────────────────────────

export interface RunResult {
  runId: string;
  status: "completed" | "failed" | "budget_exhausted" | "error";
  startedAt: string;
  completedAt: string;
  workspacePath: string;
  verificationResults: VerificationResult[];
  executionResult?: ExecutionResult;
  tracePath: string;
  artifactsPath: string;
  error?: string;
  metrics: RunMetrics;
}

export interface RunMetrics {
  wallClockSeconds: number;
  executionDurationMs?: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  verificationPassed: boolean;
  verificationStages: number;
  verificationPassedStages: number;
  verificationFailedStages: number;
  budgetChecks: BudgetCheck[];
}

// ── Runner ──────────────────────────────────────────────────────────────

export class Runner {
  private readonly traceEvents: TraceEvent[] = [];
  private sequence = 0;

  // ── Core Entry Point ────────────────────────────────────────────────

  /**
   * Execute a full experiment run from configuration.
   *
   * @param config - Complete run configuration including benchmark ID,
   *                 harness config, model config, and limits.
   * @param harness - An AgentHarness implementation to dispatch execution.
   * @returns A RunResult containing all results, metrics, and artifacts.
   */
  async run(
    config: RunConfiguration,
    harness: AgentHarness,
  ): Promise<RunResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    // ── Phase 1: Workspace Setup ─────────────────────────────────────
    const workspacePath = this.prepareWorkspace(
      config.runId,
      config.benchmarkVersion,
    );

    this.recordEvent({
      timestamp: new Date().toISOString(),
      runId: config.runId,
      sequence: this.nextSeq(),
      source: "runner",
      type: "workspace_created",
      payload: { workspacePath },
    });

    // ── Phase 2: Agent Execution ─────────────────────────────────────
    let executionResult: ExecutionResult | undefined;

    try {
      executionResult = await this.executeAgent(
        config.runId,
        harness,
        workspacePath,
      );
    } catch (err: unknown) {
      executionResult = {
        status: "failed",
        startedAt,
        completedAt: new Date().toISOString(),
        exitCode: 1,
        reportedCompletion: false,
        error: {
          code: "EXECUTION_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }

    this.recordEvent({
      timestamp: new Date().toISOString(),
      runId: config.runId,
      sequence: this.nextSeq(),
      source: "runner",
      type: "execution_completed",
      payload: { status: executionResult.status },
    });

    // ── Phase 3: Budget Enforcement ──────────────────────────────────
    const budgetChecks = this.enforceBudgets(
      config.runId,
      config.limits,
      startTime,
      executionResult.modelUsage,
      workspacePath,
    );

    const budgetExceeded = budgetChecks.some((c) => c.exceeded);
    if (budgetExceeded) {
      this.recordEvent({
        timestamp: new Date().toISOString(),
        runId: config.runId,
        sequence: this.nextSeq(),
        source: "runner",
        type: "budget_exceeded",
        payload: { checks: budgetChecks },
      });
    }

    // ── Phase 4: Verification ────────────────────────────────────────
    let verificationResults: VerificationResult[] = [];

    if (!budgetExceeded || config.limits.maxVerificationAttempts !== 0) {
      try {
        verificationResults = await this.runVerification(
          config.runId,
          workspacePath,
        );
      } catch (err: unknown) {
        verificationResults = [
          {
            stage: "runner",
            status: "error",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            metrics: {
              error: err instanceof Error ? err.message : String(err),
            },
            artifacts: [],
            failureCategory: "EVALUATOR_ERROR",
          },
        ];
      }
    }

    this.recordEvent({
      timestamp: new Date().toISOString(),
      runId: config.runId,
      sequence: this.nextSeq(),
      source: "runner",
      type: "verification_completed",
      payload: {
        stages: verificationResults.length,
        passed: verificationResults.filter((r) => r.status === "passed").length,
      },
    });

    // ── Phase 5: Finalize ────────────────────────────────────────────
    const completedAt = new Date().toISOString();
    const result = this.finalize(
      config.runId,
      workspacePath,
      {
        startedAt,
        completedAt,
        workspacePath,
        verificationResults,
        executionResult,
        metrics: this.computeMetrics(
          startTime,
          executionResult,
          verificationResults,
          budgetChecks,
        ),
        status: budgetExceeded
          ? "budget_exhausted"
          : executionResult?.status === "completed"
            ? "completed"
            : "failed",
      },
    );

    return result;
  }

  // ── Phase Methods ──────────────────────────────────────────────────

  /**
   * Prepare the workspace for a run.
   *
   * Creates the workspace directory, copies visible benchmark assets,
   * and mounts protected paths.
   *
   * @param runId - Unique run identifier.
   * @param benchmarkId - The benchmark to pull assets from.
   * @returns Absolute path to the prepared workspace.
   */
  prepareWorkspace(runId: string, benchmarkId: string): string {
    const workspacePath = createWorkspace(runId);

    copyVisibleAssets(benchmarkId, workspacePath);
    mountProtectedAssets(benchmarkId, workspacePath);

    // Write a .rsl-run metadata file
    const meta = {
      runId,
      benchmarkId,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(
      join(workspacePath, ".rsl-run.json"),
      JSON.stringify(meta, null, 2),
    );

    return workspacePath;
  }

  /**
   * Execute the agent via the harness adapter.
   *
   * Calls harness.prepare() with workspace and task configuration, then
   * harness.execute() to run the agent.
   *
   * @param runId - Unique run identifier.
   * @param harness - The AgentHarness implementation.
   * @param workspacePath - Absolute path to the prepared workspace.
   * @returns The execution result from the harness.
   */
  async executeAgent(
    runId: string,
    harness: AgentHarness,
    workspacePath: string,
  ): Promise<ExecutionResult> {
    this.recordEvent({
      timestamp: new Date().toISOString(),
      runId,
      sequence: this.nextSeq(),
      source: "runner",
      type: "harness_prepare",
      payload: { harnessId: harness.id, harnessVersion: harness.version },
    });

    // Prepare the run through the harness (creates task prompt, etc.)
    const preparedRun = await harness.prepare({
      runId,
      workspacePath,
      taskPrompt: "", // populated by harness based on benchmark config
      model: {} as ModelConfiguration, // populated from config by caller
      limits: {} as RunLimits,
      environment: process.env as Record<string, string>,
    });

    this.recordEvent({
      timestamp: new Date().toISOString(),
      runId,
      sequence: this.nextSeq(),
      source: "runner",
      type: "harness_execute",
      payload: { harnessId: harness.id },
    });

    // Execute the agent
    const result = await harness.execute({
      runId,
      preparedRun,
    });

    return result;
  }

  /**
   * Record a trace event to the in-memory buffer.
   *
   * Events are flushed to trace.jsonl in the finalize step.
   *
   * @param event - The trace event to record.
   */
  recordTrace(event: TraceEvent): void {
    this.traceEvents.push(event);

    // Also write immediately to the trace file if we know the workspace path.
    // This is handled in finalize() for atomicity, but we keep events ordered.
  }

  /**
   * Enforce run budgets against wall-clock, model usage, and disk limits.
   *
   * @param runId - Unique run identifier.
   * @param limits - The configured run limits.
   * @param startTime - Timestamp when the run started.
   * @param modelUsage - Model usage from the execution result (may be undefined).
   * @param workspacePath - Path to the run workspace.
   * @returns Array of budget checks, one per checked dimension.
   */
  enforceBudgets(
    runId: string,
    limits: RunLimits,
    startTime: number,
    modelUsage?: ModelUsage,
    workspacePath?: string,
  ): BudgetCheck[] {
    const checks: BudgetCheck[] = [];

    // Wall clock
    checks.push(checkWallClock(startTime, limits.wallClockSeconds));

    // Model usage
    if (modelUsage) {
      checks.push(checkModelUsage(modelUsage, limits));
    }

    // Disk usage
    if (
      limits.maxDiskMb !== undefined &&
      workspacePath &&
      existsSync(workspacePath)
    ) {
      checks.push(checkDiskUsage(workspacePath, limits.maxDiskMb));
    }

    // Log the budget checks
    for (const check of checks) {
      if (check.exceeded) {
        this.recordEvent({
          timestamp: new Date().toISOString(),
          runId,
          sequence: this.nextSeq(),
          source: "runner",
          type: "budget_check_failed",
          payload: {
            metric: check.metric,
            limit: check.limit,
            actual: check.actual,
            reason: check.reason,
          },
        });
      }
    }

    return checks;
  }

  /**
   * Run the evaluator verification pipeline against the agent workspace.
   *
   * Uses the Evaluator class from @rsl/evaluator with Profile A stages
   * (Install, Build, Lint, Typecheck, Public Tests, Contract Validation).
   *
   * @param runId - Unique run identifier.
   * @param workspacePath - Path to the workspace containing the source/ dir.
   * @returns Array of verification results, one per stage.
   */
  async runVerification(
    runId: string,
    workspacePath: string,
  ): Promise<VerificationResult[]> {
    // Verification runs against the source/ subdirectory where the agent
    // placed its implementation.
    const sourceDir = join(workspacePath, "source");

    if (!existsSync(sourceDir)) {
      this.recordEvent({
        timestamp: new Date().toISOString(),
        runId,
        sequence: this.nextSeq(),
        source: "runner",
        type: "verification_skipped",
        payload: { reason: "source directory does not exist", sourceDir },
      });
      return [];
    }

    this.recordEvent({
      timestamp: new Date().toISOString(),
      runId,
      sequence: this.nextSeq(),
      source: "runner",
      type: "verification_started",
      payload: { workspacePath },
    });

    const evaluator = new Evaluator(sourceDir);
    const results = await evaluator.evaluate(PROFILE_A_STAGES);

    return results;
  }

  /**
   * Finalize the run: write trace file, compute metrics, produce report.
   *
   * @param runId - Unique run identifier.
   * @param workspacePath - Absolute path to the run workspace.
   * @param partial - Partial run result accumulated so far.
   * @returns The complete RunResult.
   */
  finalize(
    runId: string,
    workspacePath: string,
    partial: Omit<RunResult, "tracePath" | "artifactsPath" | "runId"> & {
      runId?: string;
    },
  ): RunResult {
    // ── Flush trace ─────────────────────────────────────────────
    const traceDir = join(workspacePath, "trace");
    if (!existsSync(traceDir)) {
      mkdirSync(traceDir, { recursive: true });
    }

    const tracePath = join(traceDir, "trace.jsonl");
    const traceLines = this.traceEvents
      .map((evt) => JSON.stringify(evt))
      .join("\n");
    writeFileSync(tracePath, traceLines + "\n");

    // ── Write summary report ────────────────────────────────────
    const artifactsPath = join(workspacePath, "artifacts");
    if (!existsSync(artifactsPath)) {
      mkdirSync(artifactsPath, { recursive: true });
    }

    const report = {
      runId,
      status: partial.status,
      startedAt: partial.startedAt,
      completedAt: partial.completedAt,
      metrics: partial.metrics,
      verificationResults: partial.verificationResults.map((vr) => ({
        stage: vr.stage,
        status: vr.status,
        failureCategory: vr.failureCategory,
      })),
      executionStatus: partial.executionResult?.status,
    };

    const reportPath = join(artifactsPath, "run-report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2));

    this.recordEvent({
      timestamp: new Date().toISOString(),
      runId,
      sequence: this.nextSeq(),
      source: "runner",
      type: "run_finalized",
      payload: { tracePath, reportPath, status: partial.status },
    });

    // ── Flush final trace event ─────────────────────────────────
    const finalTrace = this.traceEvents
      .map((evt) => JSON.stringify(evt))
      .join("\n");
    writeFileSync(tracePath, finalTrace + "\n");

    return {
      runId,
      status: partial.status,
      startedAt: partial.startedAt,
      completedAt: partial.completedAt,
      workspacePath,
      verificationResults: partial.verificationResults,
      executionResult: partial.executionResult,
      tracePath,
      artifactsPath,
      error: partial.error,
      metrics: partial.metrics,
    };
  }

  // ── Internal Helpers ───────────────────────────────────────────────

  /** Convenience wrapper: record a trace event via both buffer and recordTrace. */
  private recordEvent(event: TraceEvent): void {
    this.recordTrace(event);
  }

  /** Get the next sequence number for a trace event. */
  private nextSeq(): number {
    return ++this.sequence;
  }

  /**
   * Compute run metrics from execution data and verification results.
   */
  private computeMetrics(
    startTime: number,
    executionResult?: ExecutionResult,
    verificationResults?: VerificationResult[],
    budgetChecks?: BudgetCheck[],
  ): RunMetrics {
    const wallClockSeconds = (Date.now() - startTime) / 1000;
    const usage = executionResult?.modelUsage;

    const verified = verificationResults ?? [];
    const passed = verified.filter((r) => r.status === "passed").length;
    const failed = verified.filter(
      (r) => r.status === "failed" || r.status === "error",
    ).length;

    return {
      wallClockSeconds,
      executionDurationMs: executionResult
        ? (new Date(executionResult.completedAt).getTime() -
            new Date(executionResult.startedAt).getTime())
        : undefined,
      modelCalls: usage?.modelCalls ?? 0,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      estimatedCostUsd: usage?.estimatedCostUsd ?? 0,
      verificationPassed: failed === 0 && verified.length > 0,
      verificationStages: verified.length,
      verificationPassedStages: passed,
      verificationFailedStages: failed,
      budgetChecks: budgetChecks ?? [],
    };
  }
}
