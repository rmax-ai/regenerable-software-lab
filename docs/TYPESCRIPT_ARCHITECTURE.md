# TypeScript Architecture Guidelines — Regenerable Software Lab

> Companion document to AGENTS.md. Monorepo architecture, package boundaries, dependency direction.
> Source: Phase 1 research (docs/RESEARCH.md) + ARCHITECTURE.md.

---

## Monorepo Architecture

### Package Map and Dependency Direction

```
apps/cli ─────────────────────────────────────────────┐
apps/report-viewer (future)                            │
                                                       │
packages/runner ────────────┐                          │
packages/reporting ─────────┤                          │
packages/evaluator ─────────┤                          │
packages/metrics ───────────┤                          │
packages/trace ─────────────┤                          │
packages/policies ──────────┤                          │
packages/harness-adapters/* ┤                          │
                             │                          │
                    packages/benchmark-core ←──────────┘
```

Dependency rules:
- `benchmark-core` is the leaf. Zero internal dependencies.
- All other packages depend on `benchmark-core` (and possibly each other).
- Circular dependencies are forbidden.
- External package boundaries enforced via `exports` field.
- Apps depend on packages, never vice versa.

### Package Scope

All packages are scoped `@rsl/`:
- `@rsl/benchmark-core` — shared types, config parsing, schema validation.
- `@rsl/trace` — normalized event collection in JSONL.
- `@rsl/policies` — dependency allowlist, network policy, filesystem policy.
- `@rsl/metrics` — metric computation and aggregation.
- `@rsl/evaluator` — verification pipeline execution.
- `@rsl/runner` — run lifecycle orchestration.
- `@rsl/reporting` — markdown, JSON, CSV report generation.
- `@rsl/harness-adapters` — directory containing per-harness packages.

### Package Exports

Each package defines its public API through `exports` in `package.json`:

```json
{
  "name": "@rsl/benchmark-core",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./schemas": "./src/schemas/index.ts",
    "./types": "./src/types/index.ts"
  }
}
```

Internal modules are not importable from outside.
Use `import type` for type-only imports to avoid runtime dependencies.

---

## Module Boundaries

### What Goes Where

| Concern | Package | Rationale |
|---------|---------|-----------|
| `RunConfiguration` type | benchmark-core | Shared across all packages |
| Trace event writing | trace | Isolated for streaming performance |
| Dependency checker | policies | Independent policy engine |
| Metric computation | metrics | Stateless, pure functions |
| Verification pipeline | evaluator | Orchestrates stages, calls external tools |
| Container management | runner | Docker interaction, lifecycle |
| CLI parsing | apps/cli | User interface only |
| Harness protocol | harness-adapters | Per-harness implementation details |

### Cross-Cutting Concerns

These are handled at the infrastructure level, not as packages:
- **Logging:** pino instance created in CLI/runner, passed via dependency injection.
- **Error normalization:** `benchmark-core` provides `normalizeError()` utility.
- **Configuration:** `benchmark-core` provides Zod-based config parsing.
- **Secrets:** `.envrc` + direnv at project root; never hardcoded.

---

## Dependency Injection

Avoid global state. Pass dependencies explicitly:

```typescript
// BAD: global singleton
import { logger } from "./logger.js";

// GOOD: explicit injection
export function createRunner(deps: {
  logger: pino.Logger;
  docker: Docker;
  harnessRegistry: HarnessRegistry;
}): Runner {
  return { run: (config) => runWith(deps, config) };
}
```

For the CLI:
```typescript
// apps/cli/src/main.ts
const logger = pino({ level: "info" });
const docker = new Docker();
const harnessRegistry = await createHarnessRegistry();

const runner = createRunner({ logger, docker, harnessRegistry });

// Wire to Commander.js
runCommand.action(async (options) => {
  await runner.run(buildConfig(options));
});
```

---

## Data Flow: Run Lifecycle

```
CLI (rsl run)
    │
    ▼
Runner.createRun(config)
    │
    ├──► benchmark-core: validate config against schema
    ├──► trace: open trace.jsonl stream
    ├──► policies: check dependency policy (pre-run)
    │
    ▼
Runner.prepareWorkspace(runId)
    │
    ├──► Docker: create container with read-only spec mount
    ├──► Copy visible assets to workspace
    │
    ▼
Runner.executeAgent(runId)
    │
    ├──► HarnessAdapter.prepare() → PreparedRun
    ├──► HarnessAdapter.execute() → ExecutionResult
    │       │
    │       └──► trace: model.request, model.response,
    │            tool.request, tool.result,
    │            shell.command.*, file.modified,
    │            protected_file.write_attempt
    │
    ▼
Runner.runVerification(runId)
    │
    ├──► Evaluator.runStage(0..12)
    │       │
    │       └──► trace: verification.started/completed
    │
    ▼
Runner.finalize(runId)
    │
    ├──► metrics: compute all metrics
    ├──► trace: write run.completed, close stream
    ├──► reporting: generate summary.md
    └──► Docker: archive or delete container
```

---

## Verification Pipeline Architecture

The evaluator executes a 12-stage pipeline (SPEC.md §19.1):

```
Stage 0:  Workspace Integrity    → protected files unchanged?
Stage 1:  Install                → pnpm install succeeds?
Stage 2:  Build                  → tsc/noEmit passes?
Stage 3:  Lint                   → eslint passes?
Stage 4:  Typecheck              → strict mode clean?
Stage 5:  Public Tests           → vitest run passes?
Stage 6:  Contract Validation    → OpenAPI response matches schema?
--- hidden boundary ---
Stage 7:  Hidden Tests           → tests agent never saw?
Stage 8:  Property Tests         → fast-check properties hold?
Stage 9:  Mutation Testing       → StrykerJS score?
Stage 10: Security & Policy      → deps, secrets, network?
Stage 11: Performance            → latency, memory budgets?
Stage 12: Evidence Validation    → agent claims match reality?
```

Stages 0-6 run inside the agent container (visible to agent during loops).
Stages 7-12 run outside the agent container using only extracted artifacts.

### Stage Result Type

```typescript
interface StageResult {
  stage: number;
  name: string;
  status: "passed" | "failed" | "skipped" | "error";
  durationMs: number;
  metrics: Record<string, number | string>;
  failureCategory?: FailureCategory;
  artifacts: string[]; // paths to output files
}
```

### Fail-Soft Behavior

If Stage 2 (Build) fails, Stages 3-6 are skipped (cannot run).
But Stages 7-12 still execute if artifacts can be extracted.
The evaluator records all stage results, not just the first failure.

---

## Harness Adapter Architecture

```
AgentHarness (interface)
    │
    ├──► FakeHarness           # Deterministic, no real model
    ├──► GenericCliAdapter     # Command-driven agent
    ├──► CodexAdapter          # Codex CLI specific
    └──► ClaudeCodeAdapter     # Claude Code specific (future)
```

### Adapter Implementation Pattern

```typescript
// packages/harness-adapters/generic-cli/src/adapter.ts
import type { AgentHarness, PrepareInput, ExecuteInput } from "@rsl/benchmark-core";

export class GenericCliAdapter implements AgentHarness {
  readonly id = "generic-cli";
  readonly version = "0.1.0";

  async prepare(input: PrepareInput): Promise<PreparedRun> {
    // Write task prompt to workspace
    // Set up environment variables
    return { runId: input.runId, workspacePath: input.workspacePath };
  }

  async execute(input: ExecuteInput): Promise<ExecutionResult> {
    // Run command in container, capture stdout/stderr
    // Parse exit code, check for completion signal
    // Normalize trace events from raw output
    return {
      status: "completed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      reportedCompletion: true,
    };
  }

  async terminate(runId: string): Promise<void> {
    // Kill container process
  }

  async collectArtifacts(runId: string): Promise<HarnessArtifacts> {
    // Read workspace files, extract evidence report
    return {
      files: [],
      evidenceReport: undefined,
    };
  }
}
```

### Trace Normalization

Each harness adapter is responsible for normalizing its native output format to the common `TraceEvent` schema.
For example, Codex's tool calls and Droid's shell commands both become `shell.command.started` events with standardized payloads.

---

## Container Isolation Architecture

```
┌─────────────────────────────────────────────┐
│ Docker Container (node-runner:0.1.0)        │
│                                              │
│  ┌──────────┐  ┌─────────────────────────┐  │
│  │ /spec    │  │ /workspace (writable)    │  │
│  │ (ro)     │  │  ├── src/                │  │
│  │          │  │  ├── test/               │  │
│  │          │  │  ├── package.json        │  │
│  │          │  │  └── ...                 │  │
│  └──────────┘  └─────────────────────────┘  │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ /policies, /evaluator, /hidden       │   │
│  │ (ro, agent cannot read hidden/eval)  │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  User: agent (uid 1000, non-root)           │
│  Network: none                               │
│  Capabilities: dropped ALL                   │
│  Memory: 2GB, CPU: 2 cores                   │
│  Filesystem: read-only root, tmpfs for /tmp  │
└─────────────────────────────────────────────┘
```

Agent can write to: `/workspace` (implementation code) and `/tmp`.
Agent can read: `/spec`, `/workspace` (public verification assets).
Agent cannot read: `/evaluator`, `/hidden`, `/policies`, `/benchmark-config`.
Agent cannot access: network, host filesystem, Docker socket.

---

## Schema Architecture

All artifact schemas are defined in Zod and exported as JSON Schema:

```
schemas/
├── benchmark.schema.json    # BenchmarkConfig
├── run.schema.json          # RunConfiguration, RunLimits
├── trace-event.schema.json  # TraceEvent
├── evidence-report.schema.json # EvidenceReport
└── results.schema.json      # VerificationResult, Metrics, RunRecord
```

Zod source definitions live in `packages/benchmark-core/src/schemas/`.
JSON Schema files are generated at build time via a script and committed.
Both formats serve different consumers: Zod for TypeScript validation, JSON Schema for documentation and cross-language consumers.

---

## Testing Architecture

### Test Levels

| Level | Framework | Location | What it tests |
|-------|-----------|----------|---------------|
| Unit | Vitest | Each package's `test/` | Pure functions, schema validation, config parsing |
| Integration | Vitest + Docker | `packages/runner/test/` | Container lifecycle, fake harness integration |
| E2E | Vitest + FakeHarness | `packages/evaluator/test/` | Full pipeline with deterministic fake agent |
| Golden | Vitest | `packages/reporting/test/` | Report output matches fixtures |
| Property | fast-check | `packages/metrics/test/` | Metric aggregation invariants |

### Fake Harness Scenarios

The fake harness (SPEC.md §40) supports deterministic scenarios for CI:

```typescript
// packages/harness-adapters/fake/src/scenarios.ts
export const scenarios = {
  success:       { status: "completed", files: [...referenceImpl] },
  buildFailure:  { status: "failed",    error: "tsc: error TS2304" },
  timeout:       { duration: 31 * 60_000, status: "timeout" },
  policyViolation: { status: "policy_terminated", violation: "PROTECTED_ASSET_MODIFICATION" },
  falseClaim:    { status: "completed", evidenceClaims: { publicTests: "passed", actual: false } },
  budgetExhausted: { status: "budget_exhausted", modelCalls: 1000 },
  partialImpl:   { status: "completed", files: [...halfTheRoutes] },
  repeatedCommands: { status: "failed", actions: [...sameCommand50Times] },
};
```

---

## Error Architecture

### Error Hierarchy

```
BenchmarkError (base)
├── ConfigError
│   ├── InvalidSchemaError
│   └── MissingRequiredOptionError
├── RunnerError
│   ├── ContainerError
│   ├── TimeoutError
│   └── BudgetExhaustedError
├── HarnessError
│   ├── AdapterError
│   └── TraceParseError
├── EvaluatorError
│   ├── StageExecutionError
│   └── ArtifactMissingError
└── PolicyError
    ├── DependencyViolationError
    ├── NetworkAccessError
    └── ProtectedFileError
```

Each error type has a machine-readable `code` for trace events and a human-readable `message` for logs.
Stack traces are never included in API responses or artifact output.

### Normalization at Boundaries

```typescript
function normalizeError(err: unknown): NormalizedError {
  if (err instanceof BenchmarkError) {
    return { code: err.code, message: err.message, category: err.category };
  }
  if (err instanceof Error) {
    return { code: "UNKNOWN", message: err.message, category: "INTERNAL" };
  }
  return { code: "UNKNOWN", message: String(err), category: "INTERNAL" };
}
```

---

## Configuration Architecture

### Config Loading Chain

```
CLI args > Environment vars > Experiment manifest > Benchmark defaults
```

Each layer overrides the previous.
Zod schemas validate at each boundary.
Invalid config is rejected with structured errors at parse time, not runtime.

### Config Validation Pattern

```typescript
import { z } from "zod";

const RunConfigurationSchema = z.object({
  runId: z.string().uuid(),
  benchmarkVersion: z.string(),
  applicationId: z.string(),
  profile: z.enum(["basic", "behavioral", "operational"]),
  seed: z.number().int(),
  limits: RunLimitsSchema,
});

export function parseRunConfig(raw: unknown): RunConfiguration {
  return RunConfigurationSchema.parse(raw);
}
```

---

## Observability Architecture

### What Gets Logged vs What Gets Traced

| Signal | Destination | Purpose |
|--------|-------------|---------|
| Benchmark lifecycle | Structured log (pino) | Operator visibility |
| Agent actions | Trace (JSONL) | Research analysis |
| Verification results | Artifact JSON | Reproducibility |
| Errors | Both log + trace | Debugging |
| Metrics | metrics.json | Aggregation |

Logs are for humans operating the benchmark.
Traces are for researchers analyzing agent behavior.
They serve different audiences and are stored separately.

### Health Check

The benchmark runner (not the benchmark application) exposes:
```bash
rsl health  # Checks Docker daemon, disk space, harness availability
```
