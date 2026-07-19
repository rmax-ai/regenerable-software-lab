// @rsl/cli — rsl run command
// Execute a single benchmark run

import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseRunConfig } from "@rsl/benchmark-core";
import { Runner } from "@rsl/runner";

// ── Built-in harness registry ──────────────────────────────────────────

/** Map harness IDs to their adapter module paths (relative to repo packages). */
const HARNESS_REGISTRY: Record<string, string> = {
  fake: "@rsl/harness-fake",
  codex: "@rsl/harness-codex",
  "generic-cli": "@rsl/harness-generic-cli",
  claude: "@rsl/harness-claude-code",
};

async function resolveHarness(
  harnessId?: string,
  harnessModule?: string,
): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (harnessModule) {
    const harnessPath = resolve(harnessModule);
    if (!existsSync(harnessPath)) {
      throw new Error(`Harness module not found: ${harnessPath}`);
    }
    const mod = await import(harnessPath);
    return mod.default ?? mod;
  }

  if (harnessId) {
    const packageName = HARNESS_REGISTRY[harnessId];
    if (!packageName) {
      throw new Error(
        `Unknown harness "${harnessId}". Available: ${Object.keys(HARNESS_REGISTRY).join(", ")}`,
      );
    }
    try {
      const mod = await import(packageName);
      // Each harness adapter exports a named class; find it
      const adapterClass = Object.values(mod).find(
        (v) => typeof v === "function" && v.prototype?.prepare,
      );
      if (adapterClass) {
        return new (adapterClass as new () => any)();
      }
      // Fallback: try default export
      if (mod.default && typeof mod.default === "function") {
        return new (mod.default as new () => any)();
      }
      throw new Error(`No harness adapter class found in ${packageName}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load harness "${harnessId}" (${packageName}): ${msg}`);
    }
  }

  // Fallback to inline no-op harness
  console.error(
    "rsl run: warning: no harness specified, using inline no-op harness",
  );
  return INLINE_HARNESS;
}

// Minimal inline harness for smoke testing.
/* eslint-disable @typescript-eslint/no-explicit-any */
const INLINE_HARNESS = {
  id: "cli-inline",
  version: "0.1.0",
  async prepare(input: any): Promise<any> {
    return { runId: input.runId, workspacePath: input.workspacePath };
  },
  async execute(_input: any): Promise<any> {
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

// ── Command ────────────────────────────────────────────────────────────

export const runCommand = new Command("run")
  .description("Run a single benchmark")
  .argument("<benchmark-id>", "Benchmark identifier to execute")
  .option(
    "--harness-id <name>",
    `Named harness adapter (${Object.keys(HARNESS_REGISTRY).join("|")})`,
  )
  .option(
    "--harness <module>",
    "Harness adapter module path (overrides --harness-id)",
  )
  .option(
    "-c, --config <path>",
    "Path to run configuration JSON file (overrides other options if provided)",
  )
  .option("-s, --seed <number>", "Random seed for reproducibility")
  .option("--model <provider>", "Model provider (e.g. openai, anthropic)")
  .option("--model-name <name>", "Model name (e.g. gpt-4o, claude-3-opus)")
  .option(
    "--profile <profile>",
    "Verification profile (basic|behavioral|operational)",
    "basic",
  )
  .option("--wall-clock <seconds>", "Wall clock limit in seconds", "600")
  .option("--verbose", "Enable verbose logging", false)
  .action(
    async (benchmarkId: string, options: Record<string, unknown>) => {
      try {
        let configRaw: Record<string, unknown>;

        if (options.config && typeof options.config === "string") {
          const configPath = resolve(options.config);
          if (!existsSync(configPath)) {
            console.error(`rsl run: config file not found: ${configPath}`);
            process.exitCode = 1;
            return;
          }
          configRaw = JSON.parse(readFileSync(configPath, "utf-8"));
        } else {
          const seed = options.seed
            ? Number(options.seed)
            : Math.floor(Math.random() * 2147483647);
          const wallClockSeconds = Number(options.wallClock) || 600;

          configRaw = {
            runId: crypto.randomUUID(),
            benchmarkVersion: benchmarkId,
            applicationId: benchmarkId,
            profile: (options.profile as string) ?? "basic",
            harness: {
              id: (options.harnessId as string) ?? "inline",
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

        const harness = await resolveHarness(
          options.harnessId as string | undefined,
          options.harness as string | undefined,
        );

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
    },
  );
