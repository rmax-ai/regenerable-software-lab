# TypeScript Architecture — Regenerable Software Lab

> Monorepo layout, module boundaries, layering, and dependency direction.
> See `docs/ARCHITECTURE.md` for the full system architecture.

## Monorepo Structure

```
regenerable-software-lab/
├── package.json              # Root workspace config
├── pnpm-workspace.yaml       # Workspace definition
├── tsconfig.json             # Base TypeScript config
│
├── apps/                     # Entry points
│   ├── cli/                  # rsl CLI
│   └── report-viewer/        # Optional web dashboard
│
├── packages/                 # Libraries
│   ├── benchmark-core/       # Shared types, config parsing, schemas
│   ├── runner/               # Run lifecycle orchestration
│   ├── evaluator/            # Verification pipeline
│   ├── trace/                # Normalized event collection
│   ├── metrics/              # Metric computation
│   ├── policies/             # Policy enforcement
│   ├── reporting/            # Report generation
│   └── harness-adapters/     # Agent harness implementations
│       ├── core/             # AgentHarness interface + base types
│       ├── fake/             # Deterministic fake harness for testing
│       ├── generic-cli/      # Command-driven adapter
│       ├── codex/            # Codex CLI adapter
│       └── claude-code/      # Claude Code adapter
│
├── benchmarks/               # Benchmark definitions
│   └── order-pricing/
│       ├── benchmark.yaml
│       ├── visible/          # Agent-accessible assets
│       └── hidden/           # Evaluator-only assets
│
├── schemas/                  # JSON Schema (generated from Zod)
│   ├── benchmark.schema.json
│   ├── run.schema.json
│   ├── trace-event.schema.json
│   ├── evidence-report.schema.json
│   └── results.schema.json
│
├── environments/             # Docker images
│   └── node/
│       ├── Dockerfile
│       └── entrypoint.sh
│
├── experiments/              # Experiment manifests
└── runs/                     # Run artifacts (gitignored)
```

## Package Dependency Graph

```
benchmark-core (leaf, zero internal deps)
    ↑
    ├── trace
    ├── policies
    ├── harness-adapters/core
    │       ↑
    │       ├── harness-adapters/fake
    │       ├── harness-adapters/generic-cli
    │       ├── harness-adapters/codex
    │       └── harness-adapters/claude-code
    ↑
    ├── metrics (depends on trace)
    │       ↑
    │       └── reporting
    ↑
    ├── evaluator (depends on trace, metrics, policies)
    ↑
    ├── runner (depends on trace, policies, harness-adapters)
    ↑
    └── apps/cli (depends on runner, reporting, benchmark-core, harness-adapters)
```

Rules:
- No circular dependencies
- `benchmark-core` never imports from other packages
- Harness adapters never import from `runner` or `evaluator`
- `apps/` may import from any `packages/`

## pnpm-workspace.yaml

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "packages/harness-adapters/*"
```

## Package Naming Convention

All packages scoped under `@rsl/`:
```json
{
  "name": "@rsl/benchmark-core",
  "version": "0.1.0",
  "private": true
}
```

## Layering

```
┌─────────────────────────────────────────┐
│  apps/cli  (User Interface Layer)       │
│  Commander + CLI commands               │
├─────────────────────────────────────────┤
│  packages/runner  (Orchestration Layer) │
│  Run lifecycle, workspace, budgets      │
├─────────────────────────────────────────┤
│  packages/evaluator  (Verification)     │
│  12-stage pipeline, scoring             │
├─────────────────────────────────────────┤
│  packages/harness-adapters              │
│  AgentHarness interface + adapters      │
├─────────────────────────────────────────┤
│  packages/trace | metrics | policies    │
│  Cross-cutting concerns                 │
├─────────────────────────────────────────┤
│  packages/benchmark-core  (Foundation)  │
│  Types, schemas, config parsing         │
└─────────────────────────────────────────┘
```

## Data Flow: Run Lifecycle

```
CLI
 │
 ├─ parse args → RunConfiguration
 │
 ▼
Runner.run(config)
 │
 ├─ Load benchmark definition
 ├─ Validate spec bundle
 ├─ Create workspace (Docker container)
 ├─ Mount visible assets (read-only)
 ├─ Mount protected assets (read-only)
 │
 ▼
Harness.prepare(input)
 │
 ▼
Harness.execute(input)
 │  ├─ Trace: model.request, model.response, tool.request, tool.result
 │  ├─ Trace: shell.command.started, shell.command.completed
 │  ├─ Trace: file.modified, protected_file.write_attempt
 │  └─ Budget enforcement (wall clock, tokens, cost, disk, memory)
 │
 ▼
Evaluator.verify(runId)
 │  └─ 12-stage pipeline (fail-soft)
 │
 ▼
Metrics.compute(verification, trace)
 │
 ▼
Reporting.generate(runId, metrics)
 │
 ▼
RunRecord (run.json, trace.jsonl, metrics.json, summary.md)
```

## Docker Integration

```typescript
// packages/runner/src/docker.ts
import { execa } from "execa";

export async function createContainer(config: ContainerConfig): Promise<string> {
  const args = [
    "run",
    "--rm",
    "--detach",
    "--network", "none",
    "--user", "node",
    "--memory", `${config.limits.maxMemoryMb}m`,
    "--cpus", "1",
    "--tmpfs", "/tmp:exec",
    "--volume", `${config.specDir}:/spec:ro`,
    "--volume", `${config.hiddenDir}:/hidden:ro`,
    "--volume", `${config.evaluatorDir}:/evaluator:ro`,
    "--volume", `${config.policiesDir}:/policies:ro`,
    "--volume", `${config.benchmarkConfig}:/benchmark-config:ro`,
    "--volume", `${config.workspaceDir}:/workspace`,
    "--workdir", "/workspace",
    config.image,
    "sleep", "infinity",
  ];

  const { stdout } = await execa("docker", args);
  return stdout.trim();
}
```

## Schema Generation Pipeline

```
Zod schemas (source of truth)
  │
  ├─ TypeScript type inference (z.infer)
  │
  ├─ zod-to-json-schema → schemas/*.schema.json
  │     │
  │     └─ Validated at CI: schemas match implementation
  │
  └─ Runtime validation: Schema.parse(input)
```

Run during build:
```bash
pnpm --filter @rsl/benchmark-core generate-schemas
```

## Key Architecture Decisions

1. **Zod as schema source of truth**: Types are inferred from schemas, not written separately. JSON Schema generated for documentation.

2. **Fail-soft evaluator**: All verification stages run even after failures. Each stage produces independent results. Allows richer failure classification.

3. **Trace as append-only JSONL**: Every observable event is a line. Easy to grep, stream, and analyze. Raw model reasoning not required.

4. **Harness-model independence**: `AgentHarness` interface never references a model. Model configuration is a separate parameter. Prevents conflation of harness quality with model quality.

5. **Read-only protected mounts**: Docker volume mounts at OS level. Agent cannot modify even with `sudo` (non-root user). Attempts logged as policy violations.

6. **Fake harness first**: Deterministic fake harness implemented before any real agent. Enables CI without model costs. Tests all failure scenarios.

See `docs/DECISIONS.md` for the full ADR set.
