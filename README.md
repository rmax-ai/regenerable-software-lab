# Regenerable Software Lab

An experimental benchmark for evaluating whether AI coding agents can repeatedly generate a software system from a durable, implementation-independent verification bundle.

**Status:** Phase 0 — Research protocol and architecture documentation

## What

Most AI coding benchmarks evaluate issue resolution against an existing repository. Regenerable Software Lab does something different: it treats source code as a replaceable candidate implementation and measures whether agents can satisfy progressively stronger verification profiles from the same specification bundle.

The first benchmark is a small HTTP order-pricing API. Multiple coding models and agent harnesses receive the same specification and must produce an implementation that passes:

- **Profile A (Basic):** Public tests, type checking, linting, contract validation
- **Profile B (Behavioral):** Hidden tests, property-based tests, mutation testing
- **Profile C (Operational):** Dependency policy, secret scanning, performance budgets

## Why

AI coding agents can generate plausible implementations quickly, but:
- They overfit visible tests
- They modify or weaken verification assets
- They produce functionally correct but insecure code
- Their output varies significantly across repeated runs
- It's unclear whether the harness or the model matters more

This project isolates the relationship between specification quality, verification strength, model capability, and harness design.

## Repository

```
regenerable-software-lab/
├── SPEC.md                  # Canonical specification (46 sections)
├── AGENTS.md                # AI coding agent conventions
├── docs/
│   ├── ARCHITECTURE.md      # System architecture
│   ├── THREAT_MODEL.md      # Threat model and mitigations
│   ├── ROADMAP.md           # Phased implementation plan
│   └── DECISIONS.md         # Architecture decision records
├── packages/                # Monorepo: runner, evaluator, harness adapters, etc.
├── benchmarks/              # Order-pricing benchmark (visible + hidden assets)
├── environments/            # Docker images for isolated agent runs
└── schemas/                 # JSON Schema for all artifact types
```

## Quickstart

```bash
# Coming in Phase 1 — for now, read the docs:
cat SPEC.md               # Full specification
cat docs/ARCHITECTURE.md  # System design
cat docs/ROADMAP.md       # Implementation plan
```

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

## Documentation Map

| Document | Purpose |
|----------|---------|
| [SPEC.md](SPEC.md) | Canonical specification — ground truth reference |
| [AGENTS.md](AGENTS.md) | Conventions for AI coding agents working on this project |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, components, data flow |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) | Threats from agents and threats to validity |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased implementation plan with acceptance criteria |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture decision records |
