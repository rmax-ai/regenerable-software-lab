// @rsl/runner — Experiment manifest parsing and matrix execution (SPEC.md §28)
//
// Provides the ExperimentRunner class for loading YAML experiment manifests,
// expanding the model x harness x profile x seed matrix into run configs,
// and executing runs with failure isolation and completion tracking.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseYaml } from "js-yaml";
import { z } from "zod";
import {
  type RunConfiguration,
  type RunLimits,
  type AgentHarness,
} from "@rsl/benchmark-core";
import { Runner, type RunResult } from "./Runner.js";

// ── Zod Schemas ──────────────────────────────────────────────────────────

export const ExperimentManifestSchema = z.object({
  id: z.string().min(1),
  benchmark: z.string().min(1),
  benchmark_version: z.string().min(1),
  profiles: z
    .array(z.enum(["basic", "behavioral", "operational"]))
    .min(1),
  models: z
    .array(
      z.object({
        provider: z.string().min(1),
        model: z.string().min(1),
      }),
    )
    .min(1),
  harnesses: z.array(z.string().min(1)).min(1),
  seeds: z.array(z.number().int()).min(1),
  limits: z.object({
    wall_clock_seconds: z.number().int().positive(),
    max_cost_usd: z.number().positive().optional(),
    max_model_calls: z.number().int().positive().optional(),
    max_disk_mb: z.number().int().positive().optional(),
  }),
});

export type ExperimentManifest = z.infer<typeof ExperimentManifestSchema>;

// ── Types ────────────────────────────────────────────────────────────────

export interface ExperimentRunRecord {
  config: RunConfiguration;
  result?: RunResult;
  error?: string;
  startedAt: string;
  completedAt: string;
}

export interface ExperimentSummary {
  experimentId: string;
  benchmark: string;
  benchmarkVersion: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  skippedRuns: number;
  erroredRuns: number;
  totalCostUsd: number;
  wallClockSeconds: number;
  runs: ExperimentRunRecord[];
  startedAt: string;
  completedAt: string;
  outputDir: string;
}

// ── ExperimentRunner ─────────────────────────────────────────────────────

export class ExperimentRunner {
  private manifest!: ExperimentManifest;
  private expandedConfigs: RunConfiguration[] = [];
  private readonly runner: Runner;

  constructor(runner?: Runner) {
    this.runner = runner ?? new Runner();
  }

  // ── Manifest Parsing ──────────────────────────────────────────────────

  /**
   * Load and validate a YAML experiment manifest.
   *
   * @param path - Path to the YAML manifest file.
   * @returns The validated ExperimentManifest.
   * @throws If the file cannot be read or the content fails schema validation.
   */
  parseManifest(path: string): ExperimentManifest {
    let raw: string;
    try {
      raw = readFileSync(path, "utf-8");
    } catch (err: unknown) {
      throw new Error(
        `Failed to read manifest at ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err: unknown) {
      throw new Error(
        `Failed to parse YAML manifest at ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const result = ExperimentManifestSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map(
          (i) => `  [${i.path.join(".")}] ${i.message} (${i.code})`,
        )
        .join("\n");
      throw new Error(
        `Experiment manifest validation failed:\n${issues}`,
      );
    }

    this.manifest = result.data;
    return this.manifest;
  }

  // ── Matrix Expansion ──────────────────────────────────────────────────

  /**
   * Expand the manifest's model x harness x profile x seed matrix into
   * an array of RunConfiguration objects.
   *
   * Each combination produces one RunConfiguration with a generated UUID
   * and a display-friendly runId.
   *
   * @returns Array of RunConfiguration objects for every cell in the matrix.
   */
  expandMatrix(): RunConfiguration[] {
    if (!this.manifest) {
      throw new Error(
        "Cannot expand matrix: no manifest loaded. Call parseManifest() first.",
      );
    }

    const configs: RunConfiguration[] = [];

    for (const profile of this.manifest.profiles) {
      for (const modelDef of this.manifest.models) {
        for (const harnessId of this.manifest.harnesses) {
          for (const seed of this.manifest.seeds) {
            const uid = randomUUID();
            const runId = `${this.manifest.id}-${profile}-${modelDef.model.replace(/[^a-zA-Z0-9_-]/g, "_")}-${harnessId}-${seed}`;

            const limits: RunLimits = {
              wallClockSeconds:
                this.manifest.limits.wall_clock_seconds,
              maxCostUsd: this.manifest.limits.max_cost_usd,
            };

            if (this.manifest.limits.max_model_calls !== undefined) {
              limits.maxModelCalls =
                this.manifest.limits.max_model_calls;
            }
            if (this.manifest.limits.max_disk_mb !== undefined) {
              limits.maxDiskMb = this.manifest.limits.max_disk_mb;
            }

            const config: RunConfiguration = {
              runId: uid,
              benchmarkVersion: this.manifest.benchmark_version,
              applicationId: this.manifest.benchmark,
              profile: profile,
              harness: { id: harnessId },
              model: {
                provider: modelDef.provider,
                model: modelDef.model,
                seed: seed,
              },
              seed: seed,
              limits,
            };

            configs.push(config);
          }
        }
      }
    }

    this.expandedConfigs = configs;
    return configs;
  }

  // ── Execution ─────────────────────────────────────────────────────────

  /**
   * Execute all expanded run configs sequentially, using the provided
   * harness map to resolve harness IDs to AgentHarness instances.
   *
   * - Runs are executed one at a time (sequential).
   * - If a run result directory already exists (by runId), the run is
   *   skipped (resume / completed-skip behavior).
   * - A single failed run does NOT terminate the experiment; errors are
   *   captured and reported in the summary.
   *
   * @param harnessMap  - Record mapping harness ID (e.g. "codex") to an
   *                      AgentHarness instance.
   * @param outputDir   - Directory where experiment results are stored.
   *                      Defaults to "experiments/output/<manifest-id>".
   * @returns An ExperimentSummary with per-run records and aggregate stats.
   */
  async execute(
    harnessMap: Record<string, AgentHarness>,
    outputDir?: string,
  ): Promise<ExperimentSummary> {
    if (this.expandedConfigs.length === 0) {
      throw new Error(
        "No run configs to execute. Call expandMatrix() first.",
      );
    }

    const outDir =
      outputDir ??
      resolve(
        process.cwd(),
        "experiments",
        "output",
        this.manifest.id,
      );

    if (!existsSync(outDir)) {
      mkdirSync(outDir, { recursive: true });
    }

    const startedAt = new Date().toISOString();
    const runRecords: ExperimentRunRecord[] = [];
    let totalCostUsd = 0;

    for (const config of this.expandedConfigs) {
      const runDir = join(outDir, config.runId);
      const resultPath = join(runDir, "run-result.json");
      const recordPath = join(runDir, "experiment-record.json");

      // ── Skip if already completed ────────────────────────────────
      if (
        existsSync(resultPath) &&
        existsSync(recordPath)
      ) {
        try {
          const existingRaw = readFileSync(recordPath, "utf-8");
          const existing = JSON.parse(existingRaw) as ExperimentRunRecord;
          if (existing.config.runId === config.runId) {
            runRecords.push(existing);
            if (existing.result?.metrics.estimatedCostUsd) {
              totalCostUsd +=
                existing.result.metrics.estimatedCostUsd;
            }
            continue;
          }
        } catch {
          // Corrupted record; re-run
        }
      }

      // ── Resolve harness ──────────────────────────────────────────
      const harness = harnessMap[config.harness.id];
      if (!harness) {
        const runStartedAt = new Date().toISOString();
        const runCompletedAt = new Date().toISOString();
        const record: ExperimentRunRecord = {
          config,
          error: `No harness registered for ID "${config.harness.id}". Available: ${Object.keys(harnessMap).join(", ")}`,
          startedAt: runStartedAt,
          completedAt: runCompletedAt,
        };
        runRecords.push(record);
        continue;
      }

      // ── Execute run ──────────────────────────────────────────────
      const runStartedAt = new Date().toISOString();
      let result: RunResult | undefined;
      let error: string | undefined;

      try {
        result = await this.runner.run(config, harness);
      } catch (err: unknown) {
        error =
          err instanceof Error ? err.message : String(err);
      }

      const runCompletedAt = new Date().toISOString();
      const record: ExperimentRunRecord = {
        config,
        result,
        error,
        startedAt: runStartedAt,
        completedAt: runCompletedAt,
      };

      // ── Persist record ───────────────────────────────────────────
      if (!existsSync(runDir)) {
        mkdirSync(runDir, { recursive: true });
      }
      writeFileSync(
        recordPath,
        JSON.stringify(record, null, 2),
        "utf-8",
      );

      runRecords.push(record);
      if (result?.metrics.estimatedCostUsd) {
        totalCostUsd += result.metrics.estimatedCostUsd;
      }
    }

    const completedAt = new Date().toISOString();

    // ── Aggregate summary ──────────────────────────────────────────
    const completedRuns = runRecords.filter(
      (r) => r.result?.status === "completed",
    ).length;
    const failedRuns = runRecords.filter(
      (r) =>
        r.result?.status === "failed" ||
        r.result?.status === "budget_exhausted",
    ).length;
    const erroredRuns = runRecords.filter((r) => r.error).length;
    const skippedRuns = runRecords.filter(
      (r) => !r.result && !r.error,
    ).length;

    const summary: ExperimentSummary = {
      experimentId: this.manifest.id,
      benchmark: this.manifest.benchmark,
      benchmarkVersion: this.manifest.benchmark_version,
      totalRuns: runRecords.length,
      completedRuns,
      failedRuns,
      skippedRuns,
      erroredRuns,
      totalCostUsd,
      wallClockSeconds:
        (new Date(completedAt).getTime() -
          new Date(startedAt).getTime()) /
        1000,
      runs: runRecords,
      startedAt,
      completedAt,
      outputDir: outDir,
    };

    // ── Write experiment summary ───────────────────────────────────
    const summaryPath = join(outDir, "experiment-summary.json");
    writeFileSync(
      summaryPath,
      JSON.stringify(summary, null, 2),
      "utf-8",
    );

    return summary;
  }
}
