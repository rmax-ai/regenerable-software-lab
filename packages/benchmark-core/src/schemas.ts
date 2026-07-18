// @rsl/benchmark-core — Zod schemas for external validation

import { z } from "zod";

// ── Run Configuration Schema ──────────────────────────────────────────

export const RunLimitsSchema = z.object({
  wallClockSeconds: z.number().int().positive(),
  maxModelCalls: z.number().int().positive().optional(),
  maxInputTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  maxCostUsd: z.number().positive().optional(),
  maxVerificationAttempts: z.number().int().positive().optional(),
  maxDiskMb: z.number().int().positive().optional(),
  maxMemoryMb: z.number().int().positive().optional(),
});

export const ModelConfigurationSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  reasoningEffort: z.string().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  seed: z.number().int().optional(),
  endpoint: z.string().url().optional(),
});

export const HarnessConfigurationSchema = z.object({
  id: z.string().min(1),
  version: z.string().optional(),
});

export const RunConfigurationSchema = z.object({
  runId: z.string().uuid(),
  benchmarkVersion: z.string(),
  applicationId: z.string(),
  profile: z.enum(["basic", "behavioral", "operational"]),
  harness: HarnessConfigurationSchema,
  model: ModelConfigurationSchema,
  seed: z.number().int(),
  limits: RunLimitsSchema,
});

// ── Verification Result Schema ────────────────────────────────────────

export const VerificationResultSchema = z.object({
  stage: z.string(),
  status: z.enum(["passed", "failed", "skipped", "error"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  exitCode: z.number().int().optional(),
  metrics: z.record(z.union([z.string(), z.number(), z.boolean()])),
  artifacts: z.array(z.string()),
  failureCategory: z.string().optional(),
});

// ── Trace Event Schema ────────────────────────────────────────────────

export const TraceEventSchema = z.object({
  timestamp: z.string().datetime(),
  runId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  source: z.enum(["runner", "harness", "model", "shell", "verification", "policy"]),
  type: z.string(),
  payload: z.record(z.unknown()),
});

// ── Evidence Report Schema ────────────────────────────────────────────

export const ClaimedCheckSchema = z.object({
  name: z.string(),
  command: z.string().optional(),
  claimedStatus: z.enum(["passed", "failed", "not_run"]),
});

export const EvidenceReportSchema = z.object({
  runId: z.string().uuid(),
  implementationSummary: z.string(),
  filesChanged: z.array(z.string()),
  commandsExecuted: z.array(z.string()),
  checksClaimed: z.array(ClaimedCheckSchema),
  assumptions: z.array(z.string()),
  knownLimitations: z.array(z.string()),
  remainingUncertainty: z.array(z.string()),
});

// ── Parse helpers ─────────────────────────────────────────────────────

export function parseRunConfig(raw: unknown) {
  return RunConfigurationSchema.parse(raw);
}

export function parseEvidenceReport(raw: unknown) {
  return EvidenceReportSchema.parse(raw);
}
