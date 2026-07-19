// @rsl/reporting — Comparison report generation

import type { Metrics } from "@rsl/metrics";

export interface ComparisonRun {
  runId: string;
  label?: string;
  modelProvider: string;
  modelName: string;
  harness: string;
  profile: string;
  metrics: Metrics;
}

export interface ComparisonGroup {
  /** Display label for this group (e.g. "GPT-4o / basic / default"). */
  label: string;
  runs: ComparisonRun[];
}

/**
 * Generate a comparison report that groups runs by model x harness x
 * profile and shows aggregated metrics per group.
 */
export function generateComparisonReport(
  groups: ComparisonGroup[],
): string {
  const lines: string[] = [];

  lines.push("# Comparison Report", "");
  lines.push(
    "Aggregated results grouped by model configuration, harness, and profile.",
    "",
  );

  if (groups.length === 0) {
    lines.push("_No groups to compare._", "");
    return lines.join("\n");
  }

  for (const group of groups) {
    if (group.runs.length === 0) continue;

    lines.push(`## ${group.label}`, "");
    lines.push(
      `**Runs:** ${group.runs.length}  `,
      "",
    );

    // Aggregate metrics across runs in this group
    const agg = aggregateMetrics(group.runs.map((r) => r.metrics));

    lines.push("### Aggregated Metrics", "");
    lines.push("");
    lines.push("| Metric | Mean | Min | Max | StdDev |");
    lines.push("| ------ | ---: | --: | --: | -----: |");

    const rows: [string, number, number, number, number][] = [
      ["Public test pass rate", agg.publicMean, agg.publicMin, agg.publicMax, agg.publicStd],
      ["Hidden test pass rate", agg.hiddenMean, agg.hiddenMin, agg.hiddenMax, agg.hiddenStd],
      ["Mutation score", agg.mutationMean, agg.mutationMin, agg.mutationMax, agg.mutationStd],
      ["Hidden/public gap", agg.gapMean, agg.gapMin, agg.gapMax, agg.gapStd],
      ["Wall-clock time (s)", agg.timeMean, agg.timeMin, agg.timeMax, agg.timeStd],
      ["Model calls", agg.callsMean, agg.callsMin, agg.callsMax, agg.callsStd],
      ["Cost ($)", agg.costMean, agg.costMin, agg.costMax, agg.costStd],
      ["Claimed-vs-observed agreement", agg.agreeMean, agg.agreeMin, agg.agreeMax, agg.agreeStd],
      ["Trace completeness", agg.complMean, agg.complMin, agg.complMax, agg.complStd],
    ];

    for (const [label, mean, min, max, std] of rows) {
      lines.push(
        `| ${label} | ${mean.toFixed(3)} | ${min.toFixed(3)} | ${max.toFixed(3)} | ${std.toFixed(3)} |`,
      );
    }
    lines.push("");

    // Per-run breakdown
    lines.push("### Per-Run Breakdown", "");
    lines.push("");
    lines.push(
      "| Run | Label | Public% | Hidden% | Mutation | Gap | Time(s) | Calls | Cost($) | Agreement | Completeness |",
    );
    lines.push(
      "| --- | ----- | ------: | ------: | -------: | --: | ------: | ----: | ------: | --------: | -----------: |",
    );

    for (const run of group.runs) {
      const label = run.label ?? run.runId.slice(0, 8);
      const m = run.metrics;
      lines.push(
        [
          `| ${run.runId.slice(0, 8)}`,
          label,
          pct(m.correctness.publicTestPassRate),
          pct(m.correctness.hiddenTestPassRate),
          pct(m.correctness.mutationScore),
          pct(m.robustness.hiddenPublicGap),
          m.efficiency.wallClockTime.toFixed(1),
          String(m.efficiency.modelCalls),
          m.efficiency.estimatedCostUsd.toFixed(4),
          pct(m.evidence.claimedVsObservedAgreement),
          pct(m.evidence.traceCompleteness),
          "|",
        ].join(" | "),
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Aggregation helpers ────────────────────────────────────────────────

interface Aggregated {
  publicMean: number;
  publicMin: number;
  publicMax: number;
  publicStd: number;
  hiddenMean: number;
  hiddenMin: number;
  hiddenMax: number;
  hiddenStd: number;
  mutationMean: number;
  mutationMin: number;
  mutationMax: number;
  mutationStd: number;
  gapMean: number;
  gapMin: number;
  gapMax: number;
  gapStd: number;
  timeMean: number;
  timeMin: number;
  timeMax: number;
  timeStd: number;
  callsMean: number;
  callsMin: number;
  callsMax: number;
  callsStd: number;
  costMean: number;
  costMin: number;
  costMax: number;
  costStd: number;
  agreeMean: number;
  agreeMin: number;
  agreeMax: number;
  agreeStd: number;
  complMean: number;
  complMin: number;
  complMax: number;
  complStd: number;
}

function aggregateMetrics(metricsList: Metrics[]): Aggregated {
  const n = metricsList.length;
  if (n === 0) {
    return emptyAggregate();
  }

  const pubs = metricsList.map((m) => m.correctness.publicTestPassRate);
  const hids = metricsList.map((m) => m.correctness.hiddenTestPassRate);
  const muts = metricsList.map((m) => m.correctness.mutationScore);
  const gaps = metricsList.map((m) => m.robustness.hiddenPublicGap);
  const times = metricsList.map((m) => m.efficiency.wallClockTime);
  const calls = metricsList.map((m) => m.efficiency.modelCalls);
  const costs = metricsList.map((m) => m.efficiency.estimatedCostUsd);
  const agrees = metricsList.map((m) => m.evidence.claimedVsObservedAgreement);
  const compls = metricsList.map((m) => m.evidence.traceCompleteness);

  return {
    publicMean: avg(pubs),
    publicMin: Math.min(...pubs),
    publicMax: Math.max(...pubs),
    publicStd: std(pubs),
    hiddenMean: avg(hids),
    hiddenMin: Math.min(...hids),
    hiddenMax: Math.max(...hids),
    hiddenStd: std(hids),
    mutationMean: avg(muts),
    mutationMin: Math.min(...muts),
    mutationMax: Math.max(...muts),
    mutationStd: std(muts),
    gapMean: avg(gaps),
    gapMin: Math.min(...gaps),
    gapMax: Math.max(...gaps),
    gapStd: std(gaps),
    timeMean: avg(times),
    timeMin: Math.min(...times),
    timeMax: Math.max(...times),
    timeStd: std(times),
    callsMean: avg(calls),
    callsMin: Math.min(...calls),
    callsMax: Math.max(...calls),
    callsStd: std(calls),
    costMean: avg(costs),
    costMin: Math.min(...costs),
    costMax: Math.max(...costs),
    costStd: std(costs),
    agreeMean: avg(agrees),
    agreeMin: Math.min(...agrees),
    agreeMax: Math.max(...agrees),
    agreeStd: std(agrees),
    complMean: avg(compls),
    complMin: Math.min(...compls),
    complMax: Math.max(...compls),
    complStd: std(compls),
  };
}

function emptyAggregate(): Aggregated {
  return {
    publicMean: 0, publicMin: 0, publicMax: 0, publicStd: 0,
    hiddenMean: 0, hiddenMin: 0, hiddenMax: 0, hiddenStd: 0,
    mutationMean: 0, mutationMin: 0, mutationMax: 0, mutationStd: 0,
    gapMean: 0, gapMin: 0, gapMax: 0, gapStd: 0,
    timeMean: 0, timeMin: 0, timeMax: 0, timeStd: 0,
    callsMean: 0, callsMin: 0, callsMax: 0, callsStd: 0,
    costMean: 0, costMin: 0, costMax: 0, costStd: 0,
    agreeMean: 0, agreeMin: 0, agreeMax: 0, agreeStd: 0,
    complMean: 0, complMin: 0, complMax: 0, complStd: 0,
  };
}

function avg(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]): number {
  const mean = avg(values);
  const sqDiffs = values.map((v) => (v - mean) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function pct(v: number): string {
  return (v * 100).toFixed(1) + "%";
}
