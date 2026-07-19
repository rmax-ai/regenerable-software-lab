#!/usr/bin/env node

// @rsl/cli — rsl CLI entry point
// Regenerable Software Lab benchmark runner

import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { verifyCommand } from "./commands/verify.js";
import { compareCommand } from "./commands/compare.js";
import { experimentCommand } from "./commands/experiment.js";
import { reportCommand } from "./commands/report.js";
import { traceCommand } from "./commands/trace.js";

const program = new Command();

program
  .name("rsl")
  .description("Regenerable Software Lab benchmark runner")
  .version("0.1.0")
  .addCommand(runCommand)
  .addCommand(verifyCommand)
  .addCommand(compareCommand)
  .addCommand(experimentCommand)
  .addCommand(reportCommand)
  .addCommand(traceCommand);

program.parseAsync().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("rsl: fatal error:", message);
  process.exitCode = 1;
});
