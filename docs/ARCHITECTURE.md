# Regenerable Software Lab — System Architecture

> **Document version:** 1.0.0-draft
> **Source:** SPEC.md (this document is derived from the canonical specification)
> **Traceability:** Section references (e.g., SPEC.md §15) link each architectural element back to the original specification.

---

## Executive Summary

Regenerable Software Lab is an experimental benchmark for evaluating whether AI coding agents can repeatedly generate a software system from a durable, implementation-independent verification bundle (SPEC.md §1). The project treats source code as a replaceable candidate implementation. The persistent assets are API contracts, behavioral requirements, invariants, tests, policies, performance budgets, evaluation rules, and historical failure cases that define acceptable system behavior (SPEC.md §1).

The benchmark infrastructure is organized as a monorepo with eight packages under `packages/`, two application entry points under `apps/`, benchmark definitions under `benchmarks/`, container environments under `environments/`, JSON schemas under `schemas/`, and run artifacts under `runs/` (SPEC.md §24). The architecture is designed to enforce strict isolation between the agent workspace and the evaluator, support multiple coding-agent harnesses through a common adapter interface, execute a 12-stage verification pipeline, and produce normalized, reproducible results.

The first benchmark target is a small HTTP order-pricing API (SPEC.md §6). The system measures not only whether an implementation passes visible tests, but whether it generalizes to hidden tests, survives mutation testing, respects operational policies, and produces reproducible results across repeated runs (SPEC.md §1).

---

## 1. Architecture Overview

The system follows a layered architecture with four principal tiers:

1. **CLI and Experiment Layer** — `apps/cli` and `apps/report-viewer` provide user-facing commands for running benchmarks, verifying candidates, comparing runs, and generating reports (SPEC.md §26, §29).
2. **Core Runner Layer** — `packages/runner` coordinates the full experiment lifecycle. `packages/benchmark-core` provides shared configuration, schema definitions, and data models (SPEC.md §15, §16).
3. **Harness Adapter Layer** — `packages/harness-adapters` implements the `AgentHarness` interface for each coding-agent platform, including a deterministic fake harness for testing (SPEC.md §13, §40).
4. **Evaluation Layer** — `packages/evaluator` runs the verification pipeline inside the isolated container. `packages/trace`, `packages/metrics`, `packages/policies`, and `packages/reporting` support observability, measurement, policy enforcement, and output generation (SPEC.md §19, §21, §22, §29).

### 1.1 Monorepo Package Map

| Package | Responsibility | Key SPEC Reference |
|---|---|---|
| `benchmark-core` | Shared types, configuration parsing, schema validation, data models | SPEC.md §16, §25 |
| `runner` | Run lifecycle orchestration, workspace management, budget enforcement | SPEC.md §15 |
| `evaluator` | Verification pipeline execution, public/hidden test separation, scoring | SPEC.md §19 |
| `trace` | Normalized event collection in JSON Lines format | SPEC.md §21 |
| `metrics` | Metric computation and aggregation (correctness, efficiency, safety, robustness, evidence quality) | SPEC.md §22 |
| `policies` | Policy definition, dependency allowlist checking, network policy, filesystem policy, secret scanning | SPEC.md §18, §33 |
| `reporting` | Markdown, JSON, and CSV report generation; comparison reports; visualizations | SPEC.md §29 |
| `harness-adapters` | AgentHarness interface implementations (generic-cli, codex, claude-code) | SPEC.md §13 |

### 1.2 Component Diagram (Logical)

```
┌──────────────────────────────────────────────────────────────┐
│                    CLI (apps/cli/)                            │
│  rsl run | rsl experiment | rsl verify | rsl compare | etc. │
└─────────────────────┬────────────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────────────┐
│                   BenchmarkRunner                             │
│  packages/runner/ — prepare → execute → verify → report      │
└─────┬──────────────┬──────────────┬──────────────┬───────────┘
      │              │              │              │
┌─────▼────┐  ┌──────▼─────┐  ┌───▼────┐  ┌─────▼─────────┐
│benchmark │  │  harness-  │  │evaluator│  │  reporting/    │
│-core/    │  │  adapters/ │  │        │  │  metrics/     │
│(shared   │  │(AgentHarness│  │(verif. │  │  trace/       │
│types,    │  │ impls)     │  │pipeline)│  │  policies/    │
│schemas)  │  │            │  │        │  │               │
└──────────┘  └────────────┘  └────────┘  └───────────────┘
                      │
┌─────────────────────▼────────────────────────────────────────┐
│               Docker Container (isolated)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Agent        │  │ Protected    │  │ Evaluator        │   │
│  │ Workspace    │  │ Mounts       │  │ (runs outside    │   │
│  │ (writable)   │  │ (read-only)  │  │  workspace)      │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Component Architecture by Package

### 2.1 `benchmark-core`

The `benchmark-core` package defines all shared data types and configuration schemas used across the system (SPEC.md §16, §25).

**Key types** (SPEC.md §16):
- `RunConfiguration` — runId, benchmarkVersion, applicationId, profile, harness, model, seed, limits
- `RunLimits` — wallClockSeconds, maxModelCalls, maxInputTokens, maxOutputTokens, maxCostUsd, maxVerificationAttempts, maxDiskMb, maxMemoryMb
- `ModelConfiguration` — provider, model, temperature, reasoningEffort, maxOutputTokens, seed, endpoint
- `HarnessConfiguration` — harness-specific configuration

**Schema definitions** (SPEC.md §24, §25):
- `benchmark.schema.json` — Benchmark configuration YAML schema
- `run.schema.json` — Run record schema
- `trace-event.schema.json` — Trace event schema
- `evidence-report.schema.json` — Agent evidence report schema
- `results.schema.json` — Verification results schema

### 2.2 `runner`

The `runner` package coordinates the full experiment lifecycle (SPEC.md §15).

**Responsibilities** (SPEC.md §15.1):
- Load benchmark configuration from YAML
- Validate the specification bundle
- Create a fresh workspace for each run
- Copy visible assets into the workspace
- Mount protected assets as read-only
- Initialize the selected harness adapter
- Execute the coding agent via the harness
- Record terminal and tool activity
- Enforce budgets (wall-clock time, model calls, tokens, cost, disk, memory)
- Terminate unauthorized activity
- Run public verification
- Run hidden verification
- Run mutation testing
- Run policy checks
- Generate normalized metrics
- Store all run artifacts
- Produce comparison reports

**Runner interface** (SPEC.md §15.2):
```typescript
interface BenchmarkRunner {
  run(config: RunConfiguration): Promise<RunRecord>;
  verify(runId: string): Promise<VerificationSummary>;
  compare(runIds: string[]): Promise<ComparisonReport>;
}
```

### 2.3 `evaluator`

The `evaluator` package executes the verification pipeline (SPEC.md §19). It manages the 12-stage verification process, separates public verification (visible to the agent) from hidden verification (executed outside the workspace), and produces normalized `VerificationResult` objects.

**Key responsibilities**:
- Execute verification stages in defined order (SPEC.md §19.1)
- Apply fail-fast policy for interactive loops, run-all policy for final evaluation (SPEC.md §19.2)
- Compare agent-claimed evidence against observed execution (SPEC.md §20)
- Classify failures using the normalized failure taxonomy (SPEC.md §23)
- Compute mutation score and property-test outcomes (SPEC.md §11, §10)

### 2.4 `trace`

The `trace` package collects normalized events in JSON Lines format (SPEC.md §21).

**TraceEvent schema** (SPEC.md §21):
```typescript
interface TraceEvent {
  timestamp: string;
  runId: string;
  sequence: number;
  source: "runner" | "harness" | "model" | "shell" | "verification" | "policy";
  type: string;
  payload: Record<string, unknown>;
}
```

**Representative event types** (SPEC.md §21):
- `run.started`, `run.completed`
- `model.request`, `model.response`
- `tool.request`, `tool.result`
- `shell.command.started`, `shell.command.completed`
- `file.modified`
- `protected_file.write_attempt`
- `verification.started`, `verification.completed`
- `policy.violation`
- `budget.warning`, `budget.exhausted`

### 2.5 `metrics`

The `metrics` package computes and aggregates measurements across five dimensions (SPEC.md §22):

1. **Correctness**: public-test pass rate, hidden-test pass rate, property-test pass rate, contract-compliance rate, mutation score, violated invariants, unresolved defects, final verification status
2. **Efficiency**: wall-clock time, time to first public green, time to final evaluation, model calls, input/output tokens, estimated cost, shell commands, verification iterations, files changed, lines added/removed
3. **Safety and policy**: protected-file modification attempts, network-access attempts, disallowed dependency attempts, secret-scan findings, policy violations, unauthorized filesystem access, unsafe shell commands, resource-limit violations
4. **Robustness**: hidden/public performance gap, mutation survival count, seed-to-seed variance, repeated-run success rate, implementation diversity, failure recurrence rate, regression count
5. **Evidence quality**: claimed-versus-observed check agreement, false success claims, missing uncertainty disclosures, trace completeness, evidence-report schema compliance

Human involvement metrics (SPEC.md §22.6) track interventions but MVP experiments target zero intervention.

### 2.6 `policies`

The `policies` package defines and enforces operational constraints (SPEC.md §18, §33).

**Dependency policy** (SPEC.md §18):
- Explicit allowlist of permitted packages (e.g., fastify, zod, decimal.js, uuid, pino)
- Block-all default for unlisted packages
- Rejects undeclared dependencies, Git-based packages, direct URL dependencies, local path dependencies outside workspace, post-install scripts where prohibited, package-lock mutations after final verification, packages with disallowed licenses

**Network policy** (SPEC.md §33):
- External network access disabled by default
- Network-access attempts recorded as policy violations
- Host networking disabled in container configuration

**Filesystem policy** (SPEC.md §33):
- Protected paths (`/spec`, `/evaluator`, `/policies`, `/hidden`, `/benchmark-config`) enforced as read-only mounts
- Shell commands targeting protected paths rejected
- Filesystem-escape attempts detected and logged

### 2.7 `reporting`

The `reporting` package generates output artifacts (SPEC.md §29):

**Output formats**:
- Markdown report
- JSON summary
- CSV results
- Per-run summaries

**Comparison dimensions**:
- Model comparison, harness comparison, profile comparison
- Failure distribution
- Cost-quality plots, time-quality plots
- Seed variance statistics

**Recommended visualizations** (SPEC.md §29):
- Hidden-test performance by profile
- Mutation score by model-harness pair
- Cost versus hidden-test pass rate
- Time to green versus final robustness
- Failure-category frequency
- Seed variance
- Public versus hidden pass-rate gap

### 2.8 `harness-adapters`

The `harness-adapters` package implements the `AgentHarness` interface for each coding-agent platform (SPEC.md §13).

**Initial adapters (MVP)**:
- Codex CLI adapter
- Claude Code adapter (or generic command-driven adapter)

**Planned later adapters** (SPEC.md §13.4):
- Factory Droid, OpenHands, Cline, Aider, Goose, Custom SDK-based agent

**Fake harness** (SPEC.md §40):
A deterministic fake harness must be implemented before integrating commercial agents. It supports scenarios including successful implementation copy, build failure, timeout, protected-file modification attempt, false success claim, budget exhaustion, partial implementation, and repeated unproductive commands. It enables deterministic CI testing without model cost.

---

## 3. Runner Lifecycle

The runner orchestrates four sequential phases (SPEC.md §15):

### 3.1 Phase 1: Prepare

- Load and validate benchmark configuration from YAML (SPEC.md §25)
- Create a fresh workspace directory for the run
- Copy visible assets into the workspace: OpenAPI spec, public tests, linter config, type-checking config, invariant documentation, allowed dependency list, build/run instructions, behavioral scenarios (SPEC.md §9.1)
- Mount protected assets read-only: `/spec`, `/evaluator`, `/policies`, `/hidden`, `/benchmark-config` (SPEC.md §9.3)
- Initialize the selected harness adapter with `PrepareInput` (SPEC.md §13.1)
- Record initial environment state

### 3.2 Phase 2: Execute

- Invoke `harness.execute()` with the prepared run (SPEC.md §13.2)
- The harness launches the coding agent in the isolated container
- The runner monitors the agent via trace events, enforcing budgets (SPEC.md §21)
- Execute terminates when the agent completes, a budget is exhausted, a policy is violated, or a timeout occurs (SPEC.md §13.3)

### 3.3 Phase 3: Verify

- Run public verification stages visible to the agent (SPEC.md §19.1, §9.1)
- Run hidden verification stages outside the agent workspace (SPEC.md §19.1, §9.2)
- Execute all applicable stages even after some failures unless continuing would be unsafe or impossible (SPEC.md §19.2)
- Collect verification results with stage-level status, metrics, artifacts, and failure categorization (SPEC.md §19.3)

### 3.4 Phase 4: Report

- Compute metrics across all dimensions (SPEC.md §22)
- Generate run artifacts: run.json, environment.json, task.md, prompt.txt, model.json, harness.json, trace.jsonl, stdout.log, stderr.log, workspace snapshot, diffs, verification results, evidence reports, metrics.json, failures.json, summary.md (SPEC.md §27)
- Classify failures using the normalized failure taxonomy (SPEC.md §23)
- Optionally produce comparison reports across multiple runs (SPEC.md §29)

---

## 4. Harness Abstraction Layer

The harness abstraction ensures the benchmark treats model and harness as separate variables (SPEC.md §13, §13.4).

### 4.1 AgentHarness Interface

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

### 4.2 Adapter Pattern

Each coding-agent platform requires a concrete adapter that implements the `AgentHarness` interface. The adapter encapsulates platform-specific behavior including:

- How the agent receives the task prompt
- How the agent interacts with the filesystem and tools
- How model requests and responses are recorded
- How the agent is terminated when budgets are exhausted
- How execution artifacts are collected

The benchmark must distinguish the model from the harness. A harness identifier must not implicitly encode the model (SPEC.md §13.4).

### 4.3 Key Input/Output Types

**PrepareInput** (SPEC.md §13.1): runId, workspacePath, taskPrompt, model (ModelConfiguration), limits (RunLimits), environment variables

**ExecuteInput** (SPEC.md §13.2): runId, preparedRun (PreparedRun)

**ExecutionResult** (SPEC.md §13.3): status ("completed" | "failed" | "timeout" | "budget_exhausted" | "policy_terminated"), startedAt, completedAt, exitCode, reportedCompletion, modelUsage, error

---

## 5. Verification Pipeline

The verification pipeline executes up to 13 stages (Stages 0 through 12) in defined order (SPEC.md §19.1).

### 5.1 Stage Order

| Stage | Name | Description | Visibility |
|---|---|---|---|
| 0 | Workspace integrity | Verify protected files are unmodified | System |
| 1 | Install | Execute `pnpm install --offline --frozen-lockfile` | Public |
| 2 | Build | Execute `pnpm build` | Public |
| 3 | Lint | Execute `pnpm lint` | Public |
| 4 | Typecheck | Execute `pnpm typecheck` | Public |
| 5 | Public tests | Execute `pnpm test:public` | Public |
| 6 | Contract validation | Validate against OpenAPI schema | Public |
| 7 | Hidden tests | Execute `pnpm test:hidden` | Hidden |
| 8 | Property tests | Execute `pnpm test:property` | Hidden |
| 9 | Mutation testing | Execute `pnpm test:mutation` | Hidden |
| 10 | Security and policy checks | Dependency allowlist, secret scan, license scan, network policy | System |
| 11 | Performance checks | Load test, memory check, observability check | System |
| 12 | Evidence validation | Compare agent-claims against observed execution | System |

### 5.2 Public vs. Hidden Verification

Public verification (SPEC.md §9.1): The agent may inspect and run OpenAPI specification, public integration tests, public example tests, linter configuration, type-checking configuration, invariant documentation, allowed dependency list, build and run instructions, and behavioral scenarios.

Hidden verification (SPEC.md §9.2): The agent must not inspect hidden tests, hidden property generators, mutation-testing configuration, benchmark scoring logic, adversarial payload sets, expected implementation-independent traces, or evaluator credentials. Hidden verification must run outside the agent workspace.

### 5.3 Fail-Fast Policy

Interactive agent loops may run public checks repeatedly. Final evaluation should execute all applicable stages even after some failures, unless continuing would be unsafe or impossible (SPEC.md §19.2). This preserves diagnostic information.

### 5.4 Verification Result Schema

```typescript
interface VerificationResult {
  stage: string;
  status: "passed" | "failed" | "skipped" | "error";
  startedAt: string;
  completedAt: string;
  exitCode?: number;
  metrics: Record<string, number | string | boolean>;
  artifacts: string[];
  failureCategory?: FailureCategory;
}
```

(SPEC.md §19.3)

---

## 6. Trust Boundaries

The architecture defines three distinct trust zones (SPEC.md §9.3, §17, §33):

### 6.1 Agent Workspace (Low Trust)

- Writable directory where the agent creates the implementation
- Contains only visible assets copied from the benchmark bundle
- Subject to disk and memory limits (default: 1 GB disk, 2 GB memory) (SPEC.md §16.1)
- No access to protected mounts, hidden tests, or evaluator logic
- Code generated here is untrusted until verified

### 6.2 Protected Mounts (Read-Only, Medium Trust)

The following paths are immutable from the agent's perspective (SPEC.md §9.3):
- `/spec` — Benchmark specification
- `/evaluator` — Evaluator code and configuration
- `/policies` — Policy definitions
- `/hidden` — Hidden tests, property generators, mutation configuration
- `/benchmark-config` — Benchmark configuration

Attempts to modify protected assets must be blocked when technically possible, logged as policy violations, cause the run to fail if modification succeeds, and remain visible in the final trace (SPEC.md §9.3).

### 6.3 Evaluator (High Trust)

- Runs outside the agent workspace
- Has access to both public and hidden verification assets
- Executes in a separate process/container context
- Produces the authoritative final result
- Is validated by evaluator self-tests and a reference human implementation (SPEC.md §31.3, §32.1)

### 6.4 Security Requirements

The runner must (SPEC.md §33):
- Execute containers as non-root
- Disable privileged mode
- Disable host networking
- Prevent host filesystem mounts except explicit run directories
- Restrict Linux capabilities
- Set process and memory limits
- Enforce timeouts
- Sanitize provider credentials
- Redact secrets from logs
- Avoid storing full API credentials in run artifacts
- Reject shell commands targeting protected paths
- Record network-access attempts
- Validate generated package manifests
- Run secret scanning before artifact publication
- Never execute untrusted generated code directly on the host

---

## 7. Policy Model

### 7.1 Dependency Policy

The dependency policy enforces an explicit allowlist of permitted packages (SPEC.md §18).

For the initial TypeScript implementation, allowed production dependencies may include: HTTP server framework, schema-validation library, decimal arithmetic library, UUID library, and structured logger (SPEC.md §18).

A dependency policy checker must reject (SPEC.md §18):
- Undeclared dependencies
- Git-based packages
- Direct URL dependencies
- Local path dependencies outside the workspace
- Post-install scripts where prohibited
- Package-lock mutations after final verification
- Packages with disallowed licenses

### 7.2 Network Policy

External network access is disabled by default (SPEC.md §17, §33). Network-access attempts are recorded and treated as policy violations. Host networking is disabled in the Docker container configuration.

### 7.3 Filesystem Policy

The filesystem policy enforces read-only mounts for all protected paths (SPEC.md §9.3, §33). Shell commands that attempt to write to protected paths are rejected. Filesystem escape attempts (e.g., accessing paths outside the container) are detected and logged.

---

## 8. Trace and Observability Architecture

The trace system collects all observable actions into a normalized JSON Lines event stream (SPEC.md §21).

### 8.1 Event Schema

Each `TraceEvent` includes a timestamp, runId, monotonic sequence number, source component, event type, and free-form payload. Sources include the runner, harness, model, shell, verification, and policy subsystems (SPEC.md §21).

### 8.2 Event Types

Core lifecycle events: `run.started`, `run.completed`. Model interaction events: `model.request`, `model.response`. Tool events: `tool.request`, `tool.result`. Shell events: `shell.command.started`, `shell.command.completed`. Security events: `protected_file.write_attempt`, `policy.violation`. Budget events: `budget.warning`, `budget.exhausted`. Verification events: `verification.started`, `verification.completed`.

### 8.3 Observability Principles

Raw model reasoning should not be required. The benchmark evaluates observable actions, requests, outputs, and state transitions (SPEC.md §21). The trace is the authoritative record of agent behavior and is used to validate the agent's self-reported evidence.

---

## 9. Run Artifact Structure and Data Flow

### 9.1 Run Artifact Directory

Each run produces a complete artifact directory under `runs/<run-id>/` (SPEC.md §27):

```
runs/<run-id>/
├── run.json                    # Run record
├── environment.json            # Environment metadata
├── task.md                     # Task instruction
├── prompt.txt                  # Exact prompt sent to agent
├── model.json                  # Model configuration
├── harness.json                # Harness configuration
├── trace.jsonl                 # Full trace event log
├── stdout.log                  # Container stdout
├── stderr.log                  # Container stderr
├── workspace/                  # Snapshot of generated implementation
├── diffs/
│   └── final.patch             # Diff from initial workspace state
├── verification/
│   ├── build.json
│   ├── lint.json
│   ├── typecheck.json
│   ├── public-tests.json
│   ├── hidden-tests.json
│   ├── property-tests.json
│   ├── mutation-tests.json
│   └── policies.json
├── evidence/
│   ├── agent-report.json       # Agent's self-reported evidence
│   └── evaluator-report.json   # Evaluator's independent assessment
├── metrics.json                # Computed metrics
├── failures.json               # Normalized failure classifications
└── summary.md                  # Human-readable summary
```

### 9.2 Data Flow

1. Configuration flows from `benchmarks/<app>/benchmark.yaml` through `benchmark-core` to configure the runner
2. Visible assets flow from `benchmarks/<app>/visible/` into the agent workspace
3. Hidden assets remain in `benchmarks/<app>/hidden/` and are only accessible to the evaluator
4. The agent produces implementation files in the workspace
5. The harness produces trace events, collected by the trace package
6. The evaluator runs verification stages against the workspace
7. Metrics aggregate verification results and trace data
8. Reports consume metrics and produce formatted output

---

## 10. Deployment Topology

### 10.1 Docker Isolation

Each run executes in a Docker container with the following isolation properties (SPEC.md §17):
- Read-only benchmark specification mount
- Writable implementation directory
- No host Docker socket
- No external network
- Non-root user
- CPU and memory limits
- Process-count limits
- Temporary filesystem
- Explicit command timeout
- Workspace deleted or archived after completion

### 10.2 Container Images

Container images are versioned and content-addressed where practical (SPEC.md §17). Example: `ghcr.io/rmax-ai/regenerable-software-lab/node-runner:0.1.0`. The benchmark records the image digest for each run. The MVP uses a single Node.js runtime image (SPEC.md §37).

### 10.3 Recommended MVP Stack

- TypeScript, Node.js, pnpm workspaces, Docker (SPEC.md §35)
- Fastify for the benchmark service
- Zod for schema validation
- Decimal.js for monetary arithmetic
- Vitest for testing
- fast-check for property-based tests
- StrykerJS for mutation testing
- ESLint, TypeScript strict mode
- JSON Schema for artifact schemas
- SQLite or filesystem storage for experiment metadata
- Markdown and CSV report output

---

## 11. API and Data Model

### 11.1 Run Configuration (RunConfiguration)

```typescript
interface RunConfiguration {
  runId: string;
  benchmarkVersion: string;
  applicationId: string;
  profile: "basic" | "behavioral" | "operational";
  harness: HarnessConfiguration;
  model: ModelConfiguration;
  seed: number;
  limits: RunLimits;
}
```

(SPEC.md §16)

### 11.2 Run Limits (RunLimits)

```typescript
interface RunLimits {
  wallClockSeconds: number;
  maxModelCalls?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxCostUsd?: number;
  maxVerificationAttempts?: number;
  maxDiskMb?: number;
  maxMemoryMb?: number;
}
```

Default MVP limits: wall-clock time 30 minutes, verification attempts 20, workspace disk 1 GB, memory 2 GB, external network disabled (SPEC.md §16.1).

### 11.3 Verification Result

```typescript
interface VerificationResult {
  stage: string;
  status: "passed" | "failed" | "skipped" | "error";
  startedAt: string;
  completedAt: string;
  exitCode?: number;
  metrics: Record<string, number | string | boolean>;
  artifacts: string[];
  failureCategory?: FailureCategory;
}
```

(SPEC.md §19.3)

### 11.4 Trace Event

```typescript
interface TraceEvent {
  timestamp: string;
  runId: string;
  sequence: number;
  source: "runner" | "harness" | "model" | "shell" | "verification" | "policy";
  type: string;
  payload: Record<string, unknown>;
}
```

(SPEC.md §21)

### 11.5 Evidence Report

Each agent must produce `evidence-report.json` (SPEC.md §20):

```typescript
interface EvidenceReport {
  runId: string;
  implementationSummary: string;
  filesChanged: string[];
  commandsExecuted: string[];
  checksClaimed: ClaimedCheck[];
  assumptions: string[];
  knownLimitations: string[];
  remainingUncertainty: string[];
}

interface ClaimedCheck {
  name: string;
  command?: string;
  claimedStatus: "passed" | "failed" | "not_run";
}
```

The evaluator compares agent claims against observed execution. Evidence metrics include claimed-check accuracy, omitted failed checks, false pass claims, missing command evidence, unsupported certainty, and agreement between report and trace (SPEC.md §20).

### 11.6 Model Configuration

```typescript
interface ModelConfiguration {
  provider: string;
  model: string;
  temperature?: number;
  reasoningEffort?: string;
  maxOutputTokens?: number;
  seed?: number;
  endpoint?: string;
}
```

(SPEC.md §14)

All model parameters available to the harness must be recorded. When the provider does not support a seed, the benchmark seed still controls test data generation, workspace initialization, mutation sampling, run ordering, and hidden-case selection (SPEC.md §14).

---

## 12. Risks, Trade-offs, and Open Questions

### 12.1 Risks

- **Harness reliability**: Reliable harness automation is the highest-risk component (SPEC.md §45). Harness crashes, timeouts, and incomplete traces can invalidate runs.
- **Hidden-test protection**: If hidden tests can be discovered by the agent, the public-hidden verification gap collapses (SPEC.md §31.1).
- **Non-determinism**: API-backed model behavior cannot be made fully reproducible (SPEC.md §42). The benchmark must preserve sufficient metadata to characterize this limitation.
- **Cost control**: Model API costs can escalate quickly in a multi-run experiment (SPEC.md §45). Budget enforcement must be robust.
- **Container escape**: An adversarial agent could attempt to escape Docker isolation, access the host filesystem, or modify evaluator assets (SPEC.md §31.1, §33).

### 12.2 Trade-offs

- **Isolation rigor vs. harness compatibility**: Stronger isolation (e.g., full VM) would improve security but increase setup complexity and reduce harness compatibility. Docker-level isolation is the MVP compromise (SPEC.md §17).
- **Hidden test count vs. cost**: More hidden tests improve measurement robustness but increase evaluation time and cost.
- **Mutation operator breadth vs. noise**: More mutation operators provide broader coverage but increase the risk of equivalent mutants and non-executable mutations (SPEC.md §11).
- **Profile completeness vs. MVP timeline**: Profile C (operational) is deferred from the first release to keep the MVP focused (SPEC.md §8.3, §37).
- **Reproducibility metadata vs. simplicity**: Comprehensive version recording (SPEC.md §42) adds complexity but is essential for meaningful comparison.

### 12.3 Open Questions

- How much do hidden tests reduce visible-test overfitting across different model families? (SPEC.md §3)
- Do property-based tests and invariants provide more value than additional example tests? (SPEC.md §3)
- How strongly does performance depend on the agent harness rather than the underlying model? (SPEC.md §3)
- At what point does verification complexity exceed the capability of a given model-harness combination? (SPEC.md §3)
- How reproducible are generated implementations across repeated seeds? (SPEC.md §3)
- What failure modes recur across models and harnesses? (SPEC.md §3)
- Can benchmark contamination be detected and quantified? (SPEC.md §31.2, §44)
- Will converting observed failures into durable regression cases meaningfully improve benchmark robustness over time? (SPEC.md §4, H6)

---

## 13. Versioning

The project must version: benchmark application, verification profile, evaluator, container image, harness adapter, model configuration, task prompt, and artifact schema (SPEC.md §41). A result is only comparable when relevant versions are compatible.

Recommended benchmark identifier: `order-pricing@0.1.0` (SPEC.md §41).

Changes requiring a major benchmark version: Changed domain behavior, changed hidden-test semantics, changed scoring interpretation, changed allowed implementation capabilities. Changes requiring a minor version: Added hidden cases preserving existing semantics, added metrics, improved reporting, added non-breaking policy checks (SPEC.md §41).

---

## 14. Reproducibility Requirements

Every run must record (SPEC.md §42): Git commit, dirty working-tree status, benchmark version, evaluator version, container digest, operating system, CPU architecture, model provider, model identifier, harness version, prompt hash, visible-specification hash, hidden-evaluator hash, seed, start and completion timestamps, environment-variable allowlist, and dependency lockfile hash.

---

## Appendix A: References to SPEC.md Sections

| Section | Title |
|---|---|
| SPEC.md §1 | Project Summary |
| SPEC.md §3 | Core Research Question |
| SPEC.md §4 | Primary Hypotheses |
| SPEC.md §5 | Non-Goals |
| SPEC.md §6 | Benchmark Application |
| SPEC.md §7 | Domain Invariants |
| SPEC.md §8 | Verification Profiles |
| SPEC.md §9 | Public and Hidden Verification |
| SPEC.md §10 | Metamorphic and Property-Based Tests |
| SPEC.md §11 | Mutation Testing |
| SPEC.md §12 | Agent Task Contract |
| SPEC.md §13 | Harness Abstraction |
| SPEC.md §14 | Model Configuration |
| SPEC.md §15 | Benchmark Runner |
| SPEC.md §16 | Run Configuration |
| SPEC.md §17 | Execution Isolation |
| SPEC.md §18 | Dependency Policy |
| SPEC.md §19 | Verification Pipeline |
| SPEC.md §20 | Evidence Report |
| SPEC.md §21 | Trace Collection |
| SPEC.md §22 | Metrics |
| SPEC.md §23 | Failure Taxonomy |
| SPEC.md §24 | Repository Structure |
| SPEC.md §25 | Benchmark Configuration |
| SPEC.md §26 | CLI |
| SPEC.md §27 | Run Artifact Structure |
| SPEC.md §28 | Experiment Manifest |
| SPEC.md §29 | Reporting |
| SPEC.md §30 | Statistical Treatment |
| SPEC.md §31 | Threat Model |
| SPEC.md §32 | Baselines |
| SPEC.md §33 | Security Requirements |
| SPEC.md §34 | Privacy and Data Handling |
| SPEC.md §35 | Implementation Stack |
| SPEC.md §37 | MVP Scope |
| SPEC.md §38 | MVP Acceptance Criteria |
| SPEC.md §39 | Quality Requirements |
| SPEC.md §40 | Fake Harness |
| SPEC.md §41 | Versioning |
| SPEC.md §42 | Reproducibility Requirements |
| SPEC.md §45 | Solo-Research Feasibility |
