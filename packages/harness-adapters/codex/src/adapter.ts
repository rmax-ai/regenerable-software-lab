// @rsl/harness-codex — CodexAdapter
//
// Implements the AgentHarness interface by wrapping the Codex CLI.
// Spawns `codex exec --sandbox workspace-write` as a child process,
// captures its JSONL output, normalizes Codex-specific error codes,
// and extracts model usage statistics.

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
import {
  parseCodexOutput,
  codexUsageToModelUsage,
  codexEventsToTraceEvents,
} from "./codex-output-parser.js";

// ── Constants ───────────────────────────────────────────────────────────────

const CODEX_CONFIG_DIR = ".codex";
const CODEX_CONFIG_FILE = "config.toml";
const AGENTS_MD_FILE = "AGENTS.md";

// ── Configuration ──────────────────────────────────────────────────────────

export interface CodexAdapterOptions {
  /** Path to the codex binary (default: "codex"). */
  codexBinary?: string;
  /** Sandbox mode for the agent (default: "workspace-write"). */
  sandbox?: string;
  /** Model override passed via -m flag. */
  modelOverride?: string;
}

// ── CodexAdapter ────────────────────────────────────────────────────────────

export class CodexAdapter implements AgentHarness {
  readonly id = "codex";
  readonly version = "0.1.0";

  private readonly codexBinary: string;
  private readonly sandbox: string;
  private readonly modelOverride?: string;

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

  constructor(options: CodexAdapterOptions = {}) {
    this.codexBinary = options.codexBinary ?? "codex";
    this.sandbox = options.sandbox ?? "workspace-write";
    this.modelOverride = options.modelOverride;
  }

  // ── prepare ──────────────────────────────────────────────────────────────

  async prepare(input: PrepareInput): Promise<PreparedRun> {
    const { runId, workspacePath, taskPrompt, model, limits } = input;

    // Ensure workspace directory exists.
    await fs.mkdir(workspacePath, { recursive: true });

    // Write the task prompt to workspace/AGENTS.md.
    const agentsMdPath = path.join(workspacePath, AGENTS_MD_FILE);
    await fs.writeFile(agentsMdPath, taskPrompt, "utf-8");

    // Set up .codex/config.toml if it doesn't exist.
    const codexDir = path.join(workspacePath, CODEX_CONFIG_DIR);
    const configPath = path.join(codexDir, CODEX_CONFIG_FILE);

    try {
      await fs.access(configPath);
    } catch {
      // Config doesn't exist — create default.
      await fs.mkdir(codexDir, { recursive: true });
      const configLines: string[] = [];

      // Map model configuration to Codex config.
      if (model.model) {
        configLines.push(`model = "${model.model}"`);
      }
      if (model.temperature !== undefined) {
        configLines.push(`temperature = ${model.temperature}`);
      }
      if (model.maxOutputTokens !== undefined) {
        configLines.push(`max_output_tokens = ${model.maxOutputTokens}`);
      }
      if (model.reasoningEffort) {
        configLines.push(`reasoning_effort = "${model.reasoningEffort}"`);
      }

      configLines.push("");
      configLines.push("[renderer]");
      configLines.push('type = "none"');
      configLines.push("");
      configLines.push("[approvals]");
      configLines.push("shell_commands = false");
      configLines.push("file_edits = false");

      await fs.writeFile(configPath, configLines.join("\n"), "utf-8");

      // Record trace event for config file write.
      this.emitTraceEvent(runId, "harness", "file_written", {
        path: configPath,
        size: configLines.join("\n").length,
        mimeType: "text/toml",
      });
    }

    // Set up Codex-specific environment variables.
    const env: Record<string, string> = {
      ...input.environment,
      CODEX_NONINTERACTIVE: "1",
      PAGER: "cat",
      TERM: "dumb",
      NO_COLOR: "1",
      RSL_RUN_ID: runId,
      RSL_WORKSPACE_PATH: workspacePath,
      RSL_AGENTS_MD_PATH: agentsMdPath,
      RSL_MODEL_PROVIDER: model.provider,
      RSL_MODEL_NAME: model.model,
      RSL_LIMIT_WALL_CLOCK_SECONDS: String(limits.wallClockSeconds),
    };

    if (model.temperature !== undefined) {
      env.RSL_MODEL_TEMPERATURE = String(model.temperature);
    }
    if (model.maxOutputTokens !== undefined) {
      env.RSL_MODEL_MAX_OUTPUT_TOKENS = String(model.maxOutputTokens);
    }

    // Record trace event for AGENTS.md write.
    this.emitTraceEvent(runId, "harness", "file_written", {
      path: agentsMdPath,
      size: taskPrompt.length,
      mimeType: "text/markdown",
    });

    const preparedRun: PreparedRun = {
      runId,
      workspacePath,
      environment: env,
      agentsMdPath,
    };

    this.preparedRuns.set(runId, preparedRun);

    return preparedRun;
  }

  // ── execute ──────────────────────────────────────────────────────────────

  async execute(input: ExecuteInput): Promise<ExecutionResult> {
    const { runId, preparedRun } = input;
    const workspacePath = preparedRun.workspacePath;
    const startedAt = new Date().toISOString();

    // Read the task prompt we wrote earlier.
    const promptPath = path.join(workspacePath, AGENTS_MD_FILE);
    let prompt: string;
    try {
      prompt = await fs.readFile(promptPath, "utf-8");
    } catch {
      prompt = ""; // Fall back to empty prompt.
    }

    // Build the codex exec command.
    const args: string[] = [
      "exec",
      "--json",
      "--sandbox",
      this.sandbox,
      "--skip-git-repo-check",
      "--ephemeral",
      "-C",
      workspacePath,
      "--ignore-user-config",
      "--ignore-rules",
    ];

    // Determine model argument.
    let modelArg: string | undefined;
    if (this.modelOverride) {
      modelArg = this.modelOverride;
    } else {
      try {
        const configContent = await fs.readFile(
          path.join(workspacePath, CODEX_CONFIG_DIR, CODEX_CONFIG_FILE),
          "utf-8",
        );
        const modelMatch = configContent.match(/^model\s*=\s*"([^"]+)"$/m);
        if (modelMatch) {
          modelArg = modelMatch[1];
        }
      } catch {
        // Ignore config read errors.
      }
    }

    if (modelArg) {
      args.push("-m", modelArg);
    }

    args.push("--color", "never");

    // Add the prompt as the final argument.
    args.push(prompt);

    // Initialize stdout/stderr buffers.
    this.stdoutBuffers.set(runId, "");
    this.stderrBuffers.set(runId, "");

    // Record shell command trace event.
    this.emitTraceEvent(runId, "shell", "command_start", {
      command: `${this.codexBinary} exec`,
      args,
      cwd: workspacePath,
    });

    // Spawn the codex process.
    const child = spawn(this.codexBinary, args, {
      cwd: workspacePath,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CODEX_NONINTERACTIVE: "1",
        PAGER: "cat",
        TERM: "dumb",
        NO_COLOR: "1",
      },
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

        // Record shell exit trace event.
        this.emitTraceEvent(runId, "shell", "command_exit", {
          exitCode: exitCode ?? null,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        });

        // Parse the output.
        const parsed = parseCodexOutput(stdout, stderr);

        // Determine status.
        let status: ExecutionResult["status"] = "completed";
        if (exitCode !== 0 && exitCode !== null) {
          status = "failed";
        } else if (parsed.error || parsed.completionStatus === "failed") {
          status = "failed";
        } else if (parsed.completionStatus === "timeout") {
          status = "timeout";
        }

        // Build model usage.
        const modelCallCount = parsed.toolCalls.length;
        const modelUsage = codexUsageToModelUsage(
          parsed.modelUsage,
          modelCallCount,
        );

        // Normalize Codex-specific error codes.
        const normalizedError = parsed.error
          ? this.normalizeCodexError(parsed.error)
          : undefined;

        const result: ExecutionResult = {
          status,
          startedAt,
          completedAt,
          exitCode: exitCode ?? undefined,
          reportedCompletion: parsed.completionStatus === "completed",
          modelUsage,
        };

        if (normalizedError) {
          result.error = normalizedError;
        }

        // Store parsed events for later artifact collection.
        const traceEvents = codexEventsToTraceEvents(parsed.events, runId);
        this.traceEventsMap.set(runId, traceEvents);

        resolve(result);
      });

      child.on("error", (err) => {
        this.processes.delete(runId);

        const completedAt = new Date().toISOString();

        const result: ExecutionResult = {
          status: "failed",
          startedAt,
          completedAt,
          reportedCompletion: false,
          error: {
            code: "HARNESS_CRASH",
            message: `Failed to spawn codex process: ${err.message}`,
          },
        };

        resolve(result);
      });
    });
  }

  // ── terminate ────────────────────────────────────────────────────────────

  async terminate(runId: string): Promise<void> {
    const child = this.processes.get(runId);
    if (!child) {
      return;
    }

    // Record termination trace event.
    this.emitTraceEvent(runId, "harness", "terminate", {
      signal: "SIGTERM",
    });

    // Send SIGTERM first, then SIGKILL after a grace period.
    child.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          child.kill("SIGKILL");
          this.emitTraceEvent(runId, "harness", "terminate", {
            signal: "SIGKILL",
          });
        } catch {
          // Process may already be dead.
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

  // ── collectArtifacts ─────────────────────────────────────────────────────

  async collectArtifacts(runId: string): Promise<HarnessArtifacts> {
    const preparedRun = this.preparedRuns.get(runId);

    // Collect all files in the workspace.
    let files: string[] = [];
    if (preparedRun?.workspacePath) {
      files = await this.collectWorkspaceFiles(preparedRun.workspacePath);
    }

    // Try to parse an evidence report from the workspace.
    let evidenceReport: EvidenceReport | undefined;
    if (preparedRun?.workspacePath) {
      evidenceReport = await this.parseEvidenceReport(
        preparedRun.workspacePath,
        runId,
      );
    }

    // Collect stdout/stderr buffers as file references.
    const stdoutBuffer = this.stdoutBuffers.get(runId);
    const stderrBuffer = this.stderrBuffers.get(runId);
    if (stdoutBuffer !== undefined) {
      files.push(`stdout://run-${runId}.log`);
    }
    if (stderrBuffer !== undefined) {
      files.push(`stderr://run-${runId}.log`);
    }

    const artifacts: HarnessArtifacts & { traceEvents?: TraceEvent[] } = {
      files,
    };

    // Attach evidence report if found.
    if (evidenceReport) {
      artifacts.evidenceReport = evidenceReport;
    }

    // Attach trace events for the runner.
    const traceEvents = this.traceEventsMap.get(runId);
    if (traceEvents) {
      artifacts.traceEvents = traceEvents;
    }

    return artifacts;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Normalize Codex-specific error codes to standard RSL error codes.
   */
  private normalizeCodexError(
    error: { code: string; message: string },
  ): NormalizedError {
    const codexToRsl: Record<string, string> = {
      "rate_limit": "RESOURCE_LIMIT_EXCEEDED",
      "auth_error": "MODEL_CONFIGURATION_ERROR",
      "model_error": "MODEL_CONFIGURATION_ERROR",
      "context_length": "CONTEXT_LOSS",
      "timeout": "HARNESS_TIMEOUT",
      "internal_error": "HARNESS_CRASH",
      "invalid_request": "TOOL_EXECUTION_ERROR",
      "sandbox_error": "FILESYSTEM_ESCAPE_ATTEMPT",
      "tool_error": "TOOL_EXECUTION_ERROR",
      "budget_exceeded": "RESOURCE_LIMIT_EXCEEDED",
    };

    const mappedCode = codexToRsl[error.code] ?? "TOOL_EXECUTION_ERROR";
    const category = mappedCode;

    return {
      code: mappedCode,
      message: error.message,
      category,
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

  /**
   * Recursively collect all workspace file paths (relative to workspace root).
   */
  private async collectWorkspaceFiles(
    workspacePath: string,
  ): Promise<string[]> {
    const results: string[] = [];
    const root = workspacePath;

    try {
      await this.collectFilesRecursive(root, root, results);
    } catch {
      // Workspace may not exist or may have been deleted.
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
      return; // Skip inaccessible directories.
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (
        entry.name === ".codex" ||
        entry.name === "node_modules" ||
        entry.name === ".git"
      ) {
        continue; // Skip internal directories.
      }

      if (entry.isDirectory()) {
        await this.collectFilesRecursive(fullPath, rootPath, results);
      } else if (entry.isFile()) {
        const relativePath = path.relative(rootPath, fullPath);
        results.push(relativePath);
      }
    }
  }

  /**
   * Try to parse an EvidenceReport from the workspace.
   * Checks for evidence-report.json first, then legacy locations.
   */
  private async parseEvidenceReport(
    workspacePath: string,
    runId: string,
  ): Promise<EvidenceReport | undefined> {
    const candidates = [
      path.join(workspacePath, "evidence-report.json"),
      path.join(workspacePath, "evidence.json"),
      path.join(workspacePath, ".codex", "evidence.json"),
      path.join(workspacePath, "evidence.yaml"),
      path.join(workspacePath, ".codex", "evidence.yaml"),
    ];

    for (const candidatePath of candidates) {
      try {
        const content = await fs.readFile(candidatePath, "utf-8");
        if (
          candidatePath.endsWith(".json") ||
          candidatePath.endsWith("evidence-report.json")
        ) {
          const parsed = JSON.parse(content) as Partial<EvidenceReport>;
          // Validate minimal fields.
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
        }
        // YAML parsing would require a yaml parser — skip for now.
      } catch {
        // File doesn't exist or isn't valid.
      }
    }

    return undefined;
  }
}
