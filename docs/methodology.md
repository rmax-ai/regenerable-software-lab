# Verification-First Software Engineering: Durable Specifications and Regenerable Code

> **Document version:** 1.0.0-draft
> **Source:** This document derives from SPEC.md, the canonical project specification.
> **Traceability:** Section references (e.g., SPEC.md §3) link each element to the original specification.
> **Format:** One sentence per line. No em dashes.

## Abstract

AI coding agents can generate plausible software implementations from natural language prompts, but evaluating whether those implementations are correct, robust, and operationally sound remains an open methodological challenge. Existing benchmarks primarily measure issue-resolution rates against existing repositories and do not isolate the relationship between specification quality, verification strength, model capability, harness design, and implementation robustness. This paper presents the methodology for Regenerable Software Lab, an experimental benchmark that treats source code as a replaceable candidate implementation and evaluates whether AI coding agents can repeatedly generate a software system from a durable, implementation-independent verification bundle. The benchmark uses a small HTTP order-pricing API as the target application and defines three progressive verification profiles that add hidden tests, property-based tests, mutation testing, and operational policy checks. The methodology defines metrics across five dimensions (correctness, efficiency, safety and policy, robustness, and evidence quality), a normalized failure taxonomy with six categories, and a statistical approach that emphasizes descriptive statistics and bootstrap resampling over significance testing. The benchmark separates visible tests that agents can inspect from hidden tests that run outside the agent workspace, enabling measurement of visible-test overfitting. This document serves as the research protocol for Phase 0 of the project and provides the methodological foundation for future results publication.

## 1. Introduction

AI coding agents have progressed rapidly from proof-of-concept demonstrations to tools that developers integrate into daily workflows. These agents receive natural language or structured task descriptions, interact with filesystems and shell environments, and produce executable software artifacts. Early evaluations suggest that agents can resolve a meaningful fraction of software engineering tasks, but the community lacks rigorous methods to assess whether generated implementations are genuinely correct rather than merely plausible.

The core difficulty is that current benchmarks evaluate issue resolution against an existing repository. An agent works within a pre-existing codebase, applies targeted edits, and passes or fails based on a test suite. This setup conflates several variables that should be separated: the quality and completeness of the specification, the strength of the verification suite, the capability of the underlying model, and the design of the agent harness that mediates model interactions. When an agent fails, it is rarely clear which of these factors caused the failure. When an agent succeeds, it is unclear whether the success would generalize to a different specification, a different verification profile, or a different harness.

Regenerable Software Lab addresses this gap by inverting the evaluation paradigm. Instead of asking an agent to modify an existing codebase, we ask the agent to generate an entire software system from an empty workspace using only a durable specification bundle. The specification bundle contains everything the agent needs to understand the requirements: an OpenAPI contract, behavioral scenarios, domain invariants, allowed dependencies, and public example tests. The source code the agent produces is treated as a replaceable candidate. The persistent assets are the contracts, invariants, tests, policies, and evaluation rules that define acceptable system behavior.

This approach makes several contributions. First, it isolates verification strength as an independent variable by defining progressive verification profiles (SPEC.md §8). Second, it separates model capability from harness capability by recording both as independent configuration parameters (SPEC.md §13, §14). Third, it measures not just whether visible tests pass but whether implementations generalize to hidden tests, survive mutation testing, respect operational policies, and produce reproducible results across repeated seeds (SPEC.md §22). Fourth, it provides a normalized failure taxonomy that enables cross-run comparison of failure modes (SPEC.md §23).

## 2. Research Questions

The central research question that drives this project is (SPEC.md §3): How reliably can AI coding agents generate and regenerate a software system from an implementation-independent verification bundle?

Several secondary questions follow from this central question (SPEC.md §3):

1. Which types of verification assets most improve implementation robustness?
2. How much do hidden tests reduce visible-test overfitting?
3. Do property-based tests and invariants provide more value than additional example tests?
4. How much cost and latency do stronger verification profiles introduce?
5. How strongly does performance depend on the agent harness rather than the underlying model?
6. How reproducible are generated implementations across repeated seeds?
7. What failure modes recur across models and harnesses?
8. At what point does verification complexity exceed the capability of a given model-harness combination?

These questions are designed to be answered through controlled experiments that vary one factor at a time while holding others constant. The benchmark infrastructure supports matrix experiments that iterate over profiles, models, harnesses, and seeds in a factorial design (SPEC.md §28).

## 3. Hypotheses

The project tests six primary hypotheses (SPEC.md §4):

**H1: Visible verification overestimates correctness.** Agents evaluated only against public tests will achieve high visible pass rates while showing lower hidden-test and mutation-testing performance. This hypothesis is foundational to the benchmark design because it motivates the hidden/public separation.

**H2: Heterogeneous verification improves robustness.** A bundle combining contracts, example tests, property-based tests, invariants, and hidden tests will produce more robust implementations than a bundle containing only a larger number of unit tests. This hypothesis tests whether verification diversity matters more than verification volume.

**H3: Operational constraints expose additional failures.** Adding dependency restrictions, network isolation, performance budgets, and secret scanning will reveal failures that functional tests do not detect. This hypothesis extends the evaluation beyond functional correctness into operational readiness.

**H4: Harness effects increase with task complexity.** Differences between coding-agent harnesses will become more significant as the verification bundle becomes more complex. This hypothesis tests whether harness design matters most for difficult tasks.

**H5: Regeneration remains probabilistic.** Repeated runs using the same model, harness, and specification will produce materially different implementation quality, cost, and architecture. This hypothesis acknowledges that current generation processes are stochastic and that reproducibility must be measured rather than assumed.

**H6: Durable failure assets improve future runs.** Converting observed failures into regression cases will increase benchmark robustness and reduce recurrence of previously observed defects. This hypothesis addresses the long-term evolution of the benchmark itself.

These hypotheses are preregistered in the sense that they are documented before data collection begins. The methodology treats them as testable predictions rather than post-hoc explanations.

## 4. Benchmark Application

The benchmark application is an HTTP order-pricing service (SPEC.md §6). The domain was chosen to be small enough for single-session agent generation while exposing several important engineering properties: monetary precision, stateful workflows, input validation, API contract compliance, discount interactions, domain invariants, error handling, persistence boundaries, performance constraints, and security and dependency policies (SPEC.md §6.1).

The generated service must support twelve core capabilities (SPEC.md §6.2): creating an order, adding a product line, updating quantities, removing order lines, applying percentage and fixed discounts, calculating tax, returning itemized price breakdowns, retrieving orders, rejecting invalid state transitions, handling duplicate request identifiers safely, and returning deterministic JSON error responses. The suggested API exposes nine endpoints (SPEC.md §6.3).

The core entities are Order, OrderItem, and Discount with a discriminated union for percentage versus fixed discounts (SPEC.md §6.4). All monetary values must use decimal-safe representations; binary floating-point arithmetic is explicitly prohibited for financial calculations (SPEC.md §6.4).

Eighteen domain invariants are defined separately from the implementation (SPEC.md §7). These invariants include constraints such as "quantity must be a positive integer," "tax must be calculated after discounts," "grand total must never be negative," and "a calculated order cannot be modified unless explicitly reopened." The invariants are documented in both human-readable and machine-readable formats (SPEC.md §7).

## 5. Verification Profiles

The application remains fixed across all experimental conditions. Only the strength of the durable verification bundle changes (SPEC.md §8). This design allows the benchmark to measure how implementation quality responds to increasing verification pressure.

**Profile A: Basic** (SPEC.md §8.1) establishes a baseline generation capability. It includes the OpenAPI contract, public example-based tests, static type checking, linting, build validation, basic integration tests, protected-file enforcement, and no external network access. The expected verification gates are install, build, lint, typecheck, public tests, and API schema validation. Profile A should be solvable by a capable coding agent without specialized harness optimization.

**Profile B: Behavioral** (SPEC.md §8.2) evaluates robustness and visible-test overfitting. It adds hidden tests, property-based tests, domain-invariant checks, mutation testing, invalid-input generation, metamorphic tests, idempotency checks, and concurrency-sensitive cases. The agent does not receive hidden-test source code or mutation configuration. The expected verification gates extend Profile A with hidden tests, property tests, invariant checks, and mutation testing.

**Profile C: Operational** (SPEC.md §8.3) assesses whether functionally valid code also satisfies operational and security boundaries. It adds a dependency allowlist, package-lock validation, secret scanning, license scanning, network egress prohibition, filesystem access restrictions, performance budgets, memory budgets, structured logging requirements, health-check requirements, and evidence-report requirements. Profile C is not required for the first usable release but is supported by the architecture.

## 6. Public and Hidden Verification

The separation of public and hidden verification is a central design element of the benchmark (SPEC.md §9). Public verification assets are those the agent may inspect and run: the OpenAPI specification, public integration tests, public example tests, linter configuration, type-checking configuration, invariant documentation, allowed dependency lists, build and run instructions, and behavioral scenarios (SPEC.md §9.1).

Hidden verification assets are those the agent must not inspect (SPEC.md §9.2): hidden tests, hidden property generators, mutation-testing configuration, benchmark scoring logic, adversarial payload sets, expected implementation-independent traces, and evaluator credentials or runtime metadata. Hidden verification runs outside the agent workspace, typically in a separate evaluation container or process that the agent cannot access.

During a run, specific paths are immutable from the agent's perspective (SPEC.md §9.3): `/spec`, `/evaluator`, `/policies`, `/hidden`, and `/benchmark-config`. Attempts to modify these protected assets are blocked when technically possible, logged as policy violations, cause the run to fail if modification succeeds, and remain visible in the final trace.

This separation enables measurement of the gap between public-test performance and hidden-test performance. A large gap indicates that the agent overfit the visible tests. A small gap indicates that the agent produced a genuinely generalizable implementation.

## 7. Mutation Testing

Mutation testing evaluates whether the verification suite detects intentionally introduced implementation defects (SPEC.md §11). Fifteen initial mutation operators are defined, including replacing addition with subtraction, removing tax application, applying tax before discount, skipping rounding, using binary floating-point values, ignoring duplicate request identifiers, permitting zero quantity, permitting negative discount values, and returning internal exception messages (SPEC.md §11).

The primary mutation metric is the mutation score: the number of killed mutations divided by the number of executable mutations (SPEC.md §11). Equivalent and non-executable mutations are classified separately to avoid inflating the score.

## 8. Metamorphic and Property-Based Tests

The benchmark defines seven metamorphic properties (SPEC.md §10) that should hold for any correct implementation regardless of internal architecture: quantity scaling (doubling quantities doubles subtotal), discount monotonicity (adding a discount does not increase grand total), tax monotonicity (increasing tax rate does not decrease tax total), item permutation (reordering items does not change totals), repeated calculation (calculating an unchanged order twice returns identical totals), serialization stability (serialize-deserialize-calculate preserves results), and fixed discount floor (excessive fixed discounts produce zero taxable amount, not negative values).

These properties are implemented using the ecosystem-standard property-testing library for the chosen language (fast-check for TypeScript). They provide a verification signal that example-based tests cannot capture.

## 9. Metrics

Metrics are organized into five dimensions (SPEC.md §22):

**Correctness** (SPEC.md §22.1): Public-test pass rate, hidden-test pass rate, property-test pass rate, contract-compliance rate, mutation score, number of violated invariants, number of unresolved defects, and final verification status.

**Efficiency** (SPEC.md §22.2): Wall-clock time, time to first public green, time to final evaluation, model calls, input tokens, output tokens, estimated cost, shell commands, verification iterations, files changed, and lines added and removed.

**Safety and policy** (SPEC.md §22.3): Protected-file modification attempts, network-access attempts, disallowed dependency attempts, secret-scan findings, policy violations, unauthorized filesystem access, unsafe shell commands, and resource-limit violations.

**Robustness** (SPEC.md §22.4): Hidden/public performance gap, mutation survival count, seed-to-seed variance, repeated-run success rate, implementation diversity, failure recurrence rate, and regression count after failure-set expansion.

**Evidence quality** (SPEC.md §22.5): Claimed-versus-observed check agreement, false success claims, missing uncertainty disclosures, trace completeness, and evidence-report schema compliance.

A sixth dimension, human involvement (SPEC.md §22.6), tracks interventions but MVP experiments use zero human intervention after execution begins.

## 10. Failure Taxonomy

Every failed run receives one or more normalized failure categories (SPEC.md §23). The taxonomy has six top-level categories:

**Specification failures** (SPEC.md §23): SPEC_AMBIGUITY, SPEC_CONTRADICTION, SPEC_INCOMPLETE, SPEC_MISINTERPRETATION. These occur when the specification itself is unclear, contradictory, or insufficient for the agent to produce a correct implementation.

**Implementation failures** (SPEC.md §23): BUILD_FAILURE, TYPE_ERROR, PUBLIC_TEST_FAILURE, HIDDEN_TEST_FAILURE, PROPERTY_VIOLATION, CONTRACT_VIOLATION, MUTATION_SURVIVOR, PERFORMANCE_FAILURE. These occur when the generated code fails a verification gate.

**Agent behavior failures** (SPEC.md §23): PREMATURE_COMPLETION, REPEATED_UNPRODUCTIVE_LOOP, FAILED_ERROR_RECOVERY, VERIFICATION_NOT_RUN, FALSE_SUCCESS_CLAIM, EXCESSIVE_REWRITE, CONTEXT_LOSS. These occur when the agent's process is flawed even if the code might be correct.

**Policy failures** (SPEC.md §23): PROTECTED_ASSET_MODIFICATION, NETWORK_ACCESS_ATTEMPT, DISALLOWED_DEPENDENCY, SECRET_EXPOSURE, FILESYSTEM_ESCAPE_ATTEMPT, RESOURCE_LIMIT_EXCEEDED. These occur when the agent violates operational boundaries.

**Harness failures** (SPEC.md §23): HARNESS_CRASH, HARNESS_TIMEOUT, TRACE_INCOMPLETE, MODEL_CONFIGURATION_ERROR, TOOL_EXECUTION_ERROR. These occur when the benchmark infrastructure itself fails.

**Evaluation failures** (SPEC.md §23): EVALUATOR_ERROR, NONDETERMINISTIC_TEST, INVALID_MUTATION, ENVIRONMENT_FAILURE. These occur when the evaluation pipeline is compromised.

Failure classifications are machine-readable and support multiple labels per run (SPEC.md §23). This enables aggregation of failure distributions across models, harnesses, and profiles.

## 11. Trace Collection

The benchmark collects normalized events in JSON Lines format (SPEC.md §21). Each trace event contains a timestamp, run identifier, sequence number, source (runner, harness, model, shell, verification, or policy), event type, and payload. Representative event types include run.started, model.request, model.response, tool.request, tool.result, shell.command.started, shell.command.completed, file.modified, protected_file.write_attempt, verification.started, verification.completed, policy.violation, budget.warning, budget.exhausted, and run.completed (SPEC.md §21).

The trace provides a complete observable record of agent behavior without requiring access to internal model reasoning. This design choice preserves agent privacy while enabling detailed behavioral analysis.

## 12. Statistical Approach

The first release of the benchmark is explicitly exploratory and does not overstate statistical significance (SPEC.md §30). For each model-harness-profile combination, the benchmark reports: number of runs, mean, median, minimum, maximum, standard deviation, success proportion, and bootstrap confidence intervals where useful (SPEC.md §30).

The benchmark avoids comparing models using only one seed. The initial recommended minimum is five seeds per configuration. For expensive models, the protocol allows starting with three seeds with results clearly labeled as preliminary (SPEC.md §30).

The statistical approach prioritizes descriptive statistics and effect-size estimation over null-hypothesis significance testing. This choice reflects the reality that API-backed model behavior introduces uncontrolled variance that makes traditional frequentist assumptions difficult to satisfy. The benchmark preserves full run artifacts so that other researchers can apply alternative statistical methods to the same data.

## 13. Limitations

This methodology has several important limitations that should be acknowledged before interpreting any results.

**Limited domain scope.** The first benchmark uses only one application domain: an order-pricing API. Results may not generalize to other domains such as data processing, real-time systems, or user interfaces. The benchmark explicitly scopes to stateless or minimally stateful HTTP services (SPEC.md §5).

**Single language.** The MVP targets only TypeScript (SPEC.md §35, §37). Results may not generalize to other programming languages with different type systems, tooling ecosystems, or community conventions.

**Small size.** The target application is deliberately small to enable single-session agent generation. Results on small applications may not predict performance on large, multi-file, or multi-service systems. The project acknowledges that scalability is a non-goal for the MVP (SPEC.md §5).

**API model non-reproducibility.** API-backed model behavior cannot be made fully reproducible. The benchmark preserves sufficient metadata to characterize this limitation rather than conceal it (SPEC.md §42). Model providers may change model behavior between runs without notice.

**Harness version sensitivity.** Harness implementations evolve rapidly. Results from different harness versions may not be comparable. The benchmark records harness version for every run (SPEC.md §41).

**Hidden-test confidentiality.** Once hidden tests are published, future agents may be trained on them, invalidating the hidden verification signal for those agents. The benchmark mitigates this by keeping hidden tests outside the public repository, but complete confidentiality cannot be guaranteed.

**Specification evolution.** The specification bundle may change between benchmark versions. Major version changes invalidate cross-version comparisons (SPEC.md §41).

**No formal verification.** The benchmark does not use formal verification tools such as TLA+ or model checking (SPEC.md §5). The verification suite, while heterogeneous, is not exhaustive. A passing implementation may still contain defects that the verification suite does not detect.

**Cost variability.** Model pricing and availability change frequently. Cost measurements from different time periods may not be directly comparable.

**Solo-researcher constraints.** The project is designed for solo applied research (SPEC.md §45). Sample sizes are limited by compute and API costs. Results should be interpreted with appropriate caution.

## 14. Reproducibility

Every run records full metadata to support reproducibility (SPEC.md §42): git commit, dirty working-tree status, benchmark version, evaluator version, container digest, operating system, CPU architecture, model provider, model identifier, harness version, prompt hash, visible-specification hash, hidden-evaluator hash, seed, start and completion timestamps, environment-variable allowlist, and dependency lockfile hash.

Three non-agent baselines are included for comparison (SPEC.md §32): a hand-written reference implementation that passes all verification profiles, a naive generated implementation from a one-shot model response without an iterative harness, and a public-test-only implementation optimized only for visible verification.

## 15. References

This methodology derives from the canonical project specification (SPEC.md). Key referenced sections:

- SPEC.md §3: Core research question and secondary questions
- SPEC.md §4: Primary hypotheses
- SPEC.md §6: Benchmark application description
- SPEC.md §7: Domain invariants
- SPEC.md §8: Verification profiles (A, B, C)
- SPEC.md §9: Public and hidden verification separation
- SPEC.md §10: Metamorphic and property-based tests
- SPEC.md §11: Mutation testing
- SPEC.md §12: Agent task contract
- SPEC.md §13: Harness abstraction
- SPEC.md §14: Model configuration
- SPEC.md §15: Benchmark runner
- SPEC.md §17: Execution isolation
- SPEC.md §19: Verification pipeline
- SPEC.md §21: Trace collection
- SPEC.md §22: Metrics (five dimensions)
- SPEC.md §23: Failure taxonomy (six categories)
- SPEC.md §27: Run artifact structure
- SPEC.md §28: Experiment manifest
- SPEC.md §30: Statistical treatment
- SPEC.md §31: Threat model
- SPEC.md §32: Baselines
- SPEC.md §41: Versioning
- SPEC.md §42: Reproducibility requirements
- SPEC.md §43: Research outputs
- SPEC.md §45: Solo-research feasibility
