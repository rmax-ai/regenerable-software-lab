# Contributing to Regenerable Software Lab

> Guide for contributors to the Regenerable Software Lab benchmark.
> See [AGENTS.md](../AGENTS.md) for AI coding agent conventions.
> See [SPEC.md](../SPEC.md) for the canonical specification.

---

## Table of Contents

1. [Repository Overview](#repository-overview)
2. [Code Conventions](#code-conventions)
3. [How to Add a New Benchmark](#how-to-add-a-new-benchmark)
4. [How to Add a New Harness Adapter](#how-to-add-a-new-harness-adapter)
5. [How to Run Experiments](#how-to-run-experiments)
6. [Pull Request Process](#pull-request-process)
7. [Testing Guidelines](#testing-guidelines)

---

## Repository Overview

```
regenerable-software-lab/
├── apps/cli/              # rsl CLI — user-facing entry point
├── apps/report-viewer/    # Optional web dashboard
├── packages/              # 8 workspace packages (see ARCHITECTURE.md §1.1)
│   ├── benchmark-core/    # Shared types, configuration, schemas
│   ├── runner/            # Run lifecycle orchestration
│   ├── evaluator/         # 12-stage verification pipeline
│   ├── trace/             # JSON Lines trace collection
│   ├── metrics/           # Metric computation and aggregation
│   ├── policies/          # Dependency, network, filesystem policy
│   ├── reporting/         # Markdown, JSON, CSV report generation
│   └── harness-adapters/  # AgentHarness interface implementations
├── benchmarks/            # Benchmark definitions (visible + hidden assets)
├── environments/          # Docker images for isolated runs
├── schemas/               # JSON Schema for all artifact types
├── experiments/           # Experiment manifests and configs
└── docs/                  # Architecture, threat model, methodology
```

See [AGENTS.md](../AGENTS.md) for the full repository structure and execution conventions.

---

## Code Conventions

All code follows the conventions in [AGENTS.md](../AGENTS.md). Key points:

- **Package manager:** pnpm (workspaces)
- **TypeScript:** `strict: true` in every package, no `any` without justification
- **Naming:** kebab-case for files/directories, PascalCase for classes/interfaces, camelCase for functions/variables, UPPER_SNAKE_CASE for constants/enums
- **Testing:** Vitest with 80% coverage target for runner and evaluator
- **Commits:** Conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`)
- **Documentation:** One sentence per line in all Markdown files
- **No em dashes** in code, comments, docs, or commits

See [docs/TYPESCRIPT_DEVELOPMENT.md](TYPESCRIPT_DEVELOPMENT.md) and [docs/TYPESCRIPT_ARCHITECTURE.md](TYPESCRIPT_ARCHITECTURE.md) for detailed TypeScript conventions.

---

## How to Add a New Benchmark

A benchmark consists of a specification bundle (visible assets), a hidden verification suite, and a benchmark configuration.

### Step 1: Create the Benchmark Directory

```
benchmarks/<benchmark-name>/
├── benchmark.yaml         # Benchmark configuration (SPEC.md §25)
├── task.md               # Task instruction for the agent (SPEC.md §12)
├── visible/              # Visible assets (agent-accessible)
│   ├── openapi.yaml      # API contract
│   ├── invariants/       # Invariant documentation
│   │   ├── pricing.md    # Human-readable
│   │   └── pricing.yaml  # Machine-readable
│   └── tests/            # Public tests (example-based, integration)
├── hidden/               # Hidden assets (not agent-accessible)
│   ├── tests/            # Hidden tests (edge cases, adversarial)
│   │   └── property/     # Property-based tests with fast-check
│   ├── stryker/          # Mutation testing configuration
│   └── vitest.config.ts  # Hidden test Vitest configuration
└── reference-impl/       # Reference implementation (hand-written)
    ├── src/
    ├── test/
    ├── package.json
    └── tsconfig.json
```

### Step 2: Define the Benchmark Configuration

Create `benchmark.yaml` with the following fields (see `benchmarks/order-pricing/benchmark.yaml` for reference):

```yaml
id: <benchmark-id>
version: 0.1.0
language: typescript
runtime: node-24
entrypoint: src/server.ts

profiles:
  basic:
    public_tests: true
    hidden_tests: false
    # ...

commands:
  install: pnpm install --offline --frozen-lockfile
  build: pnpm build
  test_public: pnpm test

protected_paths:
  - /spec
  - /evaluator
  - /policies
  - /hidden
  - /benchmark-config

limits:
  wall_clock_seconds: 1800
  memory_mb: 2048
  disk_mb: 1024
  network: disabled

dependency_policy:
  allowed:
    - <allowed-packages>
```

### Step 3: Write the Reference Implementation

Create a hand-written reference implementation that passes all verification profiles. This serves as:
- A baseline for evaluator validation (SPEC.md §32.1)
- A correctness target for agent-generated implementations

### Step 4: Write Visible (Public) Tests

Place example-based tests and integration tests in `visible/tests/`. These tests are visible to the agent and exercise the main API contract.

### Step 5: Write Hidden Tests

Place hidden tests in `hidden/tests/`. These include:
- Edge-case tests not covered by public tests
- Adversarial payload sets
- Property-based tests (fast-check generators)
- Concurrency tests

Hidden tests must never be accessible from the agent workspace (SPEC.md §9.2).

### Step 6: Configure Mutation Testing

Add StrykerJS configuration in `hidden/stryker/` with mutation operators targeting the benchmark's domain-specific failure modes (SPEC.md §11).

### Step 7: Register the Benchmark

Add the benchmark to the workspace (if it has its own `package.json`) and ensure `pnpm install` resolves it. The benchmark should appear in `pnpm ls -r`.

### Step 8: Verify

Run the reference implementation against all profiles to ensure the evaluator, public tests, and hidden tests work correctly.

---

## How to Add a New Harness Adapter

A harness adapter implements the `AgentHarness` interface (SPEC.md §13) for a specific coding-agent platform.

### Step 1: Study the Interface

The `AgentHarness` interface is defined in `packages/benchmark-core/src/types.ts`:

```typescript
interface AgentHarness {
  readonly id: string;
  readonly version: string;
  prepare(input: PrepareInput): Promise<PreparedRun>;
  execute(input: ExecuteInput): Promise<ExecutionResult>;
  terminate(runId: string): Promise<void>;
  collectArtifacts(runId: string): Promise<HarnessArtifacts>;
}
```

See `packages/harness-adapters/core/src/agent-harness.ts` for re-exports and `packages/harness-adapters/fake/src/FakeHarness.ts` for a complete reference implementation.

### Step 2: Create the Adapter Package

```
packages/harness-adapters/<adapter-name>/
├── src/
│   ├── index.ts          # Package entry point, exports
│   ├── <AdapterName>.ts  # Main adapter class
│   ├── adapter.ts        # Adapter factory function
│   └── <specific>-parser.ts  # Optional: output parsing
├── package.json
├── tsconfig.json
└── (optional) vitest.config.ts
```

### Step 3: Implement the Lifecycle

1. **`prepare()`**: Receive the task prompt, model configuration, and workspace path. Set up harness-specific environment (config files, system prompts, tool definitions).

2. **`execute()`**: Launch the coding agent with the prepared configuration. The harness must:
   - Capture all model requests and responses as trace events
   - Monitor shell commands and file modifications
   - Enforce budgets (wall clock, model calls, tokens)
   - Handle termination signals when budgets are exhausted

3. **`terminate()`**: Gracefully shut down the agent process. Send termination signals if the agent does not exit on its own.

4. **`collectArtifacts()`**: Gather workspace files, trace events, evidence reports, and any harness-specific output.

### Step 4: Implement Trace Normalization

Each adapter must normalize its native output format into the common `TraceEvent` schema (SPEC.md §21). See `packages/harness-adapters/generic-cli/src/trace-normalizer.ts` for an example.

### Step 5: No Hard Model Dependency

A harness identifier must not implicitly encode the model (SPEC.md §13.4). The model is always passed as an independent configuration parameter.

### Step 6: Add Tests

Write Vitest tests for your adapter. Use the fake harness as a reference for test patterns:
- Test `prepare()` with various configurations
- Test `execute()` with mock agent behavior
- Test trace normalization
- Test termination and timeout handling

### Step 7: Register the Adapter

Update the CLI or runner configuration to support the new harness identifier. The adapter should be discoverable by ID at runtime.

---

## How to Run Experiments

Experiments define a matrix of configurations (models, harnesses, profiles, seeds) and execute them as independent runs.

### Step 1: Create an Experiment Manifest

Create an experiment manifest in `experiments/<experiment-name>.yaml`:

```yaml
id: my-experiment
version: 0.1.0
benchmark: order-pricing

matrix:
  model: [openai-gpt-4o, anthropic-claude-sonnet-4]
  harness: [codex, claude-code]
  profile: [basic, behavioral]
  seed: [42, 123, 256]

limits:
  wall_clock_seconds: 1800
  memory_mb: 2048
  disk_mb: 1024
```

### Step 2: Execute

```bash
pnpm --filter @rsl/cli exec rsl experiment run my-experiment.yaml
```

Or use the CLI directly:

```bash
pnpm --filter @rsl/cli exec rsl run order-pricing --harness fake --profile basic
```

### Step 3: Compare Results

```bash
pnpm --filter @rsl/cli exec rsl compare run-001 run-002
```

### Step 4: Generate Reports

```bash
pnpm --filter @rsl/cli exec rsl report --format markdown --output results.md
```

### Smoke Testing (Before Full Experiments)

Before running expensive model-based experiments, validate your setup with the fake harness:

```bash
# Quick smoke test with fake harness
SCENARIO=success pnpm --filter @rsl/harness-fake exec vitest run
SCENARIO=buildFailure pnpm --filter @rsl/harness-fake exec vitest run
```

---

## Pull Request Process

1. **Open an issue** describing the change before significant work.
2. **Create a feature branch** from `main`.
3. **Run all checks** before submitting:
   ```bash
   pnpm typecheck
   pnpm build
   pnpm lint
   pnpm test
   ```
4. **Write tests** for new code. Coverage target is 80% for runner and evaluator.
5. **Update documentation** if changing interfaces, adding features, or modifying behavior.
6. **Use conventional commits** in your commit messages.
7. **Submit a PR** with a clear description of the change and any design rationale.

### PR Checklist

- [ ] Code follows [AGENTS.md](../AGENTS.md) conventions
- [ ] TypeScript strict mode passes (`pnpm typecheck`)
- [ ] All existing tests pass (`pnpm test`)
- [ ] New code has tests
- [ ] Documentation updated (if applicable)
- [ ] No secrets, credentials, or absolute paths in code
- [ ] No stale TODOs without tracking issues
- [ ] Conventional commit messages

---

## Testing Guidelines

### Running All Tests

```bash
# All workspace package tests
pnpm test

# Type checking
pnpm typecheck

# Linting
pnpm lint
```

### Adding Tests

- Place tests next to source files with `.test.ts` suffix
- Use Vitest for all testing
- Property-based tests use fast-check
- E2E tests must use the fake harness (no real model calls in CI)
- Gold tests for report generation
- Property tests for metric aggregation

### Test Naming Convention

```
Test: <component> - <behavior>
Example: Test: Calculator - applies percentage discount correctly
```
