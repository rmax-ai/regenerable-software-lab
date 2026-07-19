// @rsl/cli — rsl compare command
// Compare two benchmark run results

import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
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

  // Assume it's a run directory with the standard report path
  const reportPath = resolve(
    pathOrId,
    "artifacts",
    "run-report.json",
  );
  if (existsSync(reportPath)) {
    return JSON.parse(readFileSync(reportPath, "utf-8")) as RunReport;
  }

  console.error(
    `rsl compare: cannot find report at ${resolvedPath} or ${reportPath}`,
  );
  process.exit(1);
}

export const compareCommand = new Command("compare")
  .description("Compare two benchmark run results")
  .argument("<run-a>", "First run ID, report path, or workspace path")
  .argument("<run-b>", "Second run ID, report path, or workspace path")
  .option("--verbose", "Print detailed comparison", false)
  .action(
    async (
      runA: string,
      runB: string,
      options: Record<string, unknown>,
    ) => {
      try {
        const reportA = loadReport(runA);
        const reportB = loadReport(runB);

        const comparison = {
          runA: {
            runId: reportA.runId,
            status: reportA.status,
            executionStatus: reportA.executionStatus,
            metrics: reportA.metrics,
          },
          runB: {
            runId: reportB.runId,
            status: reportB.status,
            executionStatus: reportB.executionStatus,
            metrics: reportB.metrics,
          },
          differences: {
            statusChanged: reportA.status !== reportB.status,
            verificationChanged:
              reportA.verificationResults.length !==
              reportB.verificationResults.length,
            stageDiffs: [] as Array<{
              stage: string;
              statusA: string;
              statusB: string;
            }>,
          },
        };

        // Compare verification stages by name
        const stagesA = new Map(
          reportA.verificationResults.map((v) => [v.stage, v]),
        );
        const stagesB = new Map(
          reportB.verificationResults.map((v) => [v.stage, v]),
        );

        const allStages = new Set([
          ...stagesA.keys(),
          ...stagesB.keys(),
        ]);
        for (const stage of allStages) {
          const a = stagesA.get(stage);
          const b = stagesB.get(stage);
          if (a?.status !== b?.status) {
            comparison.differences.stageDiffs.push({
              stage,
              statusA: a?.status ?? "missing",
              statusB: b?.status ?? "missing",
            });
          }
        }

        if (options.verbose) {
          console.error("rsl compare: comparison details:");
          console.error(
            `  ${reportA.runId}: ${reportA.status}`,
          );
          console.error(
            `  ${reportB.runId}: ${reportB.status}`,
          );
          if (comparison.differences.stageDiffs.length > 0) {
            console.error("  Verification stage differences:");
            for (const d of comparison.differences.stageDiffs) {
              console.error(
                `    ${d.stage}: ${d.statusA} -> ${d.statusB}`,
              );
            }
          }
        }

        console.log(JSON.stringify(comparison, null, 2));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("rsl compare: error:", message);
        process.exitCode = 1;
      }
    },
  );
