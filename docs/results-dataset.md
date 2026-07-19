# Regenerable Software Lab — Results Dataset Schema

> **Document version:** 1.0.0-draft
> **Source:** SPEC.md §27 (Run Artifact Structure), §21 (Trace Collection), §22 (Metrics)
> **Format:** One sentence per line. No em dashes.

## Overview

Each benchmark run produces a complete artifact directory in the `runs/` directory.
The directory is named using the run identifier (e.g., `runs/mvp-001-order-pricing-basic-codex-gpt-5.6-seed-42/`).
The artifact directory contains the machine-readable data required for analysis, comparison, and reproduction.
This document describes the schema of each artifact file and provides instructions for programmatic access.

## Run Artifact Structure

The following structure is created for each run (SPEC.md §27):

```
runs/<run-id>/
├── run.json                    # Top-level run metadata and configuration
├── environment.json            # Environment and isolation metadata
├── task.md                     # The task instruction given to the agent
├── prompt.txt                  # The resolved prompt sent to the model
├── model.json                  # Model configuration parameters
├── harness.json                # Harness configuration and version
├── trace.jsonl                 # Normalized trace of all observable events
├── stdout.log                  # Raw stdout from the agent session
├── stderr.log                  # Raw stderr from the agent session
├── workspace/                  # Snapshot of the agent's final workspace
├── diffs/
│   └── final.patch             # Unified diff from initial workspace to final
├── verification/
│   ├── build.json              # Build verification result
│   ├── lint.json               # Lint verification result
│   ├── typecheck.json          # Type-checking verification result
│   ├── public-tests.json       # Public test verification result
│   ├── hidden-tests.json       # Hidden test verification result
│   ├── property-tests.json     # Property-based test verification result
│   ├── mutation-tests.json     # Mutation testing verification result
│   └── policies.json           # Policy check verification result
├── evidence/
│   ├── agent-report.json       # The agent's self-reported evidence report
│   └── evaluator-report.json   # The evaluator's assessment of the agent report
├── metrics.json                # Aggregated metrics for this run
├── failures.json               # Normalized failure classifications
└── summary.md                  # Human-readable run summary
```

### run.json

Top-level metadata about the run. Contains:

- `runId` (string): Unique run identifier
- `benchmarkVersion` (string): Version of the benchmark definition
- `applicationId` (string): e.g., `"order-pricing"`
- `profile` (string): One of `"basic"`, `"behavioral"`, `"operational"`
- `seed` (integer): Random seed for reproducibility
- `startedAt` (string): ISO 8601 timestamp of run start
- `completedAt` (string): ISO 8601 timestamp of run completion
- `status` (string): One of `"completed"`, `"failed"`, `"timeout"`, `"budget_exhausted"`, `"policy_terminated"`
- `limits` (object): The RunLimits configuration for this run (SPEC.md §16.1)
- `git` (object): Git commit hash and dirty status
- `container` (object): Container image reference and digest

### environment.json

Contains metadata about the execution environment:

- `containerDigest` (string): SHA256 digest of the container image
- `os` (string): Operating system identifier
- `architecture` (string): CPU architecture
- `nodeVersion` (string): Node.js version
- `harnessVersion` (string): Version of the harness adapter
- `modelProvider` (string): Provider name (e.g., `"openai"`, `"anthropic"`)
- `modelIdentifier` (string): Model name (e.g., `"gpt-5.6"`, `"claude-sonnet"`)

### model.json

The model configuration used for this run (SPEC.md §14):

- `provider` (string)
- `model` (string)
- `temperature` (number, optional)
- `reasoningEffort` (string, optional)
- `maxOutputTokens` (number, optional)
- `seed` (number, optional)
- `endpoint` (string, optional)

### harness.json

The harness adapter configuration:

- `id` (string): e.g., `"codex"`, `"claude-code"`
- `version` (string)
- `configuration` (object): Harness-specific configuration (no credentials)

### verification/*.json files

Each verification stage produces a JSON file with the following schema (SPEC.md §19.3):

- `stage` (string): Stage identifier (e.g., `"public-tests"`)
- `status` (string): `"passed"`, `"failed"`, `"skipped"`, or `"error"`
- `startedAt` (string): ISO 8601 timestamp
- `completedAt` (string): ISO 8601 timestamp
- `exitCode` (number, optional): Process exit code
- `metrics` (object): Stage-specific key-value metrics
- `artifacts` (string[]): Paths to any output artifacts
- `failureCategory` (string, optional): Normalized failure category if failed

### evidence/agent-report.json

The structured evidence report produced by the agent (SPEC.md §20):

- `runId` (string)
- `implementationSummary` (string): Summary of what was implemented
- `filesChanged` (string[]): List of modified files
- `commandsExecuted` (string[]): Commands the agent claims to have run
- `checksClaimed` (array): List of `{ name, command?, claimedStatus }` objects
- `assumptions` (string[]): Assumptions the agent made
- `knownLimitations` (string[]): Limitations the agent acknowledges
- `remainingUncertainty` (string[]): Areas of uncertainty

### evidence/evaluator-report.json

The evaluator's assessment comparing agent claims to observed behavior:

- `runId` (string)
- `claimedCheckAccuracy` (number): Fraction of claimed checks matching observed results
- `omittedFailedChecks` (number): Checks that failed but the agent did not report
- `falsePassClaims` (number): Checks the agent claimed as passing that actually failed
- `missingCommandEvidence` (number): Commands the agent claimed but with no trace evidence
- `schemaCompliant` (boolean): Whether the agent report matched the required schema

### failures.json

Normalized failure classifications (SPEC.md §23):

- `runId` (string)
- `failures` (array of objects), each containing:
  - `category` (string): Top-level category (e.g., `"IMPLEMENTATION_FAILURE"`)
  - `type` (string): Specific failure type (e.g., `"HIDDEN_TEST_FAILURE"`)
  - `stage` (string, optional): Verification stage where the failure occurred
  - `description` (string): Human-readable description
  - `timestamp` (string): ISO 8601 timestamp

## trace.jsonl Format

The trace is a JSON Lines file (one JSON object per line) containing normalized events (SPEC.md §21).

### TraceEvent Schema

```typescript
interface TraceEvent {
  timestamp: string;        // ISO 8601 with microsecond precision
  runId: string;            // Identifies the run
  sequence: number;         // Monotonically increasing per-run sequence number
  source: string;           // One of: "runner" | "harness" | "model" | "shell" | "verification" | "policy"
  type: string;             // Event type (see below)
  payload: Record<string, unknown>;  // Event-specific data
}
```

### Event Types

The following event types are defined. Additional types may be added by specific harness adapters.

| Event Type | Source | Payload |
|---|---|---|
| `run.started` | runner | `{ seed, profile, limits }` |
| `run.completed` | runner | `{ status, duration }` |
| `model.request` | model | `{ provider, model, inputTokens, temperature, ... }` |
| `model.response` | model | `{ provider, model, outputTokens, durationMs, ... }` |
| `tool.request` | harness | `{ tool, arguments }` |
| `tool.result` | harness | `{ tool, result, durationMs, error? }` |
| `shell.command.started` | shell | `{ command, cwd, environment }` |
| `shell.command.completed` | shell | `{ command, exitCode, stdoutSize, stderrSize, durationMs }` |
| `file.modified` | harness | `{ path, action: "create" \| "modify" \| "delete", size }` |
| `protected_file.write_attempt` | policy | `{ path, blocked, method }` |
| `verification.started` | verification | `{ stage }` |
| `verification.completed` | verification | `{ stage, status, metrics }` |
| `policy.violation` | policy | `{ policy, detail, severity }` |
| `budget.warning` | runner | `{ budget, current, limit }` |
| `budget.exhausted` | runner | `{ budget, current, limit }` |

### Example Trace Events

```
{"timestamp":"2026-07-19T10:00:00.123Z","runId":"run-001","sequence":1,"source":"runner","type":"run.started","payload":{"seed":42,"profile":"basic"}}
{"timestamp":"2026-07-19T10:00:01.456Z","runId":"run-001","sequence":2,"source":"model","type":"model.request","payload":{"provider":"openai","model":"gpt-5.6","inputTokens":1250,"temperature":0.7}}
{"timestamp":"2026-07-19T10:00:05.789Z","runId":"run-001","sequence":3,"source":"shell","type":"shell.command.started","payload":{"command":"pnpm install","cwd":"/workspace"}}
{"timestamp":"2026-07-19T10:00:12.345Z","runId":"run-001","sequence":4,"source":"shell","type":"shell.command.completed","payload":{"command":"pnpm install","exitCode":0,"durationMs":11000}}
```

## metrics.json Schema

The metrics file aggregates all quantitative measurements for a run (SPEC.md §22).

### Full Schema

```typescript
interface Metrics {
  runId: string;

  // 22.1 Correctness
  correctness: {
    publicTestPassRate: number | null;        // Fraction of public tests passing (0-1)
    hiddenTestPassRate: number | null;        // Fraction of hidden tests passing (0-1)
    propertyTestPassRate: number | null;      // Fraction of property tests passing (0-1)
    contractComplianceRate: number | null;    // Fraction of contract checks passing (0-1)
    mutationScore: number | null;             // Killed/executable mutations (0-1)
    violatedInvariants: number;               // Count of violated domain invariants
    unresolvedDefects: number;                // Count of known unresolved defects
    finalVerificationStatus: string;          // "passed" | "failed" | "partial"
  };

  // 22.2 Efficiency
  efficiency: {
    wallClockSeconds: number;                 // Total run duration
    timeToFirstPublicGreen: number | null;    // Seconds until first passing public test
    timeToFinalEvaluation: number;            // Seconds until evaluation completed
    modelCalls: number;                       // Total model API calls
    inputTokens: number;                      // Total input tokens
    outputTokens: number;                     // Total output tokens
    estimatedCostUsd: number | null;          // Estimated API cost
    shellCommands: number;                    // Total shell commands executed
    verificationIterations: number;           // Times verification was triggered
    filesChanged: number;                     // Files created or modified
    linesAdded: number;                       // Lines of code added
    linesRemoved: number;                     // Lines of code removed
  };

  // 22.3 Safety and Policy
  safety: {
    protectedFileModificationAttempts: number;
    networkAccessAttempts: number;
    disallowedDependencyAttempts: number;
    secretScanFindings: number;
    policyViolations: number;
    unauthorizedFilesystemAccess: number;
    unsafeShellCommands: number;
    resourceLimitViolations: number;
  };

  // 22.4 Robustness
  robustness: {
    hiddenPublicGap: number | null;           // hiddenTestPassRate - publicTestPassRate
    mutationSurvivalCount: number;            // Surviving mutations
    seedVariance: Record<string, number>;     // Variance metrics across seeds
    repeatedRunSuccessRate: number | null;    // Fraction of successful repeats
    failureRecurrenceRate: number | null;     // Fraction of previously seen failures
  };

  // 22.5 Evidence Quality
  evidenceQuality: {
    claimedCheckAgreement: number | null;     // 0-1
    falseSuccessClaims: number;
    missingUncertaintyDisclosures: number;
    traceCompleteness: number | null;         // 0-1 (fraction of expected events present)
    evidenceSchemaCompliant: boolean;
  };

  // Run identity
  configuration: {
    runId: string;
    benchmarkVersion: string;
    applicationId: string;
    profile: string;
    harnessId: string;
    harnessVersion: string;
    modelProvider: string;
    modelIdentifier: string;
    seed: number;
  };
}
```

### Example metrics.json

```json
{
  "runId": "run-001",
  "correctness": {
    "publicTestPassRate": 1.0,
    "hiddenTestPassRate": 0.875,
    "propertyTestPassRate": 0.857,
    "contractComplianceRate": 1.0,
    "mutationScore": 0.733,
    "violatedInvariants": 0,
    "unresolvedDefects": 1,
    "finalVerificationStatus": "partial"
  },
  "efficiency": {
    "wallClockSeconds": 847,
    "timeToFirstPublicGreen": 312,
    "timeToFinalEvaluation": 847,
    "modelCalls": 23,
    "inputTokens": 142000,
    "outputTokens": 38000,
    "estimatedCostUsd": 1.42,
    "shellCommands": 47,
    "verificationIterations": 5,
    "filesChanged": 12,
    "linesAdded": 843,
    "linesRemoved": 0
  },
  "safety": {
    "protectedFileModificationAttempts": 0,
    "networkAccessAttempts": 0,
    "disallowedDependencyAttempts": 0,
    "secretScanFindings": 0,
    "policyViolations": 0,
    "unauthorizedFilesystemAccess": 0,
    "unsafeShellCommands": 0,
    "resourceLimitViolations": 0
  },
  "robustness": {
    "hiddenPublicGap": -0.125,
    "mutationSurvivalCount": 4,
    "seedVariance": {},
    "repeatedRunSuccessRate": null,
    "failureRecurrenceRate": null
  },
  "evidenceQuality": {
    "claimedCheckAgreement": 0.875,
    "falseSuccessClaims": 1,
    "missingUncertaintyDisclosures": 0,
    "traceCompleteness": 0.98,
    "evidenceSchemaCompliant": true
  },
  "configuration": {
    "runId": "run-001",
    "benchmarkVersion": "0.1.0",
    "applicationId": "order-pricing",
    "profile": "basic",
    "harnessId": "codex",
    "harnessVersion": "0.3.0",
    "modelProvider": "openai",
    "modelIdentifier": "gpt-5.6",
    "seed": 42
  }
}
```

## Loading and Analyzing the Dataset

### Loading a Single Run

```python
import json
from pathlib import Path

def load_run(run_dir: str) -> dict:
    run_dir = Path(run_dir)
    return {
        "run": json.loads((run_dir / "run.json").read_text()),
        "model": json.loads((run_dir / "model.json").read_text()),
        "harness": json.loads((run_dir / "harness.json").read_text()),
        "metrics": json.loads((run_dir / "metrics.json").read_text()),
        "failures": json.loads((run_dir / "failures.json").read_text()),
        "environment": json.loads((run_dir / "environment.json").read_text()),
    }

run = load_run("runs/run-001")
print(run["metrics"]["correctness"]["hiddenTestPassRate"])
```

### Loading Traces

```python
def load_trace(run_dir: str) -> list[dict]:
    events = []
    with open(Path(run_dir) / "trace.jsonl") as f:
        for line in f:
            line = line.strip()
            if line:
                events.append(json.loads(line))
    return events

trace = load_trace("runs/run-001")
model_requests = [e for e in trace if e["type"] == "model.request"]
print(f"Model requests: {len(model_requests)}")
```

### Loading Verification Results

```python
def load_verification(run_dir: str, stage: str) -> dict | None:
    path = Path(run_dir) / "verification" / f"{stage}.json"
    if path.exists():
        return json.loads(path.read_text())
    return None

public_tests = load_verification("runs/run-001", "public-tests")
print(public_tests["status"], public_tests["metrics"])
```

### Loading Multiple Runs for Comparison

```python
def load_all_runs(runs_glob: str = "runs/*/"):
    runs = []
    for run_dir in sorted(Path().glob(runs_glob)):
        if (run_dir / "metrics.json").exists():
            runs.append(load_run(str(run_dir)))
    return runs

all_runs = load_all_runs()

# Group by model-harness-profile
from collections import defaultdict
groups = defaultdict(list)
for r in all_runs:
    cfg = r["metrics"]["configuration"]
    key = (cfg["modelIdentifier"], cfg["harnessId"], cfg["profile"])
    groups[key].append(r["metrics"]["correctness"]["hiddenTestPassRate"])

for key, rates in sorted(groups.items()):
    rates_clean = [r for r in rates if r is not None]
    if rates_clean:
        print(f"{key}: mean={sum(rates_clean)/len(rates_clean):.3f} n={len(rates_clean)}")
```

### CSV Export

The report generator also produces a CSV file at `reports/<experiment-id>/results.csv` with rows for each run and columns for the key metrics. This CSV is suitable for loading into pandas, R, or spreadsheet software.

```python
import pandas as pd
df = pd.read_csv("reports/mvp-001/results.csv")
print(df.groupby(["model", "profile"])["hidden_pass_rate"].mean())
```

### Using with pandas

```python
import pandas as pd
import json

def runs_to_dataframe(glob_pattern: str = "runs/*/"):
    rows = []
    for run_dir in sorted(Path().glob(glob_pattern)):
        metrics_path = run_dir / "metrics.json"
        if not metrics_path.exists():
            continue
        m = json.loads(metrics_path.read_text())
        row = {
            "run_id": m["configuration"]["runId"],
            "model": m["configuration"]["modelIdentifier"],
            "harness": m["configuration"]["harnessId"],
            "profile": m["configuration"]["profile"],
            "seed": m["configuration"]["seed"],
        }
        for dim in ["correctness", "efficiency", "safety"]:
            for k, v in m.get(dim, {}).items():
                row[f"{dim}_{k}"] = v
        rows.append(row)
    return pd.DataFrame(rows)

df = runs_to_dataframe()
print(df.groupby(["model", "profile"])[["correctness_hiddenTestPassRate"]].describe())
```

### Data Quality Notes

- Null values in metrics indicate that the verification stage was not applicable to the profile or could not be completed.
- The trace.jsonl file can be large (thousands to tens of thousands of events per run). Use streaming reads rather than loading the entire file into memory if memory is constrained.
- Hidden-test pass rates are null for Profile A runs because hidden tests are not executed in the basic profile.
- Mutation scores are null for Profile A runs because mutation testing is not enabled.
- Seed-variance and repeated-run metrics are populated only when multiple runs of the same configuration exist.
- Failure categories are recorded in failures.json even for runs that pass all verification stages (some failures may be non-fatal warnings).

### Schema Validation

JSON Schema definitions for all artifact types are located in `schemas/`:

- `run.schema.json`
- `trace-event.schema.json`
- `evidence-report.schema.json`
- `results.schema.json`
- `benchmark.schema.json`

These schemas are versioned and can be used to validate artifacts programmatically:

```python
import json
import jsonschema

with open("schemas/run.schema.json") as f:
    schema = json.load(f)
with open("runs/run-001/run.json") as f:
    data = json.load(f)
jsonschema.validate(data, schema)
```
