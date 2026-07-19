// @rsl/cli — rsl verify command
// Run the evaluator verification pipeline against an existing workspace

import { Command } from "commander";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Evaluator, PROFILE_A_STAGES } from "@rsl/evaluator";

export const verifyCommand = new Command("verify")
  .description("Run verification against a workspace")
  .argument("<workspace-path>", "Path to the run workspace directory")
  .option("--source-dir <name>", "Source subdirectory name", "source")
  .option("--verbose", "Enable verbose logging", false)
  .action(async (workspacePath: string, options: Record<string, unknown>) => {
    try {
      const absPath = resolve(workspacePath);
      if (!existsSync(absPath)) {
        console.error(
          `rsl verify: workspace not found: ${absPath}`,
        );
        process.exitCode = 1;
        return;
      }

      const sourceDirName = (options.sourceDir as string) ?? "source";
      const sourceDir = join(absPath, sourceDirName);

      if (!existsSync(sourceDir)) {
        console.error(
          `rsl verify: source directory not found: ${sourceDir}`,
        );
        process.exitCode = 1;
        return;
      }

      if (options.verbose) {
        console.error("rsl verify: running verification on", sourceDir);
        console.error(
          "rsl verify: stages:",
          PROFILE_A_STAGES.join(", "),
        );
      }

      const evaluator = new Evaluator(sourceDir);
      const results = await evaluator.evaluate(PROFILE_A_STAGES);

      const passed = results.filter((r) => r.status === "passed").length;
      const failed = results.filter(
        (r) => r.status === "failed" || r.status === "error",
      ).length;
      const skipped = results.filter((r) => r.status === "skipped").length;

      if (options.verbose) {
        console.error(
          `rsl verify: ${passed} passed, ${failed} failed, ${skipped} skipped`,
        );
      }

      console.log(JSON.stringify(results, null, 2));

      if (failed > 0) {
        process.exitCode = 1;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("rsl verify: error:", message);
      process.exitCode = 1;
    }
  });
