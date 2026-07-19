// @rsl/cli — rsl experiment command
// Run an experiment: execute multiple benchmark runs from a config

import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { parseRunConfig } from "@rsl/benchmark-core";
import { Runner } from "@rsl/runner";

const ExperimentConfigSchema = z.object({
  name: z.string().optional(),
  runs: z.array(z.unknown()).min(1),
  parallel: z.boolean().optional().default(false),
});

export const experimentCommand = new Command("experiment")
  .description("Run an experiment with multiple benchmark configurations")
  .argument("<config-path>", "Path to experiment configuration JSON file")
  .option("--verbose", "Enable verbose logging", false)
  .action(async (configPath: string, options: Record<string, unknown>) => {
    try {
      const absPath = resolve(configPath);
      if (!existsSync(absPath)) {
        console.error(
          `rsl experiment: config file not found: ${absPath}`,
        );
        process.exitCode = 1;
        return;
      }

      const rawConfig = JSON.parse(readFileSync(absPath, "utf-8"));
      const parsed = ExperimentConfigSchema.safeParse(rawConfig);

      if (!parsed.success) {
        console.error(
          "rsl experiment: invalid experiment config:",
          JSON.stringify(parsed.error.flatten(), null, 2),
        );
        process.exitCode = 1;
        return;
      }

      const experimentConfig = parsed.data;
      const runner = new Runner();
      const results = [];
      const startTime = Date.now();

      if (options.verbose) {
        console.error(
          `rsl experiment: starting "${experimentConfig.name ?? "unnamed"}"`,
        );
        console.error(
          `rsl experiment: ${experimentConfig.runs.length} runs`,
        );
      }

      // Inline no-op harness for basic experiments
      const harness = {
        id: "cli-experiment",
        version: "0.1.0",
        /* eslint-disable @typescript-eslint/no-explicit-any */
        async prepare(input: any): Promise<any> {
          return {
            runId: input.runId,
            workspacePath: input.workspacePath,
          };
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
        /* eslint-enable @typescript-eslint/no-explicit-any */
      };

      if (experimentConfig.parallel) {
        const runPromises = experimentConfig.runs.map(
          async (runRaw: unknown, index: number) => {
            try {
              const config = parseRunConfig(runRaw);
              if (options.verbose) {
                console.error(
                  `rsl experiment: starting run ${index + 1}: ${config.runId}`,
                );
              }
              return await runner.run(config, harness);
            } catch (err: unknown) {
              const message =
                err instanceof Error ? err.message : String(err);
              return {
                runId: `error-${index}`,
                status: "error" as const,
                error: message,
              };
            }
          },
        );
        const parallelResults = await Promise.all(runPromises);
        results.push(...parallelResults);
      } else {
        for (let i = 0; i < experimentConfig.runs.length; i++) {
          try {
            const config = parseRunConfig(experimentConfig.runs[i]);
            if (options.verbose) {
              console.error(
                `rsl experiment: run ${i + 1}/${experimentConfig.runs.length}: ${config.runId}`,
              );
            }
            const result = await runner.run(config, harness);
            results.push(result);
          } catch (err: unknown) {
            const message =
              err instanceof Error ? err.message : String(err);
            console.error(
              `rsl experiment: run ${i + 1} failed: ${message}`,
            );
            results.push({
              runId: `error-${i}`,
              status: "error",
              error: message,
            });
          }
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const passed = results.filter(
        (r: any) => r.status === "completed",
      ).length;

      if (options.verbose) {
        console.error(
          `rsl experiment: completed in ${elapsed}s — ${passed}/${results.length} passed`,
        );
      }

      const experimentOutput = {
        name: experimentConfig.name ?? "unnamed",
        elapsedSeconds: Number(elapsed),
        totalRuns: results.length,
        passedRuns: passed,
        failedRuns: results.length - passed,
        results,
      };

      console.log(JSON.stringify(experimentOutput, null, 2));

      if (passed < results.length) {
        process.exitCode = 1;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("rsl experiment: error:", message);
      process.exitCode = 1;
    }
  });
