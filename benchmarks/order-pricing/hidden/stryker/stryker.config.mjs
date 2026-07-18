// stryker.config.mjs — StrykerJS mutation testing configuration for order-pricing reference implementation
// See: https://stryker-mutator.io/docs/stryker-js/config-file

/** @type {import('@stryker-mutator/api/core/partial-stryker-options').PartialStrykerOptions} */
const config = {
  $schema: "../../../../node_modules/@stryker-mutator/core/schema/stryker-schema.json",

  // ── Test Runner ──────────────────────────────────────────────────────────
  testRunner: "vitest",

  // ── Checkers ─────────────────────────────────────────────────────────────
  // Use TypeScript checker to validate that mutants are type-correct.
  // This prevents generating mutants that would fail compilation.
  // Uses a custom tsconfig (stryker.tsconfig.json) with explicit target/lib
  // because the project's inherited root tsconfig lacks these settings,
  // causing third-party typedefs (e.g. zod) to fail compilation.
  checkers: ["typescript"],
  tsconfigFile: "stryker.tsconfig.json",

  // ── Plugins ──────────────────────────────────────────────────────────────
  plugins: [
    "@stryker-mutator/vitest-runner",
    "@stryker-mutator/typescript-checker",
  ],

  // ── File Targeting ───────────────────────────────────────────────────────
  // Mutate all TypeScript source files in the reference implementation.
  // Paths are relative to the working directory (reference-impl/).
  // Use negative glob patterns for exclusions (Stryker does not support top-level 'exclude').
  mutate: [
    "src/**/*.ts",
    "!test/**/*.ts",
    "!src/server.ts",
  ],

  // ── Incremental Mode ─────────────────────────────────────────────────────
  // Re-use results from previous runs to speed up subsequent runs.
  incremental: true,
  incrementalFile: "../hidden/stryker/.stryker-incremental.json",

  // ── Coverage Analysis ────────────────────────────────────────────────────
  // perTest gives finer-grained coverage info, enabling smarter mutant selection.
  coverageAnalysis: "perTest",

  // ── Reporters ────────────────────────────────────────────────────────────
  reporters: ["html", "json", "progress"],
  htmlReporter: {
    fileName: "../hidden/stryker/reports/mutation/html/index.html",
  },
  jsonReporter: {
    fileName: "../hidden/stryker/reports/mutation/mutation.json",
  },

  // ── Thresholds ───────────────────────────────────────────────────────────
  // Build fails if mutation score drops below 'break'.
  // Scores below 'low' will be flagged; above 'high' is the target.
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },

  // ── Performance ──────────────────────────────────────────────────────────
  // Limit concurrent mutant testing to avoid saturating the CI runner.
  concurrency: 4,

  // ── Temporary Directory ──────────────────────────────────────────────────
  // Keep Stryker's temp files under the hidden directory.
  tempDirName: "../hidden/stryker/.temp",
};

export default config;
