# ROADMAP.md — Regenerable Software Lab

> Phased implementation plan derived from SPEC.md §36.
> Each phase is independently deliverable and verifiable.

---

## Phase 0: Research Protocol

**Focus:** Formalize the research methodology before writing code.

Deliverables:
- [ ] Finalized research questions and hypotheses
- [ ] Benchmark methodology document
- [ ] Failure taxonomy (machine-readable)
- [ ] Threat model document
- [ ] Metric definitions (all reproducible)
- [ ] Experiment manifest schema
- [ ] Public/hidden verification boundary documentation

**Dependencies:** None (pure documentation)
**Estimated effort:** 1 week (part-time)
**Codex sessions:** 0 (human-authored methodology)

**Acceptance criteria:**
- Every metric has a reproducible definition
- Model and harness are treated as separate variables
- Public and hidden verification boundaries are documented
- No projected results are presented as observations

---

## Phase 1: Benchmark Core

**Focus:** Build the order-pricing benchmark and basic evaluator.

Deliverables:
- [ ] Order-pricing OpenAPI specification (`benchmarks/order-pricing/visible/openapi.yaml`)
- [ ] Invariant documents (human-readable: `spec/invariants/pricing.md`, machine-readable: `pricing.yaml`)
- [ ] Public test suite (example-based tests, integration tests)
- [ ] Reference implementation (hand-written, passes all profiles)
- [ ] Basic evaluator (stages 1-6: install, build, lint, typecheck, public tests, contract validation)
- [ ] Profile A configuration
- [ ] JSON Schema for run artifacts
- [ ] Benchmark configuration YAML

**Dependencies:** Phase 0 complete
**Estimated effort:** 1 week
**Codex sessions:** 1-2 (reference implementation), 1 (evaluator scaffold)

**Acceptance criteria:**
- Reference implementation passes all Profile A checks
- Broken implementations fail expected checks
- Protected assets are read-only when mounted
- Results serialize to JSON matching schemas

---

## Phase 2: Behavioral Verification

**Focus:** Hidden tests, property-based tests, and mutation testing.

Deliverables:
- [ ] Hidden test suite (not accessible from agent workspace)
- [ ] Property-based tests (fast-check generators for all properties in SPEC.md §10)
- [ ] Metamorphic test cases
- [ ] Mutation testing configuration (StrykerJS, all operators from SPEC.md §11)
- [ ] Profile B configuration
- [ ] Evaluator stages 7-9 (hidden tests, property tests, mutation testing)
- [ ] Mutation score computation with equivalent mutant classification

**Dependencies:** Phase 1 complete
**Estimated effort:** 1 week
**Codex sessions:** 1 (property tests), 1 (hidden tests), 1 (mutation config)

**Acceptance criteria:**
- Known injected defects are caught by hidden/property/mutation tests
- Hidden tests cannot be read from the agent workspace
- Mutation score reproducible within acceptable tolerance
- Public-test-only baseline performs worse on hidden verification

---

## Phase 3: Harness Integration

**Focus:** Connect real coding agents through the adapter interface.

Deliverables:
- [ ] `AgentHarness` interface implementation
- [ ] Generic CLI adapter (command-driven, model-agnostic)
- [ ] Codex CLI adapter
- [ ] Second harness adapter (Claude Code or Droid)
- [ ] Fake harness (deterministic, all scenarios from SPEC.md §40)
- [ ] Trace normalization for different harness output formats
- [ ] Budget enforcement (wall clock, model calls, tokens, cost)
- [ ] Container isolation (Dockerfile, read-only mounts, no network)

**Dependencies:** Phase 2 complete
**Estimated effort:** 1 week
**Codex sessions:** 2-3 (adapters), 1 (fake harness), 1 (container)

**Acceptance criteria:**
- Both harnesses can execute the same benchmark task
- Run artifacts use identical schema regardless of harness
- Timeouts and termination work reliably
- Model usage recorded when available from harness
- Fake harness passes all CI tests without real model calls

---

## Phase 4: Experiment Runner

**Focus:** Matrix execution, comparison, and reporting.

Deliverables:
- [ ] Experiment manifest parsing and validation
- [ ] Matrix execution engine (runs independent configurations in parallel)
- [ ] Run resumption (skip completed runs)
- [ ] Failure isolation (one failed run does not terminate experiment)
- [ ] Comparison report generation (model × harness × profile)
- [ ] Markdown, JSON, and CSV report output
- [ ] Visualization generation (pass rate by profile, mutation score, cost-quality plots)

**Dependencies:** Phase 3 complete
**Estimated effort:** 1 week
**Codex sessions:** 2 (matrix engine), 1 (reporting), 1 (visualizations)

**Acceptance criteria:**
- Experiment manifest launches multi-run matrix
- Failed run does not terminate full experiment
- Completed runs not repeated unless explicitly requested
- Reports aggregate by model, harness, profile, and seed

---

## Phase 5: Operational Profile

**Focus:** Security and operational verification (Profile C).

Deliverables:
- [ ] Dependency allowlist checker (rejects undeclared, git, URL, local path deps)
- [ ] Secret scanning (detects credentials in generated code and artifacts)
- [ ] License scanning (rejects disallowed licenses)
- [ ] Network policy enforcement (block and log access attempts)
- [ ] Performance tests (load test with latency/throughput budgets)
- [ ] Memory budget checks
- [ ] Observability checks (structured logging, health endpoint)
- [ ] Evidence report validation
- [ ] Profile C configuration

**Dependencies:** Phase 4 complete
**Estimated effort:** 1 week
**Codex sessions:** 2 (policy checkers), 1 (performance tests)

**Acceptance criteria:**
- Deliberately unsafe implementations fail operational checks
- Network attempts blocked and logged in trace
- Dependency violations reproducibly detected
- Performance results stored in normalized form
- Evidence reports validated against claims

---

## Phase 6: Publication Package

**Focus:** Reproducible research artifact and documentation.

Deliverables:
- [ ] Public GitHub repository with full history
- [ ] Methodology article (see SPEC.md §43.1)
- [ ] Reproducible experiment configuration (smoke test: 8 runs)
- [ ] Selected run artifacts (anonymized, no secrets)
- [ ] Results dataset (CSV + JSON)
- [ ] Limitations section (honest about what the benchmark does and doesn't measure)
- [ ] Contributing guide
- [ ] README with quickstart (clone, build, fake harness, real run)

**Dependencies:** Phase 5 complete, initial experimental runs
**Estimated effort:** 2 weeks
**Codex sessions:** 1 (dataset packaging), 1 (README/docs cleanup)

**Acceptance criteria (Definition of Done, SPEC.md §46):**
- Third party can clone, build, run fake harness, run real agent
- Public and hidden verification execute separately
- Complete trace inspectable
- Two runs comparable
- Published experiment configuration reproducible
- Benchmark limitations documented
- No secrets or private data in repository

---

## Timeline (Part-Time, ~2-3 hours/day)

| Week | Phase | Focus |
|------|-------|-------|
| 1 | 0 | Methodology, schemas, benchmark contract |
| 2 | 1 | Reference API, public tests, Profile A |
| 3 | 2 | Runner, container isolation, fake harness |
| 4 | 3 | Hidden tests, property tests, mutation testing |
| 5 | 4 | First real harness adapter, trace collection |
| 6 | 4-5 | Second harness adapter, experiment runner |
| 7 | 5-6 | Initial runs, failure analysis |
| 8 | 6 | Reporting, documentation, publication |

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Harness automation unreliable | High | Blocks Phase 3-4 | Start fake harness early; test adapters incrementally |
| Hidden test protection insufficient | Medium | Invalidates results | Use Docker read-only mounts + filesystem watches |
| Model API changes break adapters | Medium | Ongoing maintenance | Version-lock harness adapters; record full model config per run |
| Experiment cost exceeds budget | Medium | Reduces statistical power | Smoke test with 2 seeds first; scale up only when pipeline works |
| Container escape undiscovered | Low | Critical | Prefer non-root user, minimal capabilities, no host Docker socket |
| Benchmark contamination | Low | Invalidates future runs | Version all benchmark assets; detect dirty working trees |
