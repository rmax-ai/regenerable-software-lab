# Regenerable Software Lab — Threat Model

> **Document version:** 1.0.0-draft
> **Source:** SPEC.md (this document is derived from the canonical specification)
> **Traceability:** Section references (e.g., SPEC.md §31) link each threat element back to the original specification.
> **Format:** One sentence per line. Direct language. No em dashes.

---

## 1. Scope and Methodology

This threat model covers two categories of threats: threats from the agent (SPEC.md §31.1) and threats to experimental validity (SPEC.md §31.2). Each threat is analyzed using an attack path, asset at risk, security boundary, preventive controls, detective controls, recovery controls, and residual risk assessment. The mitigations from SPEC.md §31.3 are incorporated across all relevant controls.

The benchmark evaluates AI coding agents that generate software from a durable verification bundle. The agent is granted a writable workspace, read-only access to public specification assets, and no access to hidden tests, evaluator source, or the host system (SPEC.md §9, §17). The agent may be adversarial, careless, or strategically motivated to achieve a passing score by any means.

---

## 2. Threats from the Agent

### 2.1 Agent Modifying Tests

**Attack path:** The agent writes to protected test files within the workspace or attempts to modify read-only mounted test assets.

**Asset at risk:** Integrity of the verification suite. If tests are weakened or removed, the verification pipeline cannot detect defects.

**Security boundary:** Protected mounts at `/spec`, `/evaluator`, `/policies`, `/hidden`, and `/benchmark-config` are mounted read-only (SPEC.md §9.3, §17). The workspace initially contains only read-only copies of public verification assets.

**Preventive controls:** Read-only Docker mounts prevent filesystem-level modification of protected paths (SPEC.md §17). Shell commands targeting protected paths are rejected by the runner (SPEC.md §33). The initial workspace copy of public assets is verified for integrity before verification starts.

**Detective controls:** All `protected_file.write_attempt` events are recorded in the trace (SPEC.md §21). Policy violations are logged and cause the run to fail if modification succeeds (SPEC.md §9.3). The workspace integrity stage (Stage 0) checks that protected files are unmodified (SPEC.md §19.1).

**Recovery controls:** If modification is detected, the run is terminated and recorded with failure category `PROTECTED_ASSET_MODIFICATION` (SPEC.md §23). The run artifact preserves the full trace showing the attempt.

**Residual risk:** An agent could modify test behavior indirectly by altering implementation code that tests exercise differently than intended. This is mitigated by hidden tests and mutation testing that verify from outside the agent's influence (SPEC.md §9.2, §11).


### 2.2 Agent Discovering Hidden Tests

**Attack path:** The agent reads hidden test files from the filesystem, inspects environment variables, or infers hidden test content from public test patterns or runner behavior.

**Asset at risk:** Confidentiality of hidden tests. If hidden tests are known, the agent can overfit to them and invalidate the hidden verification measurement.

**Security boundary:** Hidden tests are stored outside the agent workspace at paths that are never mounted into the writable container volume (SPEC.md §9.2). The hidden test directory (`/hidden`) is a protected read-only mount that the agent cannot browse (SPEC.md §9.3).

**Preventive controls:** Hidden tests are never copied into the writable workspace (SPEC.md §9.2). The evaluator executes hidden tests from outside the workspace (SPEC.md §9.2). Environment variables containing hidden test configuration are excluded from the agent's environment. Evaluator credentials and runtime metadata are hidden assets (SPEC.md §9.2).

**Detective controls:** Trace events record all file reads and shell commands (SPEC.md §21). Any attempt to read from hidden paths is logged. The run artifact captures all agent filesystem activity.

**Recovery controls:** If hidden test discovery is detected, the run is invalidated for the hidden verification metric. The failure is classified under agent behavior failures.

**Residual risk:** An agent could infer hidden test expectations from the OpenAPI contract and public test suite with enough accuracy to pass without direct access. This is a recognized threat to validity (SPEC.md §31.2). The risk is partially mitigated by property-based tests and mutation testing that require generalization beyond example-based patterns (SPEC.md §10, §11).


### 2.3 Agent Reading Evaluator Source

**Attack path:** The agent reads evaluator source code from protected mounts to discover scoring logic, hidden test inputs, or mutation operators.

**Asset at risk:** Confidentiality of evaluator logic. Knowledge of scoring rules could enable strategic gaming.

**Security boundary:** The evaluator source lives under `/evaluator` which is a read-only protected mount (SPEC.md §9.3). The evaluator runs in a separate process context.

**Preventive controls:** The evaluator path is never mounted writable. The agent container has no access to evaluator processes or memory. The evaluator binary or source is not present in the agent's PATH.

**Detective controls:** Filesystem access attempts outside the workspace are detected. Any read of evaluator paths is recorded in the trace.

**Recovery controls:** Run is invalidated if evaluator access is confirmed.

**Residual risk:** An agent could reverse-engineer evaluator behavior by observing the side effects of verification stages (which tests pass, what error messages are returned). This is partially addressed by running hidden tests outside the workspace where the agent cannot see per-test results.


### 2.4 Agent Exfiltrating Protected Data

**Attack path:** The agent encodes protected data (hidden tests, evaluator source, benchmark config) into model responses, writes them to visible files, or embeds them in generated code.

**Asset at risk:** Confidentiality of the entire verification bundle.

**Security boundary:** Network egress is disabled (SPEC.md §17, §33). The agent cannot send data to external servers.

**Preventive controls:** External network access is disabled by default (SPEC.md §17). No host Docker socket is available (SPEC.md §17). The container has no network interface beyond localhost. Secret scanning detects embedded secrets or credentials before artifact publication (SPEC.md §33).

**Detective controls:** Trace events capture model responses, file writes, and shell commands (SPEC.md §21). Protected data appearing in log files, trace events, or generated code is detectable through pattern matching. Secret scanning runs before artifact publication (SPEC.md §33).

**Recovery controls:** If exfiltration is detected, the run is classified under policy failures with category `NETWORK_ACCESS_ATTEMPT` or `SECRET_EXPOSURE` (SPEC.md §23). Artifacts containing protected data are excluded from publication datasets.

**Residual risk:** The agent could exfiltrate data in a form that is not detected by secret scanning or trace analysis. Covert channels within model responses are difficult to detect deterministically.


### 2.5 Agent Accessing External Networks

**Attack path:** The agent uses shell commands (curl, wget, npm install without `--offline`) or programming language networking APIs to reach external servers.

**Asset at risk:** Integrity of the isolated evaluation environment. Network access could enable data exfiltration, dependency substitution, or command-and-control communication.

**Security boundary:** Docker container with network disabled (SPEC.md §17). Host networking is disabled. No external network interfaces.

**Preventive controls:** Container network is disabled at the Docker level (SPEC.md §17). Package installation uses `--offline --frozen-lockfile` flags (SPEC.md §25). Dependency policy rejects undeclared packages (SPEC.md §18). The runner enforces command timeouts (SPEC.md §33).

**Detective controls:** Network-access attempts are recorded as policy violations in the trace (SPEC.md §21, §33). Blocked connection attempts may be logged by the container runtime. The `NETWORK_ACCESS_ATTEMPT` failure category captures these events (SPEC.md §23).

**Recovery controls:** Run is terminated if network access is confirmed. Failure is recorded and included in safety metrics.

**Residual risk:** Localhost networking (container-internal) is available. An agent could use localhost to communicate between its own processes, but this does not enable external exfiltration.


### 2.6 Agent Installing Arbitrary Packages

**Attack path:** The agent modifies `package.json` or `pnpm-lock.yaml` to add undeclared dependencies, uses `npm install` without frozen lockfile, or installs packages via direct URL or Git reference.

**Asset at risk:** Supply chain integrity. Arbitrary packages could contain malicious code, introduce vulnerabilities, or alter evaluation behavior.

**Security boundary:** Dependency policy with explicit allowlist (SPEC.md §18). Package installation is restricted to offline mode with frozen lockfile.

**Preventive controls:** The dependency allowlist is explicit: only documented packages are permitted (SPEC.md §18). Package-lock mutations after final verification are rejected. Post-install scripts may be prohibited (SPEC.md §18). Git-based and direct URL dependencies are rejected (SPEC.md §18). Packages with disallowed licenses are blocked (SPEC.md §18).

**Detective controls:** A dependency policy checker validates the final package manifest against the allowlist (SPEC.md §18). Policy violations are recorded in the trace. The `DISALLOWED_DEPENDENCY` failure category captures violations (SPEC.md §23).

**Recovery controls:** If disallowed dependencies are detected, the run fails with a policy violation. The verification pipeline includes dependency checking in Stage 10 (SPEC.md §19.1).

**Residual risk:** An allowed dependency could contain a previously unknown vulnerability that the agent exploits. This is considered acceptable because the benchmark evaluates implementation correctness, not dependency supply-chain security.


### 2.7 Agent Escaping the Container

**Attack path:** The agent exploits a kernel vulnerability, uses Docker socket access, mounts host filesystems, or abuses Linux capabilities to break out of the container.

**Asset at risk:** Host system integrity, all other run artifacts, evaluator infrastructure.

**Security boundary:** Docker container with restricted capabilities (SPEC.md §17, §33). No Docker socket. No privileged mode. Non-root user. Process-count limits.

**Preventive controls:** Containers run as non-root with no privileged mode (SPEC.md §33). Host networking is disabled (SPEC.md §33). Host filesystem mounts are restricted to explicit run directories (SPEC.md §33). Linux capabilities are restricted (SPEC.md §33). No Docker socket is exposed (SPEC.md §17). Process and memory limits prevent fork bombs and resource exhaustion (SPEC.md §17). A temporary filesystem is used for the workspace (SPEC.md §17).

**Detective controls:** Filesystem escape attempts are detected and logged (SPEC.md §33). Abnormal process creation or filesystem access is recorded in the trace.

**Recovery controls:** If container escape is detected, the run is immediately terminated. The host system may need to be re-imaged to ensure no persistent compromise. The `FILESYSTEM_ESCAPE_ATTEMPT` failure category captures these events (SPEC.md §23).

**Residual risk:** Kernel-level container escape vulnerabilities exist and cannot be fully prevented by configuration alone. This risk is accepted for the MVP scope. Full-VM isolation would eliminate this risk but is deferred (SPEC.md §5). For published experiments, the benchmark should run on dedicated or ephemeral infrastructure.


### 2.8 Agent Exhausting Resources

**Attack path:** The agent creates an infinite loop, spawns excessive processes, allocates large memory buffers, or writes large files to exhaust disk, memory, CPU, or process limits.

**Asset at risk:** Availability of the evaluation infrastructure. Resource exhaustion could prevent other runs from completing or compromise the host system.

**Security boundary:** Resource limits are enforced at the container and runner level (SPEC.md §16.1, §17).

**Preventive controls:** Wall-clock timeout (default 30 minutes) (SPEC.md §16.1). Memory limit (default 2 GB). Disk limit (default 1 GB). Process-count limits. CPU limits (SPEC.md §17). Explicit command timeout (SPEC.md §17). Budget enforcement for model calls, tokens, and cost (SPEC.md §16.1).

**Detective controls:** Budget warnings are emitted as trace events (SPEC.md §21). Exhaustion events are recorded with the `budget.exhausted` type. The `RESOURCE_LIMIT_EXCEEDED` failure category captures these events (SPEC.md §23).

**Recovery controls:** When a resource limit is hit, the run is terminated with the appropriate status (`timeout` or `budget_exhausted`). The workspace is deleted or archived after completion (SPEC.md §17).

**Residual risk:** An agent could stay within limits while still being unproductive (e.g., making many small model calls up to the token budget). This is captured by the `REPEATED_UNPRODUCTIVE_LOOP` failure category (SPEC.md §23).


### 2.9 Agent Falsifying Evidence

**Attack path:** The agent produces a `evidence-report.json` that claims tests passed when they did not, omits failed checks, or fabricates command execution evidence.

**Asset at risk:** Integrity of the self-reported evidence metric. If false claims are undetected, the evidence quality measurement is invalid.

**Security boundary:** The evaluator independently runs verification and compares agent claims against observed execution (SPEC.md §20).

**Preventive controls:** The evidence report is produced by the agent but validated against the trace and verification results. The evidence report schema requires specific fields (SPEC.md §20).

**Detective controls:** The evaluator compares claimed checks against observed execution with metrics including claimed-check accuracy, omitted failed checks, false pass claims, missing command evidence, unsupported certainty, and agreement between report and trace (SPEC.md §20). The `FALSE_SUCCESS_CLAIM` failure category captures these events (SPEC.md §23).

**Recovery controls:** Evidence falsification is recorded in evidence quality metrics and the failure taxonomy. It does not affect correctness metrics but is reported separately.

**Residual risk:** An agent could truthfully report passing tests while having overfit to visible tests. This is not evidence falsification; it is a separate validity threat addressed by hidden tests (SPEC.md §31.2).


### 2.10 Agent Claiming False Success

**Attack path:** The agent reports that the implementation is complete and all verification checks pass, but the evaluator's independent verification reveals failures.

**Asset at risk:** Correctness measurement. If false success claims are accepted, the benchmark produces invalid results.

**Security boundary:** The evaluator runs verification independently of the agent's claims (SPEC.md §19). The agent's assertion does not influence the final verification result.

**Preventive controls:** The evaluator executes all verification stages autonomously (SPEC.md §19). The agent's evidence report is treated as a data point for the evidence quality metric, not as the authoritative result (SPEC.md §20).

**Detective controls:** The evaluator directly compares its verification results against the agent's claimed checks. Discrepancies are recorded in evidence quality metrics (SPEC.md §20, §22.5). The `FALSE_SUCCESS_CLAIM` failure category captures these events (SPEC.md §23).

**Recovery controls:** False success does not affect the correctness score. It is reported in the evidence quality dimension and the failure taxonomy.

**Residual risk:** None for the correctness measurement itself. The risk is that a third party relying only on the agent's self-report would be misled, which is why the benchmark always reports evaluator results.


### 2.11 Agent Exploiting Evaluator Bugs

**Attack path:** The agent crafts input that causes the evaluator to crash, produce incorrect results, skip verification stages, or return false positives.

**Asset at risk:** Integrity of the evaluation pipeline.

**Security boundary:** The evaluator runs as a separate process with its own error handling.

**Preventive controls:** Evaluator self-tests validate evaluator behavior (SPEC.md §31.3). A baseline human reference implementation validates that the evaluator works correctly for known-good code (SPEC.md §32.1). The evaluator is versioned and its behavior is deterministic for given inputs (SPEC.md §41). The fake harness enables testing of evaluator edge cases (SPEC.md §40).

**Detective controls:** Evaluator errors are recorded with the `EVALUATOR_ERROR` failure category (SPEC.md §23). Verification results include error status for stages that cannot complete (SPEC.md §19.3). The trace captures all evaluator events.

**Recovery controls:** If evaluator exploitation is detected, the run is invalidated. The evaluator bug must be fixed and previous results re-evaluated.

**Residual risk:** Unknown evaluator bugs may exist. Rigorous testing of the evaluator (including with deliberately defective implementations, SPEC.md §38) reduces but does not eliminate this risk. Evaluator self-tests and the reference implementation baseline (SPEC.md §31.3, §32.1) are the primary mitigations.


---

## 3. Threats to Validity

### 3.1 Public Tests Leaking Hidden Behavior (Test Leakage)

**Attack path:** Public tests reveal patterns, edge cases, or implementation details that inform the agent about hidden test expectations.

**Asset at risk:** Independence of hidden verification.

**Security boundary:** Public and hidden tests are designed as separate suites (SPEC.md §9). Hidden tests exercise behaviors and edge cases not covered by public tests.

**Preventive controls:** Hidden tests are designed to test generalization, not memorization. Property-based tests (SPEC.md §10) and mutation testing (SPEC.md §11) are harder to overfit from public test patterns. Adversarial payload sets are hidden (SPEC.md §9.2).

**Detective controls:** The public-hidden performance gap is a core metric (SPEC.md §22.4). A small gap may indicate test leakage.

**Recovery controls:** If leakage is suspected, the hidden test suite is revised to be more orthogonal to the public suite.

**Residual risk:** Complete orthogonality between public and hidden tests is difficult to achieve for a single well-defined API. Some overlap is inevitable and accepted.


### 3.2 Test-Suite Implementation Bias

**Attack path:** The test suite uses specific patterns, libraries, or idioms that favor certain implementation styles or frameworks.

**Asset at risk:** Fairness across different implementation approaches.

**Security boundary:** The benchmark is framework-agnostic within the chosen language (SPEC.md §35 recommends Fastify but does not require it).

**Preventive controls:** The test suite exercises the HTTP API contract, not internal implementation details (SPEC.md §6.3, §9.1). Property-based tests use the public API only. Mutation testing operates on the implementation source, not the test suite.

**Detective controls:** The public-test-only baseline (SPEC.md §32.3) reveals whether test-specific patterns enable overfitting.

**Recovery controls:** If bias is detected, tests are revised to be more implementation-neutral.

**Residual risk:** Complete framework neutrality is impossible. The specification documents recommended but not required stack choices (SPEC.md §35).


### 3.3 Framework-Specific Benchmark Advantages

**Attack path:** The benchmark's recommended stack (Fastify, Zod, Decimal.js, Vitest) gives an advantage to agents or harnesses more familiar with these libraries.

**Asset at risk:** Fairness across coding agents with different training data distributions.

**Security boundary:** The benchmark does not require the recommended stack. The OpenAPI contract is the source of truth (SPEC.md §6.3).

**Preventive controls:** The task instruction does not mandate specific frameworks (SPEC.md §12). The verification pipeline tests API behavior, not framework usage.

**Detective controls:** Comparing naive generated baselines (SPEC.md §32.2) across different stacks can reveal framework effects.

**Residual risk:** Agents trained primarily on TypeScript/Fastify patterns will naturally perform better on this benchmark than agents trained on other ecosystems. This is a documented limitation (SPEC.md §37, MVP Scope: TypeScript only).


### 3.4 Provider Variability

**Attack path:** Different model providers offer different API capabilities (seed control, reasoning effort, output token limits), introducing uncontrolled variance.

**Asset at risk:** Fair model-to-model comparison.

**Security boundary:** The benchmark normalizes run budgets per model (SPEC.md §12, §16.1).

**Preventive controls:** All model parameters available to the harness must be recorded (SPEC.md §14). When the provider does not support a seed, the benchmark seed still controls non-model randomness: test data generation, workspace initialization, mutation sampling, run ordering, and hidden-case selection (SPEC.md §14). Run budgets are normalized across models (SPEC.md §31.3).

**Detective controls:** Provider variability is captured in reproducibility metadata (SPEC.md §42). Cost and token usage are recorded per run (SPEC.md §22.2). The provider is a recorded dimension in experiment manifests (SPEC.md §28).

**Recovery controls:** Results are analyzed per-provider and never collapsed across providers without explicit labeling.

**Residual risk:** API-backed model behavior cannot be made fully reproducible (SPEC.md §42). The benchmark preserves sufficient metadata to characterize rather than conceal this limitation.


### 3.5 Non-Deterministic Package Installation

**Attack path:** Package managers resolve dependency versions differently across runs or environments, introducing uncontrolled implementation variance.

**Asset at risk:** Reproducibility of build and test results.

**Security boundary:** Pinned dependency lockfile and offline installation mode (SPEC.md §25).

**Preventive controls:** `pnpm install --offline --frozen-lockfile` ensures deterministic dependency resolution (SPEC.md §25). Pinned dependencies (SPEC.md §31.3). Versioned container images include pre-installed dependencies (SPEC.md §17).

**Detective controls:** Dependency lockfile hash is recorded (SPEC.md §42). Container digest is recorded (SPEC.md §42).

**Recovery controls:** If a dependency issue is suspected, the run can be re-executed with the same lockfile and container image.

**Residual risk:** Transitive dependency resolution could differ if the lockfile is corrupted or if the offline package cache is incomplete. This is mitigated by using a frozen lockfile.


### 3.6 Hidden Test Flakiness

**Attack path:** Hidden tests produce non-deterministic results due to timing sensitivity, random input generation, or environmental factors.

**Asset at risk:** Reliability of hidden verification as a measurement.

**Security boundary:** The benchmark uses seeded randomness for test data generation (SPEC.md §14).

**Preventive controls:** The benchmark seed controls test data generation, mutation sampling, and hidden-case selection (SPEC.md §14). Property tests use seeded random generators. Property-based tests should be designed to be deterministic given the same random seed.

**Detective controls:** The `NONDETERMINISTIC_TEST` failure category captures suspected flaky tests (SPEC.md §23). Repeated runs with the same seed should produce the same hidden test results.

**Recovery controls:** Flaky tests are identified through repeated-seed analysis and either fixed or excluded from scoring.

**Residual risk:** Some non-determinism may remain in property-based tests that generate random inputs, even with seeding. The seed controls the generator but execution order effects (e.g., concurrency) may still produce variance.


### 3.7 Harness-Specific Prompt Injection

**Attack path:** The task prompt or specification assets contain instructions that one harness interprets differently than another, or that the agent uses to manipulate the harness.

**Asset at risk:** Fair harness-to-harness comparison.

**Security boundary:** The task prompt is fixed per benchmark version (SPEC.md §12, §41). The prompt hash is recorded (SPEC.md §42).

**Preventive controls:** The canonical task instruction is preserved exactly for every run (SPEC.md §12). Specification assets are versioned. The bench-mark distinguishes model from harness; a harness identifier must not implicitly encode the model (SPEC.md §13.4).

**Detective controls:** Prompt hash is recorded for reproducibility (SPEC.md §42). Harness behavior is compared across runs with the same model and prompt.

**Recovery controls:** If prompt injection is suspected, the prompt is revised and previous runs are re-evaluated.

**Residual risk:** Different harnesses may interpret identical prompts differently due to system prompts, tool-use conventions, or context window management. This is a measured variable, not a bug.


### 3.8 Unequal Model Budgets

**Attack path:** One model has access to more tokens, model calls, wall-clock time, or cost budget than another, biasing the comparison.

**Asset at risk:** Fairness of cross-model comparisons.

**Security boundary:** Run limits are defined per configuration and must be recorded (SPEC.md §16.1).

**Preventive controls:** Run budgets are normalized across models (SPEC.md §31.3). Default MVP limits are defined (SPEC.md §16.1). Experiment manifests define limits per-run (SPEC.md §28).

**Detective controls:** Budget usage is recorded in efficiency metrics (SPEC.md §22.2). Budget exhaustion events are captured in the trace (SPEC.md §21).

**Recovery controls:** Runs that exhaust budgets are classified separately. Comparisons should account for budget differences.

**Residual risk:** Some models may inherently require more tokens or calls to produce correct implementations. Budget normalization cannot fully eliminate this difference without limiting the more efficient model. The benchmark records and reports budget usage rather than enforcing strict equality.


### 3.9 Version Changes Between Runs

**Attack path:** Changes to the benchmark specification, evaluator, container image, or harness between runs make results incomparable.

**Asset at risk:** Longitudinal comparability of results.

**Security boundary:** The versioning scheme defines compatibility boundaries (SPEC.md §41).

**Preventive controls:** The project versions benchmark application, verification profile, evaluator, container image, harness adapter, model configuration, task prompt, and artifact schema (SPEC.md §41). Every run records Git commit, benchmark version, evaluator version, container digest, and harness version (SPEC.md §42). Changes requiring major version bumps are defined (SPEC.md §41).

**Detective controls:** Version information is captured in reproducibility metadata (SPEC.md §42). Comparison across incompatible versions is prevented or flagged.

**Recovery controls:** If incompatible versions are compared, the results are flagged as incomparable.

**Residual risk:** Minor version changes (added hidden cases, added metrics) may still change the difficulty or scoring characteristics, even if defined as non-breaking (SPEC.md §41).


### 3.10 Benchmark Contamination

**Attack path:** An AI coding agent was trained on code or tests from this benchmark, giving it an unfair advantage through memorization rather than generalization.

**Asset at risk:** Validity of all benchmark results. Contamination undermines the fundamental measurement.

**Security boundary:** No technical boundary can prevent contamination because training data is controlled by model providers, not by the benchmark.

**Preventive controls:** The benchmark specification is versioned and published after evaluation (SPEC.md §43). The benchmark revision history is published (SPEC.md §31.3). Hidden tests are kept out of public repositories during active evaluation (SPEC.md §9.2). The methodology is published independently of results (SPEC.md §31.3).

**Detective controls:** The public-test-only baseline (SPEC.md §32.3) can reveal memorization: if a model passes hidden tests but fails generalization-style property tests, contamination is suspected. Seed variance analysis may reveal memorization patterns. The naive generated baseline (SPEC.md §32.2) provides a lower bound on memorization.

**Recovery controls:** If contamination is confirmed, affected results are invalidated. Future benchmark versions change hidden tests and mutation operators.

**Residual risk:** Contamination cannot be fully prevented or detected. It is a fundamental limitation of public benchmarks. The benchmark documents this limitation (SPEC.md §31.2, §44). The design emphasizes metrics that are hard to memorize (mutation score, property-test coverage, hidden test generalization) over metrics that are easy to memorize (example-based test pass rate).


### 3.11 Mutation Operators Producing Unrealistic Defects

**Attack path:** Mutation operators introduce defects that are not representative of real coding errors, producing artificially high or low mutation scores.

**Asset at risk:** Validity of mutation score as a robustness metric.

**Security boundary:** Mutation operators are designed by the benchmark authors and are versioned (SPEC.md §11, §41).

**Preventive controls:** Mutation operators are based on observed real-world coding errors from the domain (SPEC.md §11). Equivalent and non-executable mutations must be classified separately (SPEC.md §11). The `INVALID_MUTATION` failure category captures unusable mutations (SPEC.md §23).

**Detective controls:** Mutation operators are reviewed for domain relevance. The public-test-only baseline reveals whether mutation score correlates with other robustness metrics.

**Recovery controls:** Mutation operators can be revised in minor version updates.

**Residual risk:** No mutation operator set can perfectly represent all realistic coding errors. The mutation score is one of several robustness metrics and should be interpreted alongside property-test performance and hidden-test pass rate (SPEC.md §22.4).


---

## 4. Mitigations Summary (SPEC.md §31.3)

The following mitigations are defined in SPEC.md §31.3 and are incorporated throughout the above threat analysis:

| Mitigation | Primary Threat Addressed | Implementation Reference |
|---|---|---|
| Read-only protected mounts | Agent modifying tests, agent reading evaluator source | SPEC.md §9.3, §17 |
| No external network | Data exfiltration, arbitrary package installation | SPEC.md §17, §33 |
| Pinned dependencies | Non-deterministic package installation, arbitrary packages | SPEC.md §18, §25 |
| Versioned container images | Version drift, non-deterministic environments | SPEC.md §17, §41 |
| Normalized run budgets | Unequal model budgets | SPEC.md §16.1, §22.2 |
| Independent final evaluator | Evidence falsification, false success claims, evaluator exploitation | SPEC.md §19, §20 |
| Hidden tests outside the workspace | Agent discovering hidden tests, test leakage | SPEC.md §9.2 |
| Repeated seeds | Non-determinism, provider variability, seed variance | SPEC.md §14, §30 |
| Full version recording | Version drift, reproducibility | SPEC.md §41, §42 |
| Published methodology | Benchmark contamination, implementation bias | SPEC.md §31.3, §43 |
| Benchmark revision history | Version drift, benchmark contamination | SPEC.md §31.3, §41 |
| Evaluator self-tests | Evaluator exploitation | SPEC.md §31.3, §39 |
| Baseline human implementation | Evaluator exploitation, hidden test flakiness | SPEC.md §31.3, §32.1 |


---

## 5. Residual Risk Summary

| Threat | Residual Risk Level | Key Unmitigated Factor |
|---|---|---|
| Agent modifying tests | Low | Read-only mounts prevent most attacks |
| Agent discovering hidden tests | Medium | Inference from public patterns is possible |
| Agent reading evaluator source | Low | Filesystem isolation is effective |
| Agent exfiltrating data | Low | Network egress is disabled |
| Agent accessing external networks | Low | Network disabled at container level |
| Agent installing arbitrary packages | Low | Frozen lockfile and allowlist are effective |
| Agent escaping container | Medium | Kernel exploits exist; full VM would be stronger |
| Agent exhausting resources | Low | Hard limits enforce termination |
| Agent falsifying evidence | Low | Independent evaluator validates claims |
| Agent claiming false success | Low | Evaluator runs independently |
| Agent exploiting evaluator bugs | Medium | Unknown bugs may exist |
| Test leakage | Medium | Complete orthogonality is difficult |
| Implementation bias | Medium | Framework neutrality is imperfect |
| Provider variability | High | API behavior cannot be fully reproducible |
| Non-deterministic installs | Low | Frozen lockfile + versioned images |
| Hidden test flakiness | Low-Medium | Seeded randomness helps; execution order may vary |
| Prompt injection | Low | Fixed prompt per version |
| Unequal budgets | Medium | Normalization reduces but does not eliminate effects |
| Version drift | Low | Comprehensive versioning and recording |
| Benchmark contamination | High | Cannot prevent training data inclusion |
| Unrealistic mutation operators | Low | Operator set is domain-informed |

Residual risk is rated based on the effectiveness of the combined preventive, detective, and recovery controls for each threat. High-residual-risk items (provider variability, benchmark contamination) are fundamental limitations of the experimental design and cannot be fully eliminated by infrastructure controls. These are documented, measured where possible, and disclosed in published results (SPEC.md §43).


---

## Appendix A: SPEC.md Section References

| Section | Title | Relevance |
|---|---|---|
| SPEC.md §9 | Public and Hidden Verification | Trust boundary definition |
| SPEC.md §12 | Agent Task Contract | Prompt fixedness |
| SPEC.md §14 | Model Configuration | Seed control, provider variability |
| SPEC.md §15 | Benchmark Runner | Run lifecycle |
| SPEC.md §16 | Run Configuration | Run limits, budget normalization |
| SPEC.md §17 | Execution Isolation | Container security |
| SPEC.md §18 | Dependency Policy | Supply chain controls |
| SPEC.md §19 | Verification Pipeline | Independent evaluation |
| SPEC.md §20 | Evidence Report | Evidence falsification detection |
| SPEC.md §21 | Trace Collection | Detective controls |
| SPEC.md §22 | Metrics | Measurement of threat impact |
| SPEC.md §23 | Failure Taxonomy | Classification of security events |
| SPEC.md §30 | Statistical Treatment | Seed variance, repeated runs |
| SPEC.md §31 | Threat Model | Canonical threat source |
| SPEC.md §32 | Baselines | Reference implementation, detection of contamination |
| SPEC.md §33 | Security Requirements | Container hardening |
| SPEC.md §34 | Privacy and Data Handling | Data exfiltration prevention |
| SPEC.md §39 | Quality Requirements | Evaluator testing |
| SPEC.md §40 | Fake Harness | Security scenario testing |
| SPEC.md §41 | Versioning | Version drift prevention |
| SPEC.md §42 | Reproducibility Requirements | Metadata recording |
| SPEC.md §43 | Research Outputs | Publication methodology |
| SPEC.md §44 | Longer-Term Extensions | Contamination study |
