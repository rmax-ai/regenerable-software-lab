// @rsl/reporting — Report generation (Markdown, JSON, CSV, comparison)

export { generateMarkdownReport } from "./markdown.js";
export type { RunEntry } from "./markdown.js";

export { generateJsonSummary } from "./json-summary.js";

export { generateCsvResults } from "./csv.js";

export { generateComparisonReport } from "./comparison.js";
export type { ComparisonRun, ComparisonGroup } from "./comparison.js";
