// @rsl/harness-generic-cli — GenericCliAdapter
//
// Implements the AgentHarness interface for any CLI-based coding agent.
// The adapter prepares a workspace with AGENTS.md, spawns a configurable
// command, captures stdout/stderr, enforces wall-clock timeouts, records
// trace events, and collects artifacts on completion.

import { spawn, type ChildProcess } from "node:child_process";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  AgentHarness,
  PrepareInput,
  PreparedRun,
  ExecuteInput,
  ExecutionResult,
  HarnessArtifacts,
  EvidenceReport,
  TraceEvent,
} from "@rsl/benchmark-core";

// ── Configuration ───────────────────────────────────────────────────────────

export interface GenericCliAdapterConfig {
  /** The command to execute (e.g., "codex" or ["codex", "--agent"]). */
  command: string | string[];
  /** Timeout for process start after prepare (ms, default: 30_000). */
  startTimeoutMs?: number;
}

// ── GenericCliAdapter ───────────────────────────────────────────────────────

export class GenericCliAdapter implements AgentHarness {
  readonly id = "generic-cli";
  readonly version = "0.1.0";

  private readonly config: Required<GenericCliAdapterConfig>;
  private readonly processes: Map<string, ChildProcess> = new Map();
  private readonly workspacePaths: Map<string, string> = new Map();
  private readonly stdioBuffers: Map<
    string,
    { stdout: string; stderr: string }
  > = new Map();
  private readonly traceEventBuffers: Map<string, TraceEvent[]> = new Map();
  private readonly startTimes: Map<string, number> = new Map();
  private readonly wallClockMs: Map<string, number> = new Map();
  private seqCounter = 0;

  constructor(config?: GenericCliAdapterConfig) {
    this.config = {
      command: config?.command ?? "agent",
      startTimeoutMs: config?.startTimeoutMs ?? 30_000,
    };
  }

  // ── prepare ──────────────────────────────────────────────────────────────

  async prepare(input: PrepareInput): Promise<PreparedRun> {
    const { runId, workspacePath, taskPrompt, model, limits } = input;

    // Ensure workspace directory exists.
    await mkdir(workspacePath, { recursive: true });

    // Write the task prompt to workspace/AGENTS.md.
    const agentsPath = path.join(workspacePath, "AGENTS.md");
    await writeFile(agentsPath, taskPrompt, "utf-8");

    // Build environment variables for the agent process.
    const env: Record<string, string> = {
      ...input.environment,
      RSL_RUN_ID: runId,
      RSL_WORKSPACE_PATH: workspacePath,
      RSL_AGENTS_MD_PATH: agentsPath,
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

    // Store workspace and wall-clock limit for this run.
    this.workspacePaths.set(runId, workspacePath);
    this.wallClockMs.set(runId, limits.wallClockSeconds * 1000);

    // Record trace event for the AGENTS.md file write.
    this.emitTraceEvent(runId, "harness", "file_written", {
      path: agentsPath,
      size: taskPrompt.length,
      mimeType: "text/markdown",
    });

    return {
      runId,
      workspacePath,
      environment: env,
      agentsMdPath: agentsPath,
    };
  }

  // ── execute ──────────────────────────────────────────────────────────────

  async execute(input: ExecuteInput): Promise<ExecutionResult> {
    const { runId, preparedRun } = input;
    const workspacePath = preparedRun.workspacePath;
    const env = (preparedRun as Record<string, unknown>).environment as
      | Record<string, string>
      | undefined;
    const limitMs = this.wallClockMs.get(runId) ?? 600_000; // default 10 min

    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    // Build the command to spawn.
    const cmd = Array.isArray(this.config.command)
      ? this.config.command
      : this.config.command.split(/\s+/);

    // Record shell command trace event.
    const cmdStr = cmd.join(" ");
    this.emitTraceEvent(runId, "shell", "command_start", {
      command: cmdStr,
      cwd: workspacePath,
    });

    // Spawn the agent process in the workspace directory.
    const child = spawn(cmd[0]!, cmd.slice(1), {
      cwd: workspacePath,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    }) as unknown as ChildProcess;

    this.processes.set(runId, child);
    this.startTimes.set(runId, Date.now());

    // Capture stdout/stderr.
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    // Wait for process to finish with a wall-clock timeout.
    const exitCode = await new Promise<number | null>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {
          // Process may already be gone.
        }
        // Give a short grace period for SIGTERM, then force kill.
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // Already dead.
          }
          resolve(null);
        }, 2_000);
      }, limitMs);

      child.on("close", (code) => {
        clearTimeout(timeoutHandle);
        resolve(code);
      });

      child.on("error", () => {
        clearTimeout(timeoutHandle);
        resolve(null);
      });
    });

    // Assemble full output.
    const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
    const stderr = Buffer.concat(stderrChunks).toString("utf-8");

    this.stdioBuffers.set(runId, { stdout, stderr });

    const completedAt = new Date().toISOString();
    const elapsedMs = Date.now() - startTime;

    // Record shell exit trace event.
    this.emitTraceEvent(runId, "shell", "command_exit", {
      exitCode: exitCode ?? null,
      timedOut,
      elapsedMs,
      stdoutLength: stdout.length,
      stderrLength: stderr.length,
    });

    // Detect file modifications in stdout/stderr for trace events.
    this.detectFileModifications(runId, stdout, stderr, workspacePath);

    // Determine status based on exit code and timeout.
    let status: ExecutionResult["status"];
    if (timedOut) {
      status = "timeout";
    } else if (exitCode === 0) {
      status = "completed";
    } else {
      status = "failed";
    }

    const result: ExecutionResult = {
      status,
      startedAt,
      completedAt,
      exitCode: exitCode ?? undefined,
      reportedCompletion: exitCode === 0,
    };

    // Normalize error info on failure.
    if (status !== "completed") {
      if (timedOut) {
        result.error = {
          code: "HARNESS_TIMEOUT",
          message: `Process timed out after ${limitMs}ms`,
          category: "HARNESS_TIMEOUT",
        };
      } else if (exitCode === null) {
        result.error = {
          code: "PROCESS_CRASH",
          message: stderr.slice(0, 2000) || "Process crashed with no output",
          category: "TOOL_EXECUTION_ERROR",
        };
      } else {
        result.error = {
          code: `EXIT_${exitCode}`,
          message: stderr.slice(0, 2000) || `Process exited with code ${exitCode}`,
          category: "TOOL_EXECUTION_ERROR",
        };
      }
    }

    return result;
  }

  // ── terminate ────────────────────────────────────────────────────────────

  async terminate(runId: string): Promise<void> {
    const child = this.processes.get(runId);
    if (!child || child.killed) {
      return;
    }

    // Record termination trace event.
    this.emitTraceEvent(runId, "harness", "terminate", {
      signal: "SIGTERM",
    });

    // Try SIGTERM first, then SIGKILL after a grace period.
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

      child.on("exit", () => {
        clearTimeout(timeout);
        this.processes.delete(runId);
        resolve();
      });

      child.on("error", () => {
        clearTimeout(timeout);
        this.processes.delete(runId);
        resolve();
      });
    });
  }

  // ── collectArtifacts ─────────────────────────────────────────────────────

  async collectArtifacts(runId: string): Promise<HarnessArtifacts> {
    const workspacePath = this.workspacePaths.get(runId);
    const stdio = this.stdioBuffers.get(runId);
    const files: string[] = [];

    // If we know the workspace, try to list files.
    if (workspacePath) {
      try {
        const entries = await readdir(workspacePath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            files.push(path.join(workspacePath, entry.name));
          }
        }
      } catch {
        // Workspace may have been cleaned up.
      }
    }

    // Include stdout/stderr snapshots as trace artifacts.
    if (stdio) {
      files.push(`stdout://run-${runId}.log`);
      files.push(`stderr://run-${runId}.log`);
    }

    // Try to parse evidence-report.json from the workspace.
    let evidenceReport: EvidenceReport | undefined;
    if (workspacePath) {
      const evidencePath = path.join(workspacePath, "evidence-report.json");
      try {
        const content = await readFile(evidencePath, "utf-8");
        evidenceReport = JSON.parse(content) as EvidenceReport;
      } catch {
        // File doesn't exist or is invalid JSON -- that's fine.
      }
    }

    const artifacts: HarnessArtifacts & { traceEvents?: TraceEvent[] } = { files };
    if (evidenceReport) {
      artifacts.evidenceReport = evidenceReport;
    }

    // Attach trace events buffer for retrieval by the runner.
    const traceEvents = this.traceEventBuffers.get(runId);
    if (traceEvents) {
      artifacts.traceEvents = traceEvents;
    }

    return artifacts;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Emit a trace event and store it in the run's buffer. */
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
    const buffer = this.traceEventBuffers.get(runId) ?? [];
    buffer.push(event);
    this.traceEventBuffers.set(runId, buffer);
  }

  /**
   * Scan stdout/stderr for file modification patterns and emit
   * corresponding trace events.
   */
  private detectFileModifications(
    runId: string,
    stdout: string,
    _stderr: string,
    workspacePath: string,
  ): void {
    // Detect patterns like "Wrote file: <path>" or "Created: <path>"
    const fileWritePattern = /(?:Wrote|Written|Created|Modified|Saved)\s+(?:file\s+)?:?\s*["']?([^"'\n]+)["']?/gi;
    let match: RegExpExecArray | null;
    while ((match = fileWritePattern.exec(stdout)) !== null) {
      const filePath = match[1]!;
      this.emitTraceEvent(runId, "shell", "file_modified", {
        path: path.resolve(workspacePath, filePath),
        detectedIn: "stdout",
      });
    }

    // Detect git-style diff markers in output.
    const diffPattern = /^diff\s+--git\s+a\/[^\s]+\s+b\/([^\s]+)/gm;
    while ((match = diffPattern.exec(stdout)) !== null) {
      const filePath = match[1]!;
      this.emitTraceEvent(runId, "shell", "file_modified", {
        path: path.resolve(workspacePath, filePath),
        detectedIn: "stdout",
        method: "git_diff",
      });
    }
  }
}
