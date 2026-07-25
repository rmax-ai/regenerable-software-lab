export const VERSION = "v0.1.0";

export const STACK = [
  "TypeScript 5.9",
  "Node.js >= 24",
  "pnpm (monorepo)",
  "Fastify",
  "Zod",
  "Vitest",
  "Stryker Mutator",
];

export const PROFILES = [
  {
    name: "Profile A — Basic",
    stages: "Install, Build, Lint, Typecheck, Public Tests, Contract Validation",
    status: "done",
  },
  {
    name: "Profile B — Behavioral",
    stages: "Hidden Tests, Property Tests, Mutation Testing",
    status: "done",
  },
  {
    name: "Profile C — Operational",
    stages: "Dependency Policy, Secret Scanning, Performance Budgets",
    status: "in-progress",
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
