// @rsl/harness-generic-cli — GenericCliAdapter
//
// Implements the AgentHarness interface for any CLI-based coding agent.
// The adapter prepares a workspace, spawns a configurable command,
// captures stdout/stderr, and collects artifacts on completion.

import { spawn, type ChildProcess } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  AgentHarness,
  PrepareInput,
  PreparedRun,
  ExecuteInput,
  ExecutionResult,
  HarnessArtifacts,
  EvidenceReport,
} from "@rsl/benchmark-core";

// ── Configuration ───────────────────────────────────────────────────────────

export interface GenericCliAdapterConfig {
  /** The command to execute (e.g., "codex" or ["codex", "--agent"]). */
  command: string | string[];
  /** Natural-language key used to build task prompt filename (default: "task"). */
  taskPromptFilename?: string;
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
  private readonly startTimes: Map<string, number> = new Map();
  private readonly completionSignals: Map<string, boolean> = new Map();

  constructor(config?: GenericCliAdapterConfig) {
    this.config = {
      command: config?.command ?? "agent",
      taskPromptFilename: config?.taskPromptFilename ?? "task",
      startTimeoutMs: config?.startTimeoutMs ?? 30_000,
    };
  }

  // ── prepare ────────────────────────────────────────────────────────────────

  async prepare(input: PrepareInput): Promise<PreparedRun> {
    // Write the task prompt to the workspace.
    const promptPath = path.join(
      input.workspacePath,
      `${this.config.taskPromptFilename}.md`,
    );
    const { writeFile: writeFs } = await import("node:fs/promises");
    await writeFs(promptPath, input.taskPrompt, "utf-8");

    // Build environment variables to pass to the agent process.
    // The agent receives workspace path, run id, and model info via env.
    const env: Record<string, string> = {
      ...input.environment,
      RSL_RUN_ID: input.runId,
      RSL_WORKSPACE_PATH: input.workspacePath,
      RSL_TASK_PROMPT_PATH: promptPath,
      RSL_MODEL_PROVIDER: input.model.provider,
      RSL_MODEL_NAME: input.model.model,
      RSL_LIMIT_WALL_CLOCK_SECONDS: String(input.limits.wallClockSeconds),
    };

    if (input.model.temperature !== undefined) {
      env.RSL_MODEL_TEMPERATURE = String(input.model.temperature);
    }
    if (input.model.maxOutputTokens !== undefined) {
      env.RSL_MODEL_MAX_OUTPUT_TOKENS = String(input.model.maxOutputTokens);
    }

    // Store workspace path for this run so collectArtifacts can find it.
    this.workspacePaths.set(input.runId, input.workspacePath);

    return {
      runId: input.runId,
      workspacePath: input.workspacePath,
      environment: env,
      taskPromptPath: promptPath,
    };
  }

  // ── execute ────────────────────────────────────────────────────────────────

  async execute(input: ExecuteInput): Promise<ExecutionResult> {
    const { preparedRun } = input;
    const workspacePath = preparedRun.workspacePath as string;
    const env = (preparedRun as Record<string, unknown>).environment as
      | Record<string, string>
      | undefined;
    const runId = input.runId ?? preparedRun.runId;

    // Store workspace path for this run.
    this.workspacePaths.set(runId, workspacePath);

    const startedAt = new Date().toISOString();

    // Build the command to spawn.
    const cmd = Array.isArray(this.config.command)
      ? this.config.command
      : this.config.command.split(/\s+/);

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

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      // Check for completion marker in real-time.
      const full = stdoutChunks.map((b) => b.toString("utf-8")).join("");
      if (detectDoneMarker(full)) {
        this.completionSignals.set(runId, true);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    // Wait for the process to exit (or capture its exit code).
    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("close", (code) => {
        resolve(code);
      });
      child.on("error", () => {
        resolve(null);
      });
    });

    // Assemble full output.
    const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
    const stderr = Buffer.concat(stderrChunks).toString("utf-8");

    this.stdioBuffers.set(runId, { stdout, stderr });

    const completedAt = new Date().toISOString();
    const reportedCompletion =
      this.completionSignals.get(runId) === true || exitCode === 0;

    // Determine status.
    let status: ExecutionResult["status"];
    if (exitCode === 0) {
      status = "completed";
    } else if (exitCode === null) {
      status = "failed";
    } else {
      status = "failed";
    }

    const result: ExecutionResult = {
      status,
      startedAt,
      completedAt,
      exitCode: exitCode ?? undefined,
      reportedCompletion,
    };

    // Include error info on failure.
    if (status !== "completed") {
      result.error = {
        code: exitCode === null ? "PROCESS_CRASH" : `EXIT_${exitCode}`,
        message:
          stderr.slice(0, 2000) || `Process exited with code ${exitCode}`,
        category: "TOOL_EXECUTION_ERROR",
      };
    }

    return result;
  }

  // ── terminate ──────────────────────────────────────────────────────────────

  async terminate(runId: string): Promise<void> {
    const child = this.processes.get(runId);
    if (!child || child.killed) {
      return;
    }

    // Try SIGTERM first, then SIGKILL after a short grace period.
    child.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5_000);

      child.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });

      child.on("error", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.processes.delete(runId);
  }

  // ── collectArtifacts ──────────────────────────────────────────────────────

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

    const artifacts: HarnessArtifacts = { files };
    if (evidenceReport) {
      artifacts.evidenceReport = evidenceReport;
    }

    return artifacts;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Detect a DONE completion marker in captured output. */
function detectDoneMarker(output: string): boolean {
  // Match "DONE", "DONE.", "DONE\n", or evidence-report.json mention.
  return (
    /(?:^|\n)\s*DONE\s*(?:\n|$)/im.test(output) ||
    /evidence-report\.json/.test(output)
  );
}
