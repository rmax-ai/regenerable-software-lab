// @rsl/harness-generic-cli — Trace Normalizer
//
// Normalizes raw shell output to TraceEvent format.
// - Parses stdout for command markers (lines starting with $)
// - Maps exit codes to execution statuses
// - Detects completion signals

import type { TraceEvent, ExecutionResult } from "@rsl/benchmark-core";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CommandMarker {
  /** The raw command text (e.g., "npm test"). */
  command: string;
  /** Line number in the source output where this marker was found. */
  lineNumber: number;
  /** The full line containing the marker. */
  rawLine: string;
}

export interface CompletionSignal {
  /** How the completion was detected. */
  source: "done_marker" | "evidence_report" | "exit_code";
  /** Relevant context (e.g., the matching line or file path). */
  detail: string;
}

// ── Exportable helpers ─────────────────────────────────────────────────────

/**
 * Extract command markers from raw shell output.
 * Command markers are lines that start with "$ " (shell prompt simulation).
 */
export function extractCommandMarkers(output: string): CommandMarker[] {
  const markers: CommandMarker[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match lines starting with "$ " (shell command prompt)
    const match = line.match(/^\$\s+(.+)/);
    if (match) {
      markers.push({
        command: match[1].trim(),
        lineNumber: i + 1,
        rawLine: line,
      });
    }
  }

  return markers;
}

/**
 * Map an exit code to an execution status.
 * * 0 => "completed"
 * * null (crash) => "failed"
 * * non-zero => "failed"
 */
export function mapExitCodeToStatus(
  exitCode: number | undefined | null,
): ExecutionResult["status"] {
  if (exitCode === 0) {
    return "completed";
  }
  return "failed";
}

/**
 * Detect completion signals in raw output and workspace state.
 * Returns the first detected signal or undefined.
 */
export function detectCompletionSignal(
  stdout: string,
  stderr: string,
  workspaceFiles?: string[],
): CompletionSignal | undefined {
  // Check for DONE marker in stdout.
  const doneMatch = /(?:^|\n)\s*DONE\s*(?:\n|$)/im.exec(stdout);
  if (doneMatch) {
    return {
      source: "done_marker",
      detail: `Found 'DONE' at position ${doneMatch.index}`,
    };
  }

  // Check for evidence report in workspace.
  if (workspaceFiles?.some((f) => f.endsWith("evidence-report.json"))) {
    return {
      source: "evidence_report",
      detail: "evidence-report.json present in workspace",
    };
  }

  // Check stderr for known completion signals.
  const stderrDone = /(?:^|\n)\s*DONE\s*(?:\n|$)/im.exec(stderr);
  if (stderrDone) {
    return {
      source: "done_marker",
      detail: `Found 'DONE' in stderr at position ${stderrDone.index}`,
    };
  }

  return undefined;
}

/**
 * Normalize raw shell output into a partial TraceEvent representation.
 * This produces a series of events that can be appended to a trace.
 */
export function normalizeTrace(
  runId: string,
  stdout: string,
  stderr: string,
  exitCode: number | undefined | null,
  startSequence: number = 0,
): TraceEvent[] {
  const events: TraceEvent[] = [];
  const baseSeq = startSequence;

  // 1. Emit a shell start event.
  events.push({
    timestamp: new Date().toISOString(),
    runId,
    sequence: baseSeq,
    source: "shell",
    type: "shell_start",
    payload: {},
  });

  // 2. Extract command markers and emit a trace event per command.
  const markers = extractCommandMarkers(stdout);
  for (let i = 0; i < markers.length; i++) {
    events.push({
      timestamp: new Date().toISOString(),
      runId,
      sequence: baseSeq + 1 + i,
      source: "shell",
      type: "command",
      payload: {
        command: markers[i].command,
        lineNumber: markers[i].lineNumber,
        rawLine: markers[i].rawLine,
      },
    });
  }

  // 3. Emit a shell exit event with exit code and status.
  const status = mapExitCodeToStatus(exitCode);
  events.push({
    timestamp: new Date().toISOString(),
    runId,
    sequence: baseSeq + markers.length + 1,
    source: "shell",
    type: "shell_exit",
    payload: {
      exitCode: exitCode ?? null,
      status,
      stdoutLength: stdout.length,
      stderrLength: stderr.length,
    },
  });

  return events;
}
