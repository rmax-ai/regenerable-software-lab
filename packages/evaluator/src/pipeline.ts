// @rsl/evaluator — Stage pipeline with fail-soft behavior (SPEC.md §19.2)

import type { VerificationResult } from "@rsl/benchmark-core";
import type { StageResult, StageStatus } from "./types.js";
import type { StageFunction } from "./stages.js";

// ── Stage Definition ────────────────────────────────────────────────────

export interface StageDefinition {
  stage: number;
  name: string;
  fn: StageFunction;
  fatal: boolean;
  dependsOn?: number[];
}

// ── Pipeline Runner ─────────────────────────────────────────────────────

export async function runPipeline(
  workspacePath: string,
  stages: StageDefinition[],
  benchmarkDir?: string,
): Promise<VerificationResult[]> {
  const results: StageResult[] = [];

  for (const def of stages) {
    // ── Dependency check ───────────────────────────────────────────────
    if (def.dependsOn && def.dependsOn.length > 0) {
      const depsFailed = def.dependsOn.some((depStage) => {
        const depResult = results.find((r) => r.stage === depStage);
        return depResult ? depResult.status !== "passed" : true;
      });

      if (depsFailed) {
        results.push({
          stage: def.stage,
          name: def.name,
          status: "skipped",
          durationMs: 0,
          metrics: {},
          artifacts: [],
        });
        continue;
      }
    }

    // ── Execute ────────────────────────────────────────────────────────
    let result: StageResult;
    try {
      result = await def.fn(workspacePath, benchmarkDir);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result = {
        stage: def.stage,
        name: def.name,
        status: "error",
        durationMs: 0,
        metrics: { error: msg },
        failureCategory: "EVALUATOR_ERROR",
        artifacts: [],
      };
    }

    results.push(result);

    // ── Fatal failure check ────────────────────────────────────────────
    if (result.status !== "passed" && def.fatal) {
      const remaining = stages.slice(results.length);
      for (const r of remaining) {
        results.push({
          stage: r.stage,
          name: r.name,
          status: "skipped",
          durationMs: 0,
          metrics: {},
          artifacts: [],
        });
      }
      break;
    }
  }

  return results.map(toVerificationResult);
}

// ── Conversion ──────────────────────────────────────────────────────────

function toVerificationResult(sr: StageResult): VerificationResult {
  const now = new Date().toISOString();
  return {
    stage: String(sr.stage),
    status: sr.status,
    startedAt: now,
    completedAt: now,
    exitCode: sr.exitCode,
    metrics: { ...sr.metrics, durationMs: sr.durationMs },
    artifacts: sr.artifacts,
    failureCategory: sr.failureCategory,
  };
}
