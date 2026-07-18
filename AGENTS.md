# AGENTS.md — Regenerable Software Lab

> AI coding agent conventions for this project.
> Loaded automatically by Codex CLI, Claude Code, and other agents.
> See SPEC.md for the canonical specification.

## Project DNA

**Regenerable Software Lab** is a benchmark for evaluating whether AI coding agents can repeatedly generate software from durable, implementation-independent verification bundles.

Source code is a replaceable candidate implementation. The persistent assets are API contracts, behavioral requirements, invariants, tests, policies, performance budgets, evaluation rules, and historical failure cases that define acceptable system behavior.

## Repo Structure

```
regenerable-software-lab/
├── apps/cli/              # rsl CLI — user-facing entry point
├── apps/report-viewer/    # Optional web dashboard
├── packages/              # 8 workspace packages (see ARCHITECTURE.md §1.1)
├── benchmarks/            # Benchmark definitions (visible + hidden assets)
├── environments/          # Docker images for isolated runs
├── schemas/               # JSON Schema for all artifact types
├── experiments/           # Experiment manifests and configs
├── docs/                  # Architecture, threat model, methodology
├── SPEC.md                # Canonical specification (read-only reference)
```

## Execution Conventions

### Monorepo Management
- **Package manager:** pnpm (workspaces)
- **Install:** `pnpm install`
- **Add dep to package:** `pnpm --filter <package> add <dep>`
- **Build all:** `pnpm build` (runs tsc across all packages)
- **Lint:** `pnpm lint` (ESLint across all packages)
- **Typecheck:** `pnpm typecheck` (tsc --noEmit)

### Package Dependency Rules
- `benchmark-core` — zero internal dependencies (leaf package)
- `trace` — depends on benchmark-core
- `policies` — depends on benchmark-core
- `metrics` — depends on benchmark-core, trace
- `evaluator` — depends on benchmark-core, trace, metrics, policies
- `runner` — depends on benchmark-core, trace, policies
- `reporting` — depends on benchmark-core, metrics
- `harness-adapters` — depends on benchmark-core
- `apps/cli` — depends on runner, reporting, benchmark-core, harness-adapters

### TypeScript Strictness
- `strict: true` in every package tsconfig
- No `any` without explicit justification comment
- All public interfaces exported from package index
- Zod schemas for all external inputs (config files, CLI args, API responses)
- JSON Schema generated from Zod for artifact validation

### Testing Requirements
- **Framework:** Vitest
- **Coverage target:** 80% for core runner and evaluator
- Every package has its own test suite
- E2E tests use the fake harness (no real model calls in CI)
- Golden tests for report generation
- Property tests for metric aggregation
- See `docs/ARCHITECTURE.md` for test architecture

### File Naming
- kebab-case for files and directories
- PascalCase for TypeScript classes and interfaces
- camelCase for functions and variables
- UPPER_SNAKE_CASE for constants and enums

## Architecture Non-Negotiables

1. **Harness-model separation:** A harness identifier never implicitly encodes the model. `AgentHarness` interface treats model as an independent configuration parameter. (SPEC.md §13.4)

2. **Public/hidden boundary:** The agent never receives hidden test source code, mutation configuration, or evaluator logic. Hidden verification runs outside the agent workspace. (SPEC.md §9)

3. **Trace completeness:** Every observable action (model call, shell command, file modification, verification stage) is written to a normalized JSON Lines trace. (SPEC.md §21)

4. **Protected assets:** `/spec`, `/evaluator`, `/policies`, `/hidden`, `/benchmark-config` are immutable from the agent perspective. Modification attempts are logged and cause run failure. (SPEC.md §9.3)

5. **Dependency policy:** Only explicitly allowed dependencies. No git packages, URL deps, or post-install scripts. Package-lock mutations after final verification are rejected. (SPEC.md §18)

6. **Reproducibility:** Every run records full metadata: git commit, container digest, model config, seed, prompt hash, specification hashes, timestamps. (SPEC.md §42)

7. **Fail-soft evaluation:** Final evaluation executes all applicable stages even after failures, preserving diagnostic information. (SPEC.md §19.2)

8. **No hard model dependency:** The benchmark infrastructure works with any model provider. Provider-specific logic is isolated in configuration. (SPEC.md §39)

## What NOT to Do

- Do not modify SPEC.md — it is the canonical reference
- Do not weaken type safety to make tests pass
- Do not use binary floating-point for monetary calculations (use Decimal.js)
- Do not embed provider credentials in code, config, or test fixtures
- Do not assume network access is available during runs
- Do not create circular dependencies between packages
- Do not use `any` without a comment explaining why
- Do not ship generated code without linting and typechecking

## Language-Specific Guidelines

See `docs/TYPESCRIPT_DEVELOPMENT.md` and `docs/TYPESCRIPT_ARCHITECTURE.md` for detailed TypeScript conventions.
These are loaded from the `software-development-standards` skill.

Key points:
- Svelte 5 runes if building the report viewer (`$state`, `$derived`, `$props`)
- One sentence per line in all Markdown files
- No em dashes in any output (code, comments, docs, commits)
- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
