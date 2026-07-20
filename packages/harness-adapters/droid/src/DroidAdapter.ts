// @rsl/harness-droid — DroidAdapter
//
// Implements the AgentHarness interface by wrapping the Factory Droid CLI.
// Spawns `droid exec --auto high --output-format json -f <prompt-file>` as
// a child process. Requires FACTORY_API_KEY in the environment.
//
// See SPEC.md §13.4 for adapter requirements.

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  AgentHarness,
  PrepareInput,
  PreparedRun,
  ExecuteInput,
  ExecutionResult,
  HarnessArtifacts,
  EvidenceReport,
  TraceEvent,
  NormalizedError,
} from "@rsl/benchmark-core";

// ── Constants ──────────────────────────────────────────────────────────

const TASK_FILE = "TASK.md";
const DROID_BINARY = "droid";

// ── Configuration ──────────────────────────────────────────────────────

export interface DroidAdapterOptions {
  /** Path to the droid binary (default: "droid"). */
  droidBinary?: string;
  /** Autonomy level: "low" | "medium" | "high" (default: "high"). */
  autonomyLevel?: "low" | "medium" | "high";
  /** Model override passed via --model flag. */
  modelOverride?: string;
  /** API key for Factory (falls back to FACTORY_API_KEY env var). */
  apiKey?: string;
}

// ── DroidAdapter ───────────────────────────────────────────────────────

export class DroidAdapter implements AgentHarness {
  readonly id = "droid";
  readonly version = "0.1.0";

  private readonly droidBinary: string;
  private readonly autonomyLevel: "low" | "medium" | "high";
  private readonly modelOverride?: string;
  private readonly apiKey?: string;

  /** Map of runId -> child process for termination. */
  private readonly processes: Map<string, ChildProcess> = new Map();

  /** Map of runId -> accumulated stdout buffer. */
  private readonly stdoutBuffers: Map<string, string> = new Map();

  /** Map of runId -> accumulated stderr buffer. */
  private readonly stderrBuffers: Map<string, string> = new Map();

  /** Map of runId -> prepared run info. */
  private readonly preparedRuns: Map<string, PreparedRun> = new Map();

  /** Map of runId -> trace events. */
  private readonly traceEventsMap: Map<string, TraceEvent[]> = new Map();

  /** Sequence counter for trace events. */
  private seqCounter = 0;

  constructor(options: DroidAdapterOptions = {}) {
    this.droidBinary = options.droidBinary ?? DROID_BINARY;
    this.autonomyLevel = options.autonomyLevel ?? "high";
    this.modelOverride = options.modelOverride;
    this.apiKey = options.apiKey ?? process.env.FACTORY_API_KEY;

    if (!this.apiKey) {
      console.warn(
        "rsl: DroidAdapter initialized without FACTORY_API_KEY. " +
          "Set FACTORY_API_KEY env var or pass apiKey option.",
      );
    }
  }

  // ── prepare ──────────────────────────────────────────────────────────

  async prepare(input: PrepareInput): Promise<PreparedRun> {
    const { runId, workspacePath, taskPrompt, model, limits } = input;

    await fs.mkdir(workspacePath, { recursive: true });

    // Write task prompt to workspace/TASK.md (what agent sees in source/).
    const sourceDir = path.join(workspacePath, "source");
    await fs.mkdir(sourceDir, { recursive: true });
    const taskPath = path.join(sourceDir, TASK_FILE);
    await fs.writeFile(taskPath, taskPrompt, "utf-8");

    this.emitTraceEvent(runId, "harness", "file_written", {
      path: taskPath,
      size: taskPrompt.length,
      mimeType: "text/markdown",
    });

    // Build environment for the droid process.
    const env: Record<string, string> = { ...input.environment };

    if (this.apiKey) {
      env.FACTORY_API_KEY = this.apiKey;
    }

    // Pass run metadata as env vars for the agent to reference.
    env.RSL_RUN_ID = runId;
    env.RSL_WORKSPACE_PATH = sourceDir;
    env.RSL_TASK_PATH = taskPath;
    env.RSL_MODEL_PROVIDER = model.provider;
    env.RSL_MODEL_NAME = model.model;
    env.RSL_LIMIT_WALL_CLOCK_SECONDS = String(limits.wallClockSeconds);

    if (model.temperature !== undefined) {
      env.RSL_MODEL_TEMPERATURE = String(model.temperature);
    }
    if (model.maxOutputTokens !== undefined) {
      env.RSL_MODEL_MAX_OUTPUT_TOKENS = String(model.maxOutputTokens);
    }

    const preparedRun: PreparedRun = {
      runId,
      workspacePath,
      environment: env,
      taskPath,
    };

    this.preparedRuns.set(runId, preparedRun);
    return preparedRun;
  }

  // ── execute ──────────────────────────────────────────────────────────

  async execute(input: ExecuteInput): Promise<ExecutionResult> {
    const { runId, preparedRun } = input;
    const workspacePath = preparedRun.workspacePath;
    const sourceDir = path.join(workspacePath, "source");
    const taskPath = path.join(sourceDir, TASK_FILE);
    const startedAt = new Date().toISOString();

    // Verify task file exists.
    let promptExists = false;
    try {
      await fs.access(taskPath);
      promptExists = true;
    } catch {
      // Task file missing — agent will run without prompt.
    }

    if (!promptExists) {
      return {
        status: "failed",
        startedAt,
        completedAt: new Date().toISOString(),
        reportedCompletion: false,
        error: {
          code: "TOOL_EXECUTION_ERROR",
          message: `Task prompt file not found: ${taskPath}`,
        },
      };
    }

    // Build the droid exec command.
    const args: string[] = [
      "exec",
      "--auto",
      this.autonomyLevel,
      "--output-format",
      "json",
      "--cwd",
      sourceDir,
      "-f",
      taskPath,
    ];

    // Model selection.
    const modelArg = this.modelOverride ?? this.detectModelArg();
    if (modelArg) {
      args.push("--model", modelArg);
    }

    // Initialize buffers.
    this.stdoutBuffers.set(runId, "");
    this.stderrBuffers.set(runId, "");

    this.emitTraceEvent(runId, "shell", "command_start", {
      command: `${this.droidBinary} exec`,
      args,
      cwd: sourceDir,
    });

    // Spawn droid process.
    // unset VIRTUAL_ENV to prevent Hermes venv leak (droid skill pitfall).
    const childEnv = {
      ...process.env,
      ...(preparedRun.environment as Record<string, string> ?? {}),
    } as Record<string, string | undefined>;
    delete childEnv.VIRTUAL_ENV;

    const child = spawn(this.droidBinary, args, {
      cwd: sourceDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv,
    });

    this.processes.set(runId, child);

    // Collect stdout.
    child.stdout!.on("data", (chunk: Buffer) => {
      const existing = this.stdoutBuffers.get(runId) ?? "";
      this.stdoutBuffers.set(runId, existing + chunk.toString("utf-8"));
    });

    // Collect stderr.
    child.stderr!.on("data", (chunk: Buffer) => {
      const existing = this.stderrBuffers.get(runId) ?? "";
      this.stderrBuffers.set(runId, existing + chunk.toString("utf-8"));
    });

    return new Promise<ExecutionResult>((resolve) => {
      child.on("close", (exitCode) => {
        this.processes.delete(runId);

        const completedAt = new Date().toISOString();
        const stdout = this.stdoutBuffers.get(runId) ?? "";
        const stderr = this.stderrBuffers.get(runId) ?? "";

        this.emitTraceEvent(runId, "shell", "command_exit", {
          exitCode: exitCode ?? null,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        });

        // Parse droid output.
        const parsed = parseDroidOutput(stdout, stderr);

        // Determine status.
        let status: ExecutionResult["status"] = "completed";
        if (exitCode !== 0 && exitCode !== null) {
          status = "failed";
        } else if (parsed.error) {
          status = "failed";
        }

        // Build model usage from parsed output.
        const modelUsage = parsed.modelUsage
          ? {
              modelCalls: parsed.modelUsage.modelCalls,
              inputTokens: parsed.modelUsage.inputTokens,
              outputTokens: parsed.modelUsage.outputTokens,
              estimatedCostUsd: parsed.modelUsage.estimatedCostUsd,
            }
          : undefined;

        const normalizedError = parsed.error
          ? this.normalizeDroidError(parsed.error)
          : undefined;

        const result: ExecutionResult = {
          status,
          startedAt,
          completedAt,
          exitCode: exitCode ?? undefined,
          reportedCompletion: exitCode === 0 && !parsed.error,
          modelUsage,
        };

        if (normalizedError) {
          result.error = normalizedError;
        }

        resolve(result);
      });

      child.on("error", (err) => {
        this.processes.delete(runId);

        const completedAt = new Date().toISOString();
        resolve({
          status: "failed",
          startedAt,
          completedAt,
          reportedCompletion: false,
          error: {
            code: "HARNESS_CRASH",
            message: `Failed to spawn droid process: ${err.message}`,
          },
        });
      });
    });
  }

  // ── terminate ────────────────────────────────────────────────────────

  async terminate(runId: string): Promise<void> {
    const child = this.processes.get(runId);
    if (!child) return;

    this.emitTraceEvent(runId, "harness", "terminate", {
      signal: "SIGTERM",
    });

    child.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already dead.
        }
        resolve();
      }, 5_000);

      child.on("close", () => {
        clearTimeout(timeout);
        this.processes.delete(runId);
        resolve();
      });
    });
  }

  // ── collectArtifacts ─────────────────────────────────────────────────

  async collectArtifacts(runId: string): Promise<HarnessArtifacts> {
    const preparedRun = this.preparedRuns.get(runId);

    let files: string[] = [];
    if (preparedRun?.workspacePath) {
      files = await this.collectWorkspaceFiles(preparedRun.workspacePath);
    }

    let evidenceReport: EvidenceReport | undefined;
    if (preparedRun?.workspacePath) {
      evidenceReport = await this.parseEvidenceReport(
        preparedRun.workspacePath,
        runId,
      );
    }

    const artifacts: HarnessArtifacts & { traceEvents?: TraceEvent[] } = {
      files,
    };

    if (evidenceReport) {
      artifacts.evidenceReport = evidenceReport;
    }

    const traceEvents = this.traceEventsMap.get(runId);
    if (traceEvents) {
      artifacts.traceEvents = traceEvents;
    }

    return artifacts;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /** Detect model from prepared run environment or constructor option. */
  private detectModelArg(): string | undefined {
    if (this.modelOverride) return this.modelOverride;
    // Try reading model from any stored prepared run's environment.
    for (const prepared of this.preparedRuns.values()) {
      const env = prepared.environment as Record<string, string> | undefined;
      if (env?.RSL_MODEL_NAME) return env.RSL_MODEL_NAME;
    }
    return undefined;
  }

  /** Normalize Droid-specific error codes. */
  private normalizeDroidError(
    error: { code: string; message: string },
  ): NormalizedError {
    const droidToRsl: Record<string, string> = {
      "auth_error": "MODEL_CONFIGURATION_ERROR",
      "api_key_missing": "MODEL_CONFIGURATION_ERROR",
      "rate_limit": "RESOURCE_LIMIT_EXCEEDED",
      "timeout": "HARNESS_TIMEOUT",
      "context_length": "CONTEXT_LOSS",
      "model_error": "MODEL_CONFIGURATION_ERROR",
      "tool_error": "TOOL_EXECUTION_ERROR",
      "budget_exceeded": "RESOURCE_LIMIT_EXCEEDED",
    };

    const mappedCode = droidToRsl[error.code] ?? "TOOL_EXECUTION_ERROR";
    return {
      code: mappedCode,
      message: error.message,
      category: mappedCode,
    };
  }

  /** Emit a trace event. */
  private emitTraceEvent(
    runId: string,
    source: TraceEvent["source"],
    type: string,
    payload: Record<string, unknown>,
  ): void {
    const event: TraceEvent = {
      timestamp: new Date().toISOString(),
      runId,
      sequence: this.seqCounter++,
      source,
      type,
      payload,
    };
    const buffer = this.traceEventsMap.get(runId) ?? [];
    buffer.push(event);
    this.traceEventsMap.set(runId, buffer);
  }

  /** Recursively collect workspace files. */
  private async collectWorkspaceFiles(
    workspacePath: string,
  ): Promise<string[]> {
    const results: string[] = [];
    try {
      await this.collectFilesRecursive(workspacePath, workspacePath, results);
    } catch {
      // Workspace may not exist.
    }
    return results;
  }

  private async collectFilesRecursive(
    dirPath: string,
    rootPath: string,
    results: string[],
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (
        entry.name === ".factory" ||
        entry.name === "node_modules" ||
        entry.name === ".git"
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.collectFilesRecursive(fullPath, rootPath, results);
      } else if (entry.isFile()) {
        results.push(path.relative(rootPath, fullPath));
      }
    }
  }

  /** Try to parse an evidence report. */
  private async parseEvidenceReport(
    workspacePath: string,
    runId: string,
  ): Promise<EvidenceReport | undefined> {
    const candidates = [
      path.join(workspacePath, "evidence.json"),
      path.join(workspacePath, "source", "evidence-report.json"),
    ];

    for (const candidatePath of candidates) {
      try {
        const content = await fs.readFile(candidatePath, "utf-8");
        const parsed = JSON.parse(content) as Partial<EvidenceReport>;
        if (parsed.implementationSummary || parsed.filesChanged) {
          return {
            runId,
            implementationSummary: parsed.implementationSummary ?? "",
            filesChanged: parsed.filesChanged ?? [],
            commandsExecuted: parsed.commandsExecuted ?? [],
            checksClaimed: parsed.checksClaimed ?? [],
            assumptions: parsed.assumptions ?? [],
            knownLimitations: parsed.knownLimitations ?? [],
            remainingUncertainty: parsed.remainingUncertainty ?? [],
          };
        }
      } catch {
        // File doesn't exist or isn't valid.
      }
    }
    return undefined;
  }
}

// ── Droid Output Parser ────────────────────────────────────────────────

interface DroidParsedOutput {
  error?: { code: string; message: string };
  modelUsage?: {
    modelCalls: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
}

/**
 * Parse the stdout from `droid exec --output-format json`.
 *
 * Droid with --output-format json emits JSON Lines: one JSON object per
 * event/message. We extract model usage and error information.
 */
function parseDroidOutput(stdout: string, _stderr: string): DroidParsedOutput {
  const result: DroidParsedOutput = {};

  if (!stdout.trim()) {
    // No output — agent may have failed silently.
    return {
      error: {
        code: "tool_error",
        message: "Droid produced no output (empty stdout)",
      },
    };
  }

  try {
    // Try parsing as a single JSON object first.
    const parsed = JSON.parse(stdout.trim());
    extractFromJsonObject(parsed, result);
  } catch {
    // Try parsing as JSON Lines.
    const lines = stdout.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        const obj = JSON.parse(line.trim());
        extractFromJsonObject(obj, result);
      } catch {
        // Non-JSON line — ignore.
      }
    }
  }

  return result;
}

function extractFromJsonObject(
  obj: Record<string, unknown>,
  result: DroidParsedOutput,
): void {
  // Droid's --output-format json wraps usage in a nested "usage" object:
  // { usage: { input_tokens, output_tokens, ... }, num_turns, ... }
  const usage = (obj.usage as Record<string, unknown>) ?? obj;

  // Extract model usage from token counters (check both top-level and nested).
  if (!result.modelUsage) {
    const inputTokens =
      (usage.input_tokens as number) ??
      (obj.input_tokens as number) ??
      (obj.inputTokens as number) ??
      0;
    const outputTokens =
      (usage.output_tokens as number) ??
      (obj.output_tokens as number) ??
      (obj.outputTokens as number) ??
      0;
    const modelCalls =
      (usage.num_turns as number) ??
      (obj.num_turns as number) ??
      (obj.model_calls as number) ??
      (obj.modelCalls as number) ??
      1;

    if (inputTokens > 0 || outputTokens > 0) {
      result.modelUsage = {
        modelCalls,
        inputTokens,
        outputTokens,
        estimatedCostUsd: 0, // Cost estimation requires provider config.
      };
    }
  }

  // Extract error information (also check nested usage for error context).
  if (!result.error) {
    const isError = obj.is_error === true || obj.subtype === "error";
    if (obj.error) {
      const err = obj.error as Record<string, unknown>;
      result.error = {
        code: (err.code as string) ?? "tool_error",
        message: (err.message as string) ?? String(err),
      };
    } else if (isError) {
      result.error = {
        code: "tool_error",
        message: (obj.result as string) ?? "Droid reported an error",
      };
    }
  }

  // Accumulate token counts across multiple JSON objects.
  if (result.modelUsage) {
    const addInput =
      (usage.input_tokens as number) ?? (obj.input_tokens as number) ?? 0;
    const addOutput =
      (usage.output_tokens as number) ?? (obj.output_tokens as number) ?? 0;
    if (addInput > 0) result.modelUsage.inputTokens += addInput;
    if (addOutput > 0) result.modelUsage.outputTokens += addOutput;
    // Update modelCalls from num_turns if present
    const turns = usage.num_turns as number ?? obj.num_turns as number;
    if (typeof turns === "number" && turns > result.modelUsage.modelCalls) {
      result.modelUsage.modelCalls = turns;
    }
  }
}
