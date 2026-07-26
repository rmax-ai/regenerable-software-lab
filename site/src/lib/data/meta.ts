export const VERSION = "v0.1.0";

export const STATUS =
  "Phase 4: runner, CLI, harness adapters, and evaluator are operational. Profiles A and B are implemented. Profile C is partial.";

export const STACK = [
  "TypeScript 5.x",
  "Node.js >= 24",
  "pnpm (monorepo)",
  "Fastify",
  "Zod",
  "Vitest",
  "Stryker Mutator",
];

export const PROFILES = [
  {
    name: "Profile A - Basic",
    stages: "Install, Build, Lint, Typecheck, Public Tests, Contract Validation",
    status: "done" as const,
    note: "Evaluator stages 1-6",
  },
  {
    name: "Profile B - Behavioral",
    stages: "Hidden Tests, Property Tests, Mutation Testing",
    status: "done" as const,
    note: "Evaluator stages 7-9; local oracle passes against reference-impl",
  },
  {
    name: "Profile C - Operational",
    stages: "Dependency Policy, Secret Scanning, Performance Budgets",
    status: "in-progress" as const,
    note: "Partial; not a complete operational gate yet",
  },
];

export const HARNESSES = [
  { name: "Codex CLI", pkg: "@rsl/harness-codex" },
  { name: "Factory Droid", pkg: "@rsl/harness-droid" },
  { name: "Claude Code", pkg: "@rsl/harness-claude-code" },
  { name: "Generic CLI", pkg: "@rsl/harness-generic-cli" },
  { name: "Fake (CI)", pkg: "@rsl/harness-fake" },
];

export const PACKAGES = [
  { name: "benchmark-core", desc: "Shared types, config parsing, schemas" },
  { name: "runner", desc: "Run lifecycle orchestration, budgets" },
  { name: "evaluator", desc: "9-stage verification pipeline" },
  { name: "trace", desc: "Normalized JSON Lines event collection" },
  { name: "metrics", desc: "Metric computation and aggregation" },
  { name: "policies", desc: "Dependency allowlist, network/filesystem policies" },
  { name: "reporting", desc: "Markdown, JSON, CSV report generation" },
  { name: "harness-adapters", desc: "AgentHarness interface + 5 adapters" },
];

export const COMMANDS = [
  { cmd: "run", desc: "Run a single benchmark against a candidate" },
  { cmd: "verify", desc: "Run verification against a workspace" },
  { cmd: "compare", desc: "Compare two benchmark run results" },
  { cmd: "experiment", desc: "Run an experiment with multiple configurations" },
  { cmd: "report", desc: "Display or export a benchmark run report" },
  { cmd: "trace", desc: "Inspect trace events from a benchmark run" },
];

export const QUICKSTART = [
  "git clone https://github.com/rmax-ai/regenerable-software-lab.git",
  "cd regenerable-software-lab",
  "pnpm install && pnpm build",
  "pnpm test",
  "pnpm --filter reference-impl test",
  "pnpm --dir benchmarks/order-pricing/hidden install --ignore-workspace",
  "pnpm test:hidden && pnpm test:property",
  "node apps/cli/dist/main.js run order-pricing --harness-id fake --profile basic",
];
