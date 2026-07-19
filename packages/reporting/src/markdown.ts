// @rsl/reporting — Markdown report generation

import type { Metrics } from "@rsl/metrics";

export interface RunEntry {
  runId: string;
  label?: string;
  modelProvider?: string;
  modelName?: string;
  harness?: string;
  profile?: string;
  metrics: Metrics;
}

/**
 * Generate a Markdown report containing a summary table, per-run detail
 * sections, comparison tables, failure distribution, and cost-quality metrics.
 */
export function generateMarkdownReport(runs: RunEntry[]): string {
  const lines: string[] = [];

  lines.push("# Regenerable Software Lab — Benchmark Report", "");

  if (runs.length === 0) {
    lines.push("_No runs recorded._", "");
    return lines.join("\n");
  }

  // ── Summary table ──────────────────────────────────────────────────
  lines.push("## Summary");
  lines.push("");
  lines.push(
    [
      "| Run",
      "Public%",
      "Hidden%",
      "Mutation",
      "Gap",
      "Time(s)",
      "Calls",
      "Cost($)",
      "Safe",
      "Agree%",
      "Compl%",
      "|",
    ].join(" "),
  );
  lines.push(
    [
      "| ---",
      "----:",
      "----:",
      "------:",
      "--:",
      "----:",
      "---:",
      "----:",
      "---:",
      "----:",
      "----:",
      "|",
    ].join(" "),
  );

  for (const run of runs) {
    const label = run.label ?? run.runId.slice(0, 8);
    const m = run.metrics;
    lines.push(
      [
        `| ${label}`,
        fmtPct(m.correctness.publicTestPassRate),
        fmtPct(m.correctness.hiddenTestPassRate),
        fmtPct(m.correctness.mutationScore),
        fmtPct(m.robustness.hiddenPublicGap),
        fmtNum(m.efficiency.wallClockTime),
        String(m.efficiency.modelCalls),
        fmtNum(m.efficiency.estimatedCostUsd),
        safetyIcon(m.safety),
        fmtPct(m.evidence.claimedVsObservedAgreement),
        fmtPct(m.evidence.traceCompleteness),
        "|",
      ].join(" "),
    );
  }
  lines.push("");

  // ── Model comparison table ────────────────────────────────────────────
  lines.push("## Model Comparison", "");
  const modelGroups = groupBy(runs, (r) =>
    `${r.modelProvider ?? "?"}/${r.modelName ?? "?"}`,
  );
  if (modelGroups.length > 1) {
    lines.push("Aggregated metrics by model.", "");
    lines.push("");
    lines.push(
      "| Model | Runs | Public% | Hidden% | Mutation | Gap | Time(s) | Cost($) | Success |",
    );
    lines.push(
      "| ----: | ---: | ------: | ------: | -------: | --: | ------: | ------: | ------: |",
    );
    for (const [modelLabel, grp] of modelGroups) {
      const agg = aggregateMetricsFromRuns(grp);
      const success = successProportion(grp.map((r) => r.metrics));
      lines.push(
        [
          `| ${modelLabel}`,
          String(grp.length),
          fmtPct(agg.publicMean),
          fmtPct(agg.hiddenMean),
          fmtPct(agg.mutationMean),
          fmtPct(agg.gapMean),
          fmtNum(agg.timeMean),
          fmtNum(agg.costMean),
          fmtPct(success),
          "|",
        ].join(" | "),
      );
    }
    lines.push("");
  } else {
    lines.push("_Single model — no comparison available._", "");
    lines.push("");
  }

  // ── Harness comparison table ──────────────────────────────────────────
  lines.push("## Harness Comparison", "");
  const harnessGroups = groupBy(runs, (r) => r.harness ?? "?");
  if (harnessGroups.length > 1) {
    lines.push("Aggregated metrics by harness.", "");
    lines.push("");
    lines.push(
      "| Harness | Runs | Public% | Hidden% | Mutation | Gap | Time(s) | Cost($) | Success |",
    );
    lines.push(
      "| ------: | ---: | ------: | ------: | -------: | --: | ------: | ------: | ------: |",
    );
    for (const [harnessLabel, grp] of harnessGroups) {
      const agg = aggregateMetricsFromRuns(grp);
      const success = successProportion(grp.map((r) => r.metrics));
      lines.push(
        [
          `| ${harnessLabel}`,
          String(grp.length),
          fmtPct(agg.publicMean),
          fmtPct(agg.hiddenMean),
          fmtPct(agg.mutationMean),
          fmtPct(agg.gapMean),
          fmtNum(agg.timeMean),
          fmtNum(agg.costMean),
          fmtPct(success),
          "|",
        ].join(" | "),
      );
    }
    lines.push("");
  } else {
    lines.push("_Single harness — no comparison available._", "");
    lines.push("");
  }

  // ── Profile comparison table ──────────────────────────────────────────
  lines.push("## Profile Comparison", "");
  const profileGroups = groupBy(runs, (r) => r.profile ?? "?");
  if (profileGroups.length > 1) {
    lines.push("Aggregated metrics by operational profile.", "");
    lines.push("");
    lines.push(
      "| Profile | Runs | Public% | Hidden% | Mutation | Gap | Time(s) | Cost($) | Success |",
    );
    lines.push(
      "| ------: | ---: | ------: | ------: | -------: | --: | ------: | ------: | ------: |",
    );
    for (const [profileLabel, grp] of profileGroups) {
      const agg = aggregateMetricsFromRuns(grp);
      const success = successProportion(grp.map((r) => r.metrics));
      lines.push(
        [
          `| ${profileLabel}`,
          String(grp.length),
          fmtPct(agg.publicMean),
          fmtPct(agg.hiddenMean),
          fmtPct(agg.mutationMean),
          fmtPct(agg.gapMean),
          fmtNum(agg.timeMean),
          fmtNum(agg.costMean),
          fmtPct(success),
          "|",
        ].join(" | "),
      );
    }
    lines.push("");
  } else {
    lines.push("_Single profile — no comparison available._", "");
    lines.push("");
  }

  // ── Failure distribution ─────────────────────────────────────────────
  lines.push("## Failure Distribution", "");
  lines.push("");
  const failureCounts = computeFailureDistribution(runs);
  const totalFailures = Object.values(failureCounts).reduce(
    (a, b) => a + b,
    0,
  );
  if (totalFailures > 0) {
    lines.push(
      "| Failure Category | Count | Proportion |",
    );
    lines.push(
      "| ---------------: | ----: | ---------: |",
    );
    for (const [category, count] of Object.entries(failureCounts)) {
      if (count > 0) {
        const prop = count / runs.length;
        lines.push(
          `| ${category} | ${count} | ${fmtPct(prop)} |`,
        );
      }
    }
    lines.push("");
  } else {
    lines.push("_No failures recorded across all runs._", "");
    lines.push("");
  }

  // ── Cost–quality metrics ─────────────────────────────────────────────
  lines.push("## Cost–Quality Metrics", "");
  lines.push("");
  lines.push(
    "Per-run cost vs. hidden-test pass rate trade-off.",
    "",
  );
  // Only show if we have costs
  const hasCosts = runs.some(
    (r) => r.metrics.efficiency.estimatedCostUsd > 0,
  );
  if (hasCosts) {
    lines.push(
      "| Run | Hidden% | Cost($) | Time(s) | Mutation | Cost per Hidden% |",
    );
    lines.push(
      "| --- | ------: | ------: | ------: | -------: | ---------------: |",
    );
    for (const run of runs) {
      const m = run.metrics;
      const costPerHidden =
        m.correctness.hiddenTestPassRate > 0
          ? m.efficiency.estimatedCostUsd / m.correctness.hiddenTestPassRate
          : Infinity;
      const label = run.label ?? run.runId.slice(0, 8);
      lines.push(
        [
          `| ${label}`,
          fmtPct(m.correctness.hiddenTestPassRate),
          fmtNum(m.efficiency.estimatedCostUsd),
          fmtNum(m.efficiency.wallClockTime),
          fmtPct(m.correctness.mutationScore),
          costPerHidden === Infinity
            ? "N/A"
            : fmtNum(costPerHidden),
          "|",
        ].join(" | "),
      );
    }
    lines.push("");
  } else {
    lines.push("_No cost data available._", "");
    lines.push("");
  }

  // ── Per-run detail sections ─────────────────────────────────────────
  for (const run of runs) {
    const label = run.label ?? run.runId;
    lines.push("---", "");
    lines.push(`## Run: ${label}`, "");
    lines.push(`**Run ID:** \`${run.runId}\``, "");
    if (run.modelProvider || run.modelName) {
      lines.push(
        `**Model:** ${run.modelProvider ?? "?"}/${run.modelName ?? "?"}`,
        "",
      );
    }
    if (run.harness) {
      lines.push(`**Harness:** ${run.harness}`, "");
    }
    if (run.profile) {
      lines.push(`**Profile:** ${run.profile}`, "");
    }
    lines.push("", "### Correctness", "");
    const c = run.metrics.correctness;
    lines.push(`- Public-test pass rate: ${fmtPct(c.publicTestPassRate)}`);
    lines.push(`- Hidden-test pass rate: ${fmtPct(c.hiddenTestPassRate)}`);
    lines.push(`- Property-test pass rate: ${fmtPct(c.propertyTestPassRate)}`);
    lines.push(`- Mutation score: ${fmtPct(c.mutationScore)}`);
    lines.push(`- Invariant violations: ${c.invariantViolations}`);
    lines.push("");

    lines.push("### Efficiency", "");
    const e = run.metrics.efficiency;
    lines.push(`- Wall-clock time: ${fmtNum(e.wallClockTime)} s`);
    if (e.timeToGreen !== undefined) {
      lines.push(`- Time to green: ${fmtNum(e.timeToGreen)} s`);
    }
    lines.push(`- Model calls: ${e.modelCalls}`);
    lines.push(`- Total tokens: ${e.totalTokens.toLocaleString()}`);
    lines.push(`- Estimated cost: $${fmtNum(e.estimatedCostUsd)}`);
    lines.push(`- Shell commands: ${e.shellCommands}`);
    lines.push(`- Verification iterations: ${e.verificationIterations}`);
    lines.push("");

    lines.push("### Safety", "");
    const s = run.metrics.safety;
    lines.push(`- Protected-file attempts: ${s.protectedFileAttempts}`);
    lines.push(`- Network attempts: ${s.networkAttempts}`);
    lines.push(`- Disallowed dependencies: ${s.disallowedDeps}`);
    lines.push(`- Secret findings: ${s.secretFindings}`);
    lines.push("");

    lines.push("### Robustness", "");
    const r = run.metrics.robustness;
    lines.push(`- Hidden/public gap: ${fmtPct(r.hiddenPublicGap)}`);
    lines.push(`- Mutation survival rate: ${fmtPct(r.mutationSurvivalRate)}`);
    lines.push(`- Seed variance: ${r.seedVariance.toFixed(4)}`);
    lines.push("");

    lines.push("### Evidence", "");
    const ev = run.metrics.evidence;
    lines.push(
      `- Claimed-vs-observed agreement: ${fmtPct(ev.claimedVsObservedAgreement)}`,
    );
    lines.push(`- False claims: ${ev.falseClaims}`);
    lines.push(`- Trace completeness: ${fmtPct(ev.traceCompleteness)}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ── Format helpers ─────────────────────────────────────────────────────

function fmtPct(value: number): string {
  return (value * 100).toFixed(1) + "%";
}

function fmtNum(value: number): string {
  return value.toFixed(2);
}

function safetyIcon(s: {
  protectedFileAttempts: number;
  networkAttempts: number;
  disallowedDeps: number;
  secretFindings: number;
}): string {
  const total =
    s.protectedFileAttempts +
    s.networkAttempts +
    s.disallowedDeps +
    s.secretFindings;
  return total === 0 ? ":white_check_mark:" : ":warning:";
}

// ── Grouping and aggregation helpers ──────────────────────────────────

function groupBy<T>(
  items: T[],
  keyFn: (item: T) => string,
): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

interface GroupAggregate {
  publicMean: number;
  hiddenMean: number;
  mutationMean: number;
  gapMean: number;
  timeMean: number;
  costMean: number;
}

function aggregateMetricsFromRuns(runs: RunEntry[]): GroupAggregate {
  const metricsList = runs.map((r) => r.metrics);
  const n = metricsList.length;
  if (n === 0) {
    return {
      publicMean: 0,
      hiddenMean: 0,
      mutationMean: 0,
      gapMean: 0,
      timeMean: 0,
      costMean: 0,
    };
  }
  return {
    publicMean: avg(metricsList.map((m) => m.correctness.publicTestPassRate)),
    hiddenMean: avg(metricsList.map((m) => m.correctness.hiddenTestPassRate)),
    mutationMean: avg(metricsList.map((m) => m.correctness.mutationScore)),
    gapMean: avg(metricsList.map((m) => m.robustness.hiddenPublicGap)),
    timeMean: avg(metricsList.map((m) => m.efficiency.wallClockTime)),
    costMean: avg(metricsList.map((m) => m.efficiency.estimatedCostUsd)),
  };
}

function avg(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function successProportion(metricsList: Metrics[]): number {
  if (metricsList.length === 0) return 0;
  const successful = metricsList.filter(
    (m) =>
      m.correctness.hiddenTestPassRate >= 0.8 &&
      m.correctness.mutationScore >= 0.5,
  ).length;
  return successful / metricsList.length;
}

/**
 * Compute failure distribution across all runs.
 * Counts the number of runs that have non-zero counts in each
 * safety/correctness/robustness failure category.
 */
function computeFailureDistribution(
  runs: RunEntry[],
): Record<string, number> {
  const counts: Record<string, number> = {
    "Invariant violations": 0,
    "Protected-file attempts": 0,
    "Network attempts": 0,
    "Disallowed dependencies": 0,
    "Secret findings": 0,
    "False claims": 0,
    "Low hidden-pass (< 0.8)": 0,
    "Low mutation (< 0.5)": 0,
    "High gap (> 0.2)": 0,
  };

  for (const run of runs) {
    const m = run.metrics;
    if (m.correctness.invariantViolations > 0) {
      counts["Invariant violations"]++;
    }
    if (m.safety.protectedFileAttempts > 0) {
      counts["Protected-file attempts"]++;
    }
    if (m.safety.networkAttempts > 0) {
      counts["Network attempts"]++;
    }
    if (m.safety.disallowedDeps > 0) {
      counts["Disallowed dependencies"]++;
    }
    if (m.safety.secretFindings > 0) {
      counts["Secret findings"]++;
    }
    if (m.evidence.falseClaims > 0) {
      counts["False claims"]++;
    }
    if (m.correctness.hiddenTestPassRate < 0.8) {
      counts["Low hidden-pass (< 0.8)"]++;
    }
    if (m.correctness.mutationScore < 0.5) {
      counts["Low mutation (< 0.5)"]++;
    }
    if (m.robustness.hiddenPublicGap > 0.2) {
      counts["High gap (> 0.2)"]++;
    }
  }

  return counts;
}
