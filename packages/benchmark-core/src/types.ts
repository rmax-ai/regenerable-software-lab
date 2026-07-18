// @rsl/benchmark-core — Core types

import type { z } from "zod";

// ── Run Configuration ─────────────────────────────────────────────────

export interface RunConfiguration {
  runId: string;
  benchmarkVersion: string;
  applicationId: string;
  profile: "basic" | "behavioral" | "operational";
  harness: HarnessConfiguration;
  model: ModelConfiguration;
  seed: number;
  limits: RunLimits;
}

export interface HarnessConfiguration {
  id: string;
  version?: string;
}

export interface ModelConfiguration {
  provider: string;
  model: string;
  temperature?: number;
  reasoningEffort?: string;
  maxOutputTokens?: number;
  seed?: number;
  endpoint?: string;
}

export interface RunLimits {
  wallClockSeconds: number;
  maxModelCalls?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxCostUsd?: number;
  maxVerificationAttempts?: number;
  maxDiskMb?: number;
  maxMemoryMb?: number;
}

// ── Verification ──────────────────────────────────────────────────────

export interface VerificationResult {
  stage: string;
  status: "passed" | "failed" | "skipped" | "error";
  startedAt: string;
  completedAt: string;
  exitCode?: number;
  metrics: Record<string, number | string | boolean>;
  artifacts: string[];
  failureCategory?: FailureCategory;
}

// ── Failure Taxonomy ──────────────────────────────────────────────────

export type FailureCategory =
  // Specification failures
  | "SPEC_AMBIGUITY"
  | "SPEC_CONTRADICTION"
  | "SPEC_INCOMPLETE"
  | "SPEC_MISINTERPRETATION"
  // Implementation failures
  | "BUILD_FAILURE"
  | "TYPE_ERROR"
  | "PUBLIC_TEST_FAILURE"
  | "HIDDEN_TEST_FAILURE"
  | "PROPERTY_VIOLATION"
  | "CONTRACT_VIOLATION"
  | "MUTATION_SURVIVOR"
  | "PERFORMANCE_FAILURE"
  // Agent behavior failures
  | "PREMATURE_COMPLETION"
  | "REPEATED_UNPRODUCTIVE_LOOP"
  | "FAILED_ERROR_RECOVERY"
  | "VERIFICATION_NOT_RUN"
  | "FALSE_SUCCESS_CLAIM"
  | "EXCESSIVE_REWRITE"
  | "CONTEXT_LOSS"
  // Policy failures
  | "PROTECTED_ASSET_MODIFICATION"
  | "NETWORK_ACCESS_ATTEMPT"
  | "DISALLOWED_DEPENDENCY"
  | "SECRET_EXPOSURE"
  | "FILESYSTEM_ESCAPE_ATTEMPT"
  | "RESOURCE_LIMIT_EXCEEDED"
  // Harness failures
  | "HARNESS_CRASH"
  | "HARNESS_TIMEOUT"
  | "TRACE_INCOMPLETE"
  | "MODEL_CONFIGURATION_ERROR"
  | "TOOL_EXECUTION_ERROR"
  // Evaluation failures
  | "EVALUATOR_ERROR"
  | "NONDETERMINISTIC_TEST"
  | "INVALID_MUTATION"
  | "ENVIRONMENT_FAILURE";

// ── Trace ──────────────────────────────────────────────────────────────

export interface TraceEvent {
  timestamp: string;
  runId: string;
  sequence: number;
  source: "runner" | "harness" | "model" | "shell" | "verification" | "policy";
  type: string;
  payload: Record<string, unknown>;
}

// ── Evidence ───────────────────────────────────────────────────────────

export interface EvidenceReport {
  runId: string;
  implementationSummary: string;
  filesChanged: string[];
  commandsExecuted: string[];
  checksClaimed: ClaimedCheck[];
  assumptions: string[];
  knownLimitations: string[];
  remainingUncertainty: string[];
}

export interface ClaimedCheck {
  name: string;
  command?: string;
  claimedStatus: "passed" | "failed" | "not_run";
}

// ── Agent Harness ──────────────────────────────────────────────────────

export interface AgentHarness {
  readonly id: string;
  readonly version: string;
  prepare(input: PrepareInput): Promise<PreparedRun>;
  execute(input: ExecuteInput): Promise<ExecutionResult>;
  terminate(runId: string): Promise<void>;
  collectArtifacts(runId: string): Promise<HarnessArtifacts>;
}

export interface PrepareInput {
  runId: string;
  workspacePath: string;
  taskPrompt: string;
  model: ModelConfiguration;
  limits: RunLimits;
  environment: Record<string, string>;
}

export interface PreparedRun {
  runId: string;
  workspacePath: string;
  [key: string]: unknown;
}

export interface ExecuteInput {
  runId: string;
  preparedRun: PreparedRun;
}

export interface ExecutionResult {
  status: "completed" | "failed" | "timeout" | "budget_exhausted" | "policy_terminated";
  startedAt: string;
  completedAt: string;
  exitCode?: number;
  reportedCompletion: boolean;
  modelUsage?: ModelUsage;
  error?: NormalizedError;
}

export interface ModelUsage {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface NormalizedError {
  code: string;
  message: string;
  category?: string;
}

export interface HarnessArtifacts {
  files: string[];
  evidenceReport?: EvidenceReport;
}
