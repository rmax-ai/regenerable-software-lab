// @rsl/cli — rsl run command
// Execute a single benchmark run

import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseRunConfig } from "@rsl/benchmark-core";
import { Runner } from "@rsl/runner";

// Minimal inline harness for CLI-driven runs.
// In production, users supply a harness adapter module.
/* eslint-disable @typescript-eslint/no-explicit-any */
const INLINE_HARNESS = {
  id: "cli-inline",
  version: "0.1.0",
  async prepare(input: any): Promise<any> {
    return { runId: input.runId, workspacePath: input.workspacePath };
  },
  async execute(input: any): Promise<any> {
    return {
      status: "completed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      exitCode: 0,
      reportedCompletion: true,
    };
  },
  async terminate(_runId: string): Promise<void> {},
  async collectArtifacts(_runId: string): Promise<any> {
    return { files: [] };
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export const runCommand = new Command("run")
  .description("Run a single benchmark")
  .argument("<benchmark-id>", "Benchmark identifier to execute")
  .requiredOption(
    "-h, --harness <module>",
    "Harness adapter module path (requires default export implementing AgentHarness)",
  )
  .option(
    "-c, --config <path>",
    "Path to run configuration JSON file (overrides other options if provided)",
  )
  .option("-s, --seed <number>", "Random seed for reproducibility")
  .option("--model <provider>", "Model provider (e.g. openai, anthropic)")
  .option("--model-name <name>", "Model name (e.g. gpt-4o, claude-3-opus)")
  .option("--wall-clock <seconds>", "Wall clock limit in seconds", "600")
  .option("--verbose", "Enable verbose logging", false)
  .action(async (benchmarkId: string, options: Record<string, unknown>) => {
    try {
      let configRaw: Record<string, unknown>;

      if (options.config && typeof options.config === "string") {
        // Load config from file
        const configPath = resolve(options.config);
        if (!existsSync(configPath)) {
          console.error(`rsl run: config file not found: ${configPath}`);
          process.exitCode = 1;
          return;
        }
        configRaw = JSON.parse(readFileSync(configPath, "utf-8"));
      } else {
        // Build config from CLI options
        const seed = options.seed
          ? Number(options.seed)
          : Math.floor(Math.random() * 2147483647);
        const wallClockSeconds = Number(options.wallClock) || 600;

        configRaw = {
          runId: crypto.randomUUID(),
          benchmarkVersion: benchmarkId,
          applicationId: benchmarkId,
          profile: "basic",
          harness: {
            id: (options.model as string) ?? "default",
          },
          model: {
            provider: (options.model as string) ?? "unknown",
            model: (options.modelName as string) ?? "default",
            seed,
          },
          seed,
          limits: {
            wallClockSeconds,
          },
        };
      }

      const config = parseRunConfig(configRaw);
      const runner = new Runner();

      if (options.verbose) {
        console.error("rsl run: starting benchmark", benchmarkId);
        console.error("rsl run: runId:", config.runId);
      }

      let harness: any;

      if (typeof options.harness === "string") {
        const harnessPath = resolve(options.harness);
        if (!existsSync(harnessPath)) {
          console.error(
            `rsl run: harness module not found: ${harnessPath}`,
          );
          process.exitCode = 1;
          return;
        }
        const harnessModule = await import(harnessPath);
        harness = harnessModule.default ?? harnessModule;
      } else {
        console.error(
          "rsl run: warning: no harness specified, using inline no-op harness",
        );
        harness = INLINE_HARNESS;
      }

      const result = await runner.run(config, harness);

      if (options.verbose) {
        console.error("rsl run: status:", result.status);
        console.error(
          "rsl run: verification:",
          result.metrics.verificationPassed ? "passed" : "failed",
        );
      }

      console.log(JSON.stringify(result, null, 2));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("rsl run: error:", message);
      process.exitCode = 1;
    }
  });
