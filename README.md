# Regenerable Software Lab

An experimental benchmark for evaluating whether AI coding agents can repeatedly generate a software system from a durable, implementation-independent verification bundle.

**Status:** Phase 4 — Experiment runner, CLI, harness adapters, and evaluator operational. Profiles A (basic) and B (behavioral) fully implemented. Profile C (operational) partially done.

## What

Most AI coding benchmarks evaluate issue resolution against an existing repository. Regenerable Software Lab does something different: it treats source code as a replaceable candidate implementation and measures whether agents can satisfy progressively stronger verification profiles from the same specification bundle.

The first benchmark is a small HTTP order-pricing API. Multiple coding models and agent harnesses receive the same specification and must produce an implementation that passes:

- **Profile A (Basic):** Public tests, type checking, linting, contract validation
- **Profile B (Behavioral):** Hidden tests, property-based tests, mutation testing
- **Profile C (Operational):** Dependency policy, secret scanning, performance budgets

## Repository

```
regenerable-software-lab/
├── apps/cli/                  # rsl CLI — 6 commands for running benchmarks
├── packages/                  # 8 workspace packages (runner, evaluator, etc.)
├── harness-adapters/          # 5 agent harness adapters
├── benchmarks/                # Order-pricing benchmark (visible + hidden assets)
├── environments/              # Docker images for isolated runs
├── experiments/               # Experiment manifests and configs
├── schemas/                   # JSON Schema for all artifact types
├── docs/                      # Architecture, threat model, methodology
├── SPEC.md                    # Canonical specification (read-only reference)
└── AGENTS.md                  # AI coding agent conventions
```

## Quickstart

### Prerequisites

- **Node.js** >= 24.0.0
- **pnpm** >= 10.0.0

### Clone and Install

```bash
git clone https://github.com/rmax-ai/regenerable-software-lab.git
cd regenerable-software-lab
pnpm install
pnpm build
```

### Running the Reference Implementation

The order-pricing benchmark includes a hand-written reference implementation used as the local oracle for public and hidden verification:

```bash
cd benchmarks/order-pricing/reference-impl
pnpm install
pnpm build
pnpm test
```

Start the server:

```bash
node dist/server.js
```

The API serves on `http://localhost:3000` with endpoints for orders, items, discounts, and health.

### Running Tests

**Workspace package tests** (root command; does not run hidden benchmark suites):

```bash
pnpm test
```

**Public tests** (visible to agents):

```bash
pnpm --filter reference-impl test
```

**Hidden tests** (not visible to agents, executed outside the agent workspace):

```bash
# Install hidden-suite deps once (not part of the pnpm workspace on purpose)
pnpm --dir benchmarks/order-pricing/hidden install --ignore-workspace

# Hidden integration and edge-case tests
pnpm test:hidden

# Property-based tests
pnpm test:property
```

Hidden tests also run through the evaluator inside an agent workspace. The evaluator mounts the candidate source and executes hidden, property, and mutation stages.

**Mutation tests** (StrykerJS):

```bash
pnpm --filter reference-impl test:mutation
```

### Smoke-running a Benchmark

```bash
pnpm build
node apps/cli/dist/main.js run order-pricing --harness-id fake --profile basic
```

### Running All Verify Checks

From the repository root:

```bash
pnpm typecheck   # TypeScript type checking
pnpm build       # Build all workspace packages
pnpm lint        # Lint checking
pnpm test        # Workspace package tests
pnpm test:hidden # Hidden order-pricing tests against reference-impl
```

## CLI

The `rsl` CLI provides 6 commands for running benchmarks, verifying candidates, comparing results, and inspecting traces:

```bash
node apps/cli/dist/main.js [command]
```

| Command | Description |
|---------|-------------|
| `run <benchmark-id>` | Run a single benchmark against a candidate |
| `verify <workspace-path>` | Run verification against a workspace |
| `compare <run-a> <run-b>` | Compare two benchmark run results |
| `experiment <config-path>` | Run an experiment with multiple configurations |
| `report <path>` | Display or export a benchmark run report |
| `trace <path>` | Inspect trace events from a benchmark run |

**Example — running a single benchmark:**

```bash
node apps/cli/dist/main.js run order-pricing \
  --harness-id codex \
  --model-name gpt-5.4 \
  --profile basic
```

**Example — running an experiment matrix:**

```bash
node apps/cli/dist/main.js experiment experiments/manifest.json
```

## Harness Adapters

Five adapters implement the `AgentHarness` interface, allowing any model to be evaluated through different coding agent platforms:

| Adapter | Package | Description |
|---------|---------|-------------|
| Codex CLI | `@rsl/harness-codex` | OpenAI Codex CLI |
| Droid | `@rsl/harness-droid` | Factory Droid CLI |
| Claude Code | `@rsl/harness-claude-code` | Anthropic Claude Code |
| Generic CLI | `@rsl/harness-generic-cli` | Command-driven adapter for any CLI agent |
| **Fake** | `@rsl/harness-fake` | Deterministic fake harness for CI testing |

The fake harness simulates agent behavior deterministically without real model calls. It supports multiple scenarios for CI testing:

```bash
SCENARIO=success pnpm --filter @rsl/harness-fake test
SCENARIO=buildFailure pnpm --filter @rsl/harness-fake test
SCENARIO=timeout pnpm --filter @rsl/harness-fake test
SCENARIO=policyViolation pnpm --filter @rsl/harness-fake test
```

Available scenarios: `success`, `buildFailure`, `timeout`, `policyViolation`, `falseClaim`, `budgetExhausted`, `partialImpl`, `repeatedCommands`.

## Package Map

| Package | Responsibility |
|---------|---------------|
| `benchmark-core` | Shared types, configuration parsing, schema validation |
| `runner` | Run lifecycle orchestration, workspace management, budget enforcement |
| `evaluator` | Verification pipeline (9 stages), public/hidden test separation, scoring |
| `trace` | Normalized event collection in JSON Lines format |
| `metrics` | Metric computation and aggregation |
| `policies` | Policy definition, dependency allowlist, network/filesystem policies |
| `reporting` | Markdown, JSON, and CSV report generation; comparison reports |
| `harness-adapters` | AgentHarness interface + 5 adapter implementations |

## Verification Profiles

The evaluator runs up to 9 stages depending on the verification profile:

| Stage | Profile A | Profile B | Profile C |
|-------|-----------|-----------|-----------|
| 1. Install | ✅ | ✅ | ✅ |
| 2. Build | ✅ | ✅ | ✅ |
| 3. Lint | ✅ | ✅ | ✅ |
| 4. Typecheck | ✅ | ✅ | ✅ |
| 5. Public Tests | ✅ | ✅ | ✅ |
| 6. Contract Validation | ✅ | ✅ | ✅ |
| 7. Hidden Tests | — | ✅ | ✅ |
| 8. Property Tests | — | ✅ | ✅ |
| 9. Mutation Testing | — | ✅ | ✅ |

Profile C adds operational checks (dependency policy, secret scanning, performance budgets) — partially implemented.

## Documentation Map

| Document | Purpose |
|----------|---------|
| [SPEC.md](SPEC.md) | Canonical specification — ground truth reference |
| [AGENTS.md](AGENTS.md) | Conventions for AI coding agents working on this project |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, components, data flow |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) | Threats from agents and threats to validity |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased implementation plan with acceptance criteria |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture decision records |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Language/framework research and best practices |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | How to contribute: benchmarks, adapters, experiments |
| [docs/TYPESCRIPT_DEVELOPMENT.md](docs/TYPESCRIPT_DEVELOPMENT.md) | TypeScript development conventions |
| [docs/TYPESCRIPT_ARCHITECTURE.md](docs/TYPESCRIPT_ARCHITECTURE.md) | TypeScript architecture guidelines |

## Research

**Primary question:** How reliably can AI coding agents generate and regenerate software from an implementation-independent verification bundle?

**Hypotheses (6):**
- **H1:** Visible verification overestimates correctness
- **H2:** Heterogeneous verification (contracts + tests + invariants + hidden tests) improves robustness more than more unit tests
- **H3:** Operational constraints expose failures functional tests miss
- **H4:** Harness effects increase with task complexity
- **H5:** Regeneration remains probabilistic across repeated runs
- **H6:** Durable failure assets improve future runs

See SPEC.md §3-4 for the full research protocol.

## Outputs

The project produces four publishable artifacts:
1. **Methodology article:** *Verification-First Software Engineering: Durable Specifications and Regenerable Code*
2. **Benchmark repository:** Runner, evaluator, specification, reference implementation
3. **Results article:** *What Coding Agents Do When the Visible Tests Are Incomplete*
4. **Dataset:** Run metadata, traces, verification results, failure classifications

## License

MIT — see [LICENSE](LICENSE)
