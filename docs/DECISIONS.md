# DECISIONS.md — Regenerable Software Lab

> Architecture Decision Records (ADRs) for Regenerable Software Lab.
> Format: Context, Decision, Alternatives Considered, Consequences, Status.
> See `docs/ARCHITECTURE.md` for the full architecture.

---

## ADR-001: TypeScript Monorepo with pnpm Workspaces

**Status:** Accepted

**Context:**
The benchmark infrastructure requires multiple packages (runner, evaluator, trace, metrics, policies, reporting, harness adapters) sharing common types and schemas. The benchmark application itself is also TypeScript (Fastify API). A monorepo avoids version drift between interdependent packages.

**Decision:**
Use pnpm workspaces with the structure defined in SPEC.md §24. `packages/benchmark-core` is the leaf package with zero internal dependencies. All other packages depend on it through workspace protocol (`workspace:*`).

**Alternatives considered:**
- NPM workspaces: Less strict dependency resolution, no `workspace:*` protocol.
- Yarn workspaces: Similar to pnpm, but pnpm's strict mode catches undeclared dependencies.
- Separate repos: Version drift risk, complex CI orchestration.

**Consequences:**
- Single `pnpm install` at root installs all packages.
- `pnpm --filter <pkg>` for package-scoped commands.
- TypeScript project references for fast incremental builds.
- Stricter dependency management (pnpm does not hoist by default).

---

## ADR-002: Docker Isolation with Read-Only Mounts

**Status:** Accepted

**Context:**
The benchmark must prevent AI coding agents from modifying protected assets (tests, evaluator, policies) and accessing external networks. The agent runs inside a container with limited privileges.

**Decision:**
Use Docker containers with:
- Read-only mounts for `/spec`, `/evaluator`, `/policies`, `/hidden`, `/benchmark-config`
- Writable `/workspace` for the agent's implementation directory
- No host Docker socket
- No external network (`--network none`)
- Non-root user
- CPU and memory limits
- Temporary filesystem (`--tmpfs`)
- Versioned, content-addressed images (e.g., `ghcr.io/rmax-ai/regenerable-software-lab/node-runner:0.1.0`)

**Alternatives considered:**
- Firecracker microVMs: Better isolation but higher operational complexity, no Docker ecosystem.
- gVisor: Additional sandboxing layer but adds complexity.
- Process-level isolation (chroot, seccomp): Weaker than containers, harder to configure consistently.

**Consequences:**
- Each run gets a fresh container instance.
- Image digest recorded for reproducibility.
- Agent cannot access network or protected paths.
- Workspace deleted or archived after completion.
- Requires Docker daemon on the host (acceptable for research use).

---

## ADR-003: Harness Abstraction via AgentHarness Interface

**Status:** Accepted

**Context:**
The benchmark must support multiple coding-agent harnesses (Codex CLI, Claude Code, Droid, etc.) through a common interface. The benchmark must distinguish model capability from harness capability — harness identifiers must not implicitly encode the model.

**Decision:**
Implement the `AgentHarness` interface (SPEC.md §13) with a `prepare → execute → terminate → collectArtifacts` lifecycle. Each harness adapter is a separate package under `packages/harness-adapters/`. The model configuration is passed independently of the harness identifier.

**Alternatives considered:**
- Subprocess-only approach: Simpler, but cannot normalize traces across different agent architectures.
- SDK-only approach: Ties benchmark to specific agent SDKs, limiting extensibility.
- Hardcoded harness list: No extension point for new harnesses.

**Consequences:**
- New harnesses require implementing the `AgentHarness` interface.
- Trace normalization is a per-adapter concern (each adapter maps its native output to the common trace schema).
- The fake harness (`packages/harness-adapters/fake/`) enables CI testing without real models.

---

## ADR-004: JSON Lines Trace Format

**Status:** Accepted

**Context:**
The benchmark must record every observable action (model calls, shell commands, file modifications, verification stages) in a normalized format for analysis and reproducibility.

**Decision:**
Use JSON Lines (`.jsonl`) format — one JSON object per line — for trace events. Each event follows the `TraceEvent` schema (SPEC.md §21). Sources: `runner`, `harness`, `model`, `shell`, `verification`, `policy`.

**Alternatives considered:**
- Structured logging (e.g., pino): Good for observability but harder to query and analyze post-hoc.
- SQLite: Better queryability but more complex to inspect and share.
- OpenTelemetry: Standard but heavy for a research benchmark; adds operational dependencies.

**Consequences:**
- Traces are line-delimited, append-only, and streamable.
- Easy to grep, jq, and analyze with standard tools.
- Each run produces a single `trace.jsonl` file alongside other artifacts.
- Raw model reasoning is not required in traces — only observable actions and outputs.

---

## ADR-005: Decimal.js for Monetary Arithmetic

**Status:** Accepted

**Context:**
The order-pricing benchmark involves monetary calculations (subtotal, discounts, tax, grand total). Binary floating-point arithmetic (IEEE 754) produces rounding errors that are unacceptable for financial applications.

**Decision:**
Use Decimal.js for all monetary arithmetic. All monetary values are stored and transmitted as strings in API responses and persistence. The benchmark explicitly tests that binary floating-point is not used for final financial calculations.

**Alternatives considered:**
- Big.js: Smaller but less feature-rich for complex operations.
- Native BigInt with fixed-point: Works but requires manual decimal place management.
- currency.js: Simpler API but less precision control.

**Consequences:**
- All monetary fields in schemas are `string` type with decimal validation.
- Mutation operator "Use binary floating-point values" specifically tests this constraint.
- Reference implementation and all generated implementations must use Decimal.js or equivalent.

---

## ADR-006: Vitest over Jest

**Status:** Accepted

**Context:**
The benchmark infrastructure and benchmark application need a test framework. The monorepo uses pnpm and TypeScript.

**Decision:**
Use Vitest for all testing (unit, integration, property-based tests via fast-check). Jest is avoided due to slower startup, more complex TypeScript configuration, and weaker ESM support.

**Alternatives considered:**
- Jest: Mature ecosystem but slower, requires additional TypeScript configuration.
- Mocha + Chai: More manual setup, no built-in watch mode.
- Node built-in test runner: Still maturing, less ecosystem support.

**Consequences:**
- Single test framework for both benchmark infrastructure and benchmark applications.
- Vitest works natively with TypeScript and ESM.
- fast-check integrates with Vitest for property-based testing.
- CI uses `vitest run`; development uses `vitest` (watch mode).

---

## ADR-007: Fail-Soft Verification Pipeline

**Status:** Accepted

**Context:**
The 12-stage verification pipeline (SPEC.md §19) can fail at any stage. Stopping after the first failure loses diagnostic information about later stages.

**Decision:**
Interactive agent loops may run public checks repeatedly with fail-fast behavior. However, the final evaluation executes all applicable stages even after some failures, unless continuing would be unsafe or impossible (e.g., build failure preventing test execution).

**Alternatives considered:**
- Strict fail-fast: Faster but loses diagnostic information; harder to classify failures.
- Always run all stages: May waste time on stages that cannot succeed (e.g., tests after build failure).

**Consequences:**
- Final evaluation reports all stage results, not just the first failure.
- Each stage result has independent status (passed/failed/skipped/error).
- Failure categories can be more precise (multiple labels per run).
- Evaluator must handle cascading dependencies (e.g., skip hidden tests if public tests fail to build).

---

## ADR-008: Minimum 3 Seeds per Configuration

**Status:** Accepted

**Context:**
AI coding agent performance varies across seeds. Comparing models or harnesses with a single seed produces unreliable conclusions.

**Decision:**
Minimum 3 seeds per configuration for preliminary results; 5 seeds recommended. Results with fewer than 3 seeds must be labeled as preliminary. Bootstrap confidence intervals reported where useful.

**Alternatives considered:**
- Single seed: Fastest but statistically meaningless for generalization.
- 10+ seeds: Better statistics but cost-prohibitive for commercial models.

**Consequences:**
- Full matrix (2 profiles × 2 models × 2 harnesses × 3 seeds = 24 runs) is the MVP target.
- Smoke test (8 runs) uses 2 seeds — labeled as preliminary.
- Experiment manifest supports arbitrary seed counts per configuration.
