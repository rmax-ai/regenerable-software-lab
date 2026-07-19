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
 * Group runs by model, harness, and profile.
 * Returns a list of groups, one per unique (model, harness, profile) triple.
 */
export function groupRuns(runs: ComparisonRun[]): ComparisonGroup[] {
  const map = new Map<string, ComparisonRun[]>();

  for (const run of runs) {
    const key = `${run.modelProvider}/${run.modelName}|${run.harness}|${run.profile}`;
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(run);
    } else {
      map.set(key, [run]);
    }
  }

  const groups: ComparisonGroup[] = [];
  for (const [key, bucket] of map) {
    const [modelKey, harness, profile] = key.split("|");
    const label = `${modelKey ?? "?"} / ${harness ?? "?"} / ${profile ?? "?"}`;
    groups.push({ label, runs: bucket });
  }

  // Sort groups by label for deterministic output
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
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

  // ── Summary comparison table ───────────────────────────────────────────
  lines.push("## Model / Harness / Profile Summary", "");
  lines.push(
    "| Group | Runs | Public% | Hidden% | Mutation | Gap | Time(s) | Cost($) | Success |",
  );
  lines.push(
    "| ----: | ---: | ------: | ------: | -------: | --: | ------: | ------: | ------: |",
  );

  for (const group of groups) {
    if (group.runs.length === 0) continue;
    const agg = aggregateMetrics(group.runs.map((r) => r.metrics));
    const successProp = successProportion(group.runs.map((r) => r.metrics));
    lines.push(
      [
        `| ${group.label}`,
        String(group.runs.length),
        pct(agg.publicMean),
        pct(agg.hiddenMean),
        pct(agg.mutationMean),
        pct(agg.gapMean),
        agg.timeMean.toFixed(1),
        agg.costMean.toFixed(4),
        pct(successProp),
        "|",
      ].join(" | "),
    );
  }
  lines.push("");

  // ── Per-group detail sections ──────────────────────────────────────────
  for (const group of groups) {
    if (group.runs.length === 0) continue;

    lines.push(`## ${group.label}`, "");
    lines.push(`**Runs:** ${group.runs.length}  `, "");

    // Aggregated Metrics table
    const agg = aggregateMetrics(group.runs.map((r) => r.metrics));

    lines.push("### Aggregated Metrics", "");
    lines.push("");
    lines.push("| Metric | Mean | Median | Min | Max | StdDev |");
    lines.push("| ------ | ---: | -----: | --: | --: | -----: |");

    const rows: [string, number, number, number, number, number][] = [
      ["Public test pass rate", agg.publicMean, agg.publicMedian, agg.publicMin, agg.publicMax, agg.publicStd],
      ["Hidden test pass rate", agg.hiddenMean, agg.hiddenMedian, agg.hiddenMin, agg.hiddenMax, agg.hiddenStd],
      ["Mutation score", agg.mutationMean, agg.mutationMedian, agg.mutationMin, agg.mutationMax, agg.mutationStd],
      ["Hidden/public gap", agg.gapMean, agg.gapMedian, agg.gapMin, agg.gapMax, agg.gapStd],
      ["Wall-clock time (s)", agg.timeMean, agg.timeMedian, agg.timeMin, agg.timeMax, agg.timeStd],
      ["Model calls", agg.callsMean, agg.callsMedian, agg.callsMin, agg.callsMax, agg.callsStd],
      ["Cost ($)", agg.costMean, agg.costMedian, agg.costMin, agg.costMax, agg.costStd],
      ["Claimed-vs-observed agreement", agg.agreeMean, agg.agreeMedian, agg.agreeMin, agg.agreeMax, agg.agreeStd],
      ["Trace completeness", agg.complMean, agg.complMedian, agg.complMin, agg.complMax, agg.complStd],
    ];

    for (const [label, mean, median, min, max, std] of rows) {
      lines.push(
        `| ${label} | ${mean.toFixed(3)} | ${median.toFixed(3)} | ${min.toFixed(3)} | ${max.toFixed(3)} | ${std.toFixed(3)} |`,
      );
    }
    lines.push("");

    // Success / hidden / mutation summary
    const successProp = successProportion(group.runs.map((r) => r.metrics));
    const hiddenMean = agg.hiddenMean;
    const mutationMean = agg.mutationMean;
    lines.push("### Key Quality Indicators", "");
    lines.push("");
    lines.push(`- **Success proportion:** ${pct(successProp)}`);
    lines.push(`- **Hidden pass rate (mean):** ${pct(hiddenMean)}`);
    lines.push(`- **Mutation score (mean):** ${pct(mutationMean)}`);
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
  publicMedian: number;
  publicMin: number;
  publicMax: number;
  publicStd: number;
  hiddenMean: number;
  hiddenMedian: number;
  hiddenMin: number;
  hiddenMax: number;
  hiddenStd: number;
  mutationMean: number;
  mutationMedian: number;
  mutationMin: number;
  mutationMax: number;
  mutationStd: number;
  gapMean: number;
  gapMedian: number;
  gapMin: number;
  gapMax: number;
  gapStd: number;
  timeMean: number;
  timeMedian: number;
  timeMin: number;
  timeMax: number;
  timeStd: number;
  callsMean: number;
  callsMedian: number;
  callsMin: number;
  callsMax: number;
  callsStd: number;
  costMean: number;
  costMedian: number;
  costMin: number;
  costMax: number;
  costStd: number;
  agreeMean: number;
  agreeMedian: number;
  agreeMin: number;
  agreeMax: number;
  agreeStd: number;
  complMean: number;
  complMedian: number;
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
    publicMedian: median(pubs),
    publicMin: Math.min(...pubs),
    publicMax: Math.max(...pubs),
    publicStd: std(pubs),
    hiddenMean: avg(hids),
    hiddenMedian: median(hids),
    hiddenMin: Math.min(...hids),
    hiddenMax: Math.max(...hids),
    hiddenStd: std(hids),
    mutationMean: avg(muts),
    mutationMedian: median(muts),
    mutationMin: Math.min(...muts),
    mutationMax: Math.max(...muts),
    mutationStd: std(muts),
    gapMean: avg(gaps),
    gapMedian: median(gaps),
    gapMin: Math.min(...gaps),
    gapMax: Math.max(...gaps),
    gapStd: std(gaps),
    timeMean: avg(times),
    timeMedian: median(times),
    timeMin: Math.min(...times),
    timeMax: Math.max(...times),
    timeStd: std(times),
    callsMean: avg(calls),
    callsMedian: median(calls),
    callsMin: Math.min(...calls),
    callsMax: Math.max(...calls),
    callsStd: std(calls),
    costMean: avg(costs),
    costMedian: median(costs),
    costMin: Math.min(...costs),
    costMax: Math.max(...costs),
    costStd: std(costs),
    agreeMean: avg(agrees),
    agreeMedian: median(agrees),
    agreeMin: Math.min(...agrees),
    agreeMax: Math.max(...agrees),
    agreeStd: std(agrees),
    complMean: avg(compls),
    complMedian: median(compls),
    complMin: Math.min(...compls),
    complMax: Math.max(...compls),
    complStd: std(compls),
  };
}

function emptyAggregate(): Aggregated {
  return {
    publicMean: 0, publicMedian: 0, publicMin: 0, publicMax: 0, publicStd: 0,
    hiddenMean: 0, hiddenMedian: 0, hiddenMin: 0, hiddenMax: 0, hiddenStd: 0,
    mutationMean: 0, mutationMedian: 0, mutationMin: 0, mutationMax: 0, mutationStd: 0,
    gapMean: 0, gapMedian: 0, gapMin: 0, gapMax: 0, gapStd: 0,
    timeMean: 0, timeMedian: 0, timeMin: 0, timeMax: 0, timeStd: 0,
    callsMean: 0, callsMedian: 0, callsMin: 0, callsMax: 0, callsStd: 0,
    costMean: 0, costMedian: 0, costMin: 0, costMax: 0, costStd: 0,
    agreeMean: 0, agreeMedian: 0, agreeMin: 0, agreeMax: 0, agreeStd: 0,
    complMean: 0, complMedian: 0, complMin: 0, complMax: 0, complStd: 0,
  };
}

function avg(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function std(values: number[]): number {
  const mean = avg(values);
  const sqDiffs = values.map((v) => (v - mean) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function pct(v: number): string {
  return (v * 100).toFixed(1) + "%";
}

/**
 * Compute the proportion of runs considered "successful".
 * A run is successful if hiddenTestPassRate >= 0.8 and mutationScore >= 0.5.
 */
function successProportion(metricsList: Metrics[]): number {
  if (metricsList.length === 0) return 0;
  const successful = metricsList.filter(
    (m) => m.correctness.hiddenTestPassRate >= 0.8 && m.correctness.mutationScore >= 0.5,
  ).length;
  return successful / metricsList.length;
}
