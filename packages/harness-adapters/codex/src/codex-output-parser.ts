// @rsl/harness-codex — Codex CLI output parser
//
// Parses Codex CLI stdout (JSONL when --json is used, supplemented by
// unstructured log lines) into normalized trace events and usage data.

import type { TraceEvent } from "@rsl/benchmark-core";
import type { ModelUsage } from "@rsl/benchmark-core";

// ── Types ───────────────────────────────────────────────────────────────────

/** Raw JSONL event emitted by `codex exec --json` */
export interface CodexThreadEvent {
  type: string;
  thread_id?: string;
  turn_id?: string;
  content?: unknown;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: unknown;
  /** Usage may appear on turn.end events */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_cache_read?: number;
    input_tokens_cache_write?: number;
    cost_usd?: number;
  };
  error?: { code: string; message: string };
  status?: string;
  [key: string]: unknown;
}

/** Parsed model usage from Codex output */
export interface CodexModelUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

/** Full parsed output of a Codex run */
export interface CodexParsedOutput {
  events: CodexThreadEvent[];
  modelUsage?: CodexModelUsage;
  completionStatus: "completed" | "failed" | "timeout";
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    raw: CodexThreadEvent;
  }>;
  error?: { code: string; message: string };
}

// ── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse raw Codex CLI stdout (mix of JSONL and unstructured lines) into
 * structured data.
 *
 * Codex with --json emits one JSON object per line for structured events,
 * interleaved with unstructured stderr/log lines. This parser skips non-JSON
 * lines and accumulates the structured events.
 */
export function parseCodexOutput(
  stdout: string,
  stderr?: string,
): CodexParsedOutput {
  const lines = stdout.split("\n");
  const events: CodexThreadEvent[] = [];
  const toolCalls: CodexParsedOutput["toolCalls"] = [];
  let completionStatus: CodexParsedOutput["completionStatus"] = "completed";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    // Skip non-JSON lines (log messages, error output)
    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as CodexThreadEvent;

      // Validate it looks like a Codex event (has a type field)
      if (!parsed.type) {
        continue;
      }

      events.push(parsed);

      // ── Detect tool calls ──────────────────────────────────────────
      if (
        parsed.type === "tool.use" ||
        parsed.type === "tool.started" ||
        (parsed.type === "tool_call" && parsed.tool_name)
      ) {
        toolCalls.push({
          name: parsed.tool_name ?? "unknown",
          input: parsed.tool_input ?? {},
          raw: parsed,
        });
      }

      // ── Detect completion status ───────────────────────────────────
      if (
        parsed.type === "error" ||
        (parsed.type === "turn.end" && parsed.error)
      ) {
        completionStatus = "failed";
      }

      // ── Collect model usage from turn.end events ───────────────────
    } catch {
      // Skip lines that aren't valid JSON
    }
  }

  const modelUsage = extractModelUsage(events);

  // Determine error info from error events
  const errorEvent = events.find(
    (e) => e.type === "error" && e.error,
  );
  const error = errorEvent?.error
    ? { code: errorEvent.error.code, message: errorEvent.error.message }
    : undefined;

  return {
    events,
    modelUsage,
    completionStatus,
    toolCalls,
    error,
  };
}

/**
 * Aggregate model usage from all events in the run.
 */
function extractModelUsage(events: CodexThreadEvent[]): CodexModelUsage | undefined {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  let found = false;

  for (const event of events) {
    if (event.usage) {
      totalInput += event.usage.input_tokens ?? 0;
      totalOutput += event.usage.output_tokens ?? 0;
      totalCost += event.usage.cost_usd ?? 0;
      found = true;
    }
  }

  if (!found) {
    return undefined;
  }

  return {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    estimatedCostUsd: totalCost,
  };
}

/**
 * Convert Codex parsed output to benchmark-core ModelUsage.
 */
export function codexUsageToModelUsage(
  usage: CodexModelUsage | undefined,
  modelCalls: number,
): ModelUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    modelCalls,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    estimatedCostUsd: usage.estimatedCostUsd,
  };
}

/**
 * Convert Codex thread events to normalized TraceEvent array.
 */
export function codexEventsToTraceEvents(
  events: CodexThreadEvent[],
  runId: string,
): TraceEvent[] {
  return events
    .filter((e) => e.type !== "thread.started" && e.type !== "turn.started")
    .map((event, index) => {
      let source: TraceEvent["source"] = "model";
      let type = event.type;

      if (
        type === "tool.use" ||
        type === "tool.started" ||
        type === "tool_call"
      ) {
        source = "shell";
        type = event.tool_name
          ? `shell.tool_call.${event.tool_name}`
          : "shell.tool_call";
      } else if (type === "error") {
        source = "harness";
      }

      const traceEvent: TraceEvent = {
        timestamp: new Date().toISOString(),
        runId,
        sequence: index + 1,
        source,
        type,
        payload: event as unknown as Record<string, unknown>,
      };

      return traceEvent;
    });
}
