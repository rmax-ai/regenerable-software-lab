// @rsl/cli — rsl report command
// Display or export benchmark run reports

import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface RunReport {
  runId: string;
  status: string;
  startedAt: string;
  completedAt: string;
  metrics: Record<string, unknown>;
  verificationResults: Array<{
    stage: string;
    status: string;
    failureCategory?: string;
  }>;
  executionStatus?: string;
}

function loadReport(pathOrId: string): RunReport {
  const resolvedPath = resolve(pathOrId);

  if (existsSync(resolvedPath)) {
    return JSON.parse(readFileSync(resolvedPath, "utf-8")) as RunReport;
  }

  const reportPath = resolve(pathOrId, "artifacts", "run-report.json");
  if (existsSync(reportPath)) {
    return JSON.parse(readFileSync(reportPath, "utf-8")) as RunReport;
  }

  console.error(
    `rsl report: cannot find report at ${resolvedPath} or ${reportPath}`,
  );
  process.exit(1);
}

export const reportCommand = new Command("report")
  .description("Display or export a benchmark run report")
  .argument("<path>", "Path to run-report.json or run workspace directory")
  .option(
    "-o, --output <path>",
    "Write report to file instead of stdout",
  )
  .option(
    "--format <format>",
    "Output format: json or summary",
    "json",
  )
  .action(async (reportArg: string, options: Record<string, unknown>) => {
    try {
      const report = loadReport(reportArg);
      const format = (options.format as string) ?? "json";

      if (format === "summary") {
        const passed = report.verificationResults.filter(
          (v) => v.status === "passed",
        ).length;
        const failed = report.verificationResults.filter(
          (v) => v.status === "failed" || v.status === "error",
        ).length;
        const skipped = report.verificationResults.filter(
          (v) => v.status === "skipped",
        ).length;

        const summary = [
          `Run ID:     ${report.runId}`,
          `Status:     ${report.status}`,
          `Started:    ${report.startedAt}`,
          `Completed:  ${report.completedAt}`,
          `Execution:  ${report.executionStatus ?? "unknown"}`,
          `Verification:`,
          `  Passed:   ${passed}`,
          `  Failed:   ${failed}`,
          `  Skipped:  ${skipped}`,
          `Metrics:`,
        ];

        if (report.metrics) {
          for (const [key, value] of Object.entries(report.metrics)) {
            summary.push(`  ${key}: ${String(value)}`);
          }
        }

        summary.push("");
        summary.push("Verification Stages:");
        for (const v of report.verificationResults) {
          summary.push(
            `  ${v.stage}: ${v.status}${v.failureCategory ? ` (${v.failureCategory})` : ""}`,
          );
        }

        const output = summary.join("\n");

        if (options.output && typeof options.output === "string") {
          const outputPath = resolve(options.output);
          writeFileSync(outputPath, output, "utf-8");
          console.error(
            `rsl report: summary written to ${outputPath}`,
          );
        } else {
          console.log(output);
        }
      } else {
        const output = JSON.stringify(report, null, 2);

        if (options.output && typeof options.output === "string") {
          const outputPath = resolve(options.output);
          writeFileSync(outputPath, output, "utf-8");
          console.error(
            `rsl report: report written to ${outputPath}`,
          );
        } else {
          console.log(output);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("rsl report: error:", message);
      process.exitCode = 1;
    }
  });
