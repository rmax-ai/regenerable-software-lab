// @rsl/harness-fake — Deterministic scenario definitions
//
// Each scenario defines a named simulation outcome for the fake harness.
// Scenarios produce an ExecutionResult and may produce workspace artifacts
// or an EvidenceReport.

import type {
  ExecutionResult,
  EvidenceReport,
  NormalizedError,
  ModelUsage,
} from "@rsl/benchmark-core";

// ── Scenario Identifier ─────────────────────────────────────────────────────

export type ScenarioId =
  | "success"
  | "buildFailure"
  | "timeout"
  | "policyViolation"
  | "falseClaim"
  | "budgetExhausted"
  | "partialImpl"
  | "repeatedCommands";

// ── Scenario Definition ─────────────────────────────────────────────────────

export interface ScenarioDefinition {
  /** Human-readable label for the scenario. */
  readonly label: string;
  /** The execution result the harness should return. */
  readonly result: ExecutionResult;
  /** Optional evidence report attached to workspace artifacts. */
  readonly evidenceReport?: EvidenceReport;
  /** Optional list of fake workspace file paths to include in artifacts. */
  readonly workspaceFiles?: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_USAGE: ModelUsage = {
  modelCalls: 5,
  inputTokens: 2500,
  outputTokens: 1200,
  estimatedCostUsd: 0.035,
};

const TIMED = (): Pick<ExecutionResult, "startedAt" | "completedAt"> => {
  const now = new Date().toISOString();
  return { startedAt: now, completedAt: now };
};

const err = (code: string, message: string, category?: string): NormalizedError => ({
  code,
  message,
  ...(category ? { category } : {}),
});

// ── Scenarios ───────────────────────────────────────────────────────────────

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  // ── 1. Success ──────────────────────────────────────────────────────────
  success: {
    label: "Success — completed implementation",
    result: {
      status: "completed",
      ...TIMED(),
      exitCode: 0,
      reportedCompletion: true,
      modelUsage: DEFAULT_USAGE,
    },
    evidenceReport: {
      runId: "",
      implementationSummary:
        "Implemented all specified routes and business logic. All tests passing.",
      filesChanged: ["src/routes/users.ts", "src/routes/orders.ts", "src/models.ts"],
      commandsExecuted: ["pnpm install", "pnpm build", "pnpm test"],
      checksClaimed: [
        { name: "unit-tests", command: "pnpm test", claimedStatus: "passed" },
        { name: "build", command: "pnpm build", claimedStatus: "passed" },
      ],
      assumptions: [],
      knownLimitations: [],
      remainingUncertainty: [],
    },
    workspaceFiles: [
      "src/routes/users.ts",
      "src/routes/orders.ts",
      "src/models.ts",
      "src/index.ts",
      "README.md",
    ],
  },

  // ── 2. Build Failure ────────────────────────────────────────────────────
  buildFailure: {
    label: "Build Failure — compilation error",
    result: {
      status: "failed",
      ...TIMED(),
      exitCode: 1,
      reportedCompletion: false,
      modelUsage: DEFAULT_USAGE,
      error: err(
        "BUILD_FAILURE",
        "TypeScript compilation failed: src/routes/users.ts(42,3): error TS2322: Type 'string' is not assignable to type 'number'.",
        "BUILD_FAILURE",
      ),
    },
    workspaceFiles: [
      "src/routes/users.ts",
      "src/routes/orders.ts",
      "tsconfig.json",
    ],
  },

  // ── 3. Timeout ──────────────────────────────────────────────────────────
  timeout: {
    label: "Timeout — wall clock limit exceeded",
    result: {
      status: "timeout",
      ...TIMED(),
      exitCode: undefined,
      reportedCompletion: false,
      modelUsage: {
        modelCalls: 47,
        inputTokens: 84000,
        outputTokens: 32000,
        estimatedCostUsd: 0.89,
      },
      error: err(
        "HARNESS_TIMEOUT",
        "Run exceeded wall clock limit of 600 seconds after 47 model calls.",
        "HARNESS_TIMEOUT",
      ),
    },
    workspaceFiles: [
      "src/routes/users.ts",
      "src/routes/orders.ts",
      "src/partial.ts",
    ],
  },

  // ── 4. Policy Violation ─────────────────────────────────────────────────
  policyViolation: {
    label: "Policy Violation — protected file modification attempt",
    result: {
      status: "policy_terminated",
      ...TIMED(),
      exitCode: 137,
      reportedCompletion: false,
      modelUsage: {
        modelCalls: 12,
        inputTokens: 18000,
        outputTokens: 7400,
        estimatedCostUsd: 0.19,
      },
      error: err(
        "PROTECTED_ASSET_MODIFICATION",
        "Agent attempted to write to protected path /spec/SPEC.md. Policy guard terminated the run.",
        "PROTECTED_ASSET_MODIFICATION",
      ),
    },
    workspaceFiles: [],
  },

  // ── 5. False Claim ──────────────────────────────────────────────────────
  falseClaim: {
    label: "False Success Claim — agent claims passing tests it never ran",
    result: {
      status: "completed",
      ...TIMED(),
      exitCode: 0,
      reportedCompletion: true,
      modelUsage: DEFAULT_USAGE,
    },
    evidenceReport: {
      runId: "",
      implementationSummary: "Implementation complete. All tests passing.",
      filesChanged: ["src/routes/users.ts"],
      commandsExecuted: ["pnpm install"],
      checksClaimed: [
        { name: "unit-tests", command: "pnpm test", claimedStatus: "passed" },
        { name: "integration-tests", command: "pnpm test:integration", claimedStatus: "passed" },
        { name: "e2e-tests", command: "pnpm test:e2e", claimedStatus: "passed" },
      ],
      assumptions: [],
      knownLimitations: [],
      remainingUncertainty: [],
    },
    workspaceFiles: ["src/routes/users.ts", "README.md"],
  },

  // ── 6. Budget Exhausted ─────────────────────────────────────────────────
  budgetExhausted: {
    label: "Budget Exhausted — token/cost limit reached",
    result: {
      status: "budget_exhausted",
      ...TIMED(),
      exitCode: undefined,
      reportedCompletion: false,
      modelUsage: {
        modelCalls: 150,
        inputTokens: 285000,
        outputTokens: 102000,
        estimatedCostUsd: 5.02,
      },
      error: err(
        "RESOURCE_LIMIT_EXCEEDED",
        "Run exceeded maximum cost limit of $5.00 USD (actual: $5.02). Agent made 150 model calls.",
        "RESOURCE_LIMIT_EXCEEDED",
      ),
    },
    workspaceFiles: [
      "src/routes/users.ts",
      "src/routes/orders.ts",
      "src/models.ts",
    ],
  },

  // ── 7. Partial Implementation ───────────────────────────────────────────
  partialImpl: {
    label: "Partial Implementation — only half the routes created",
    result: {
      status: "completed",
      ...TIMED(),
      exitCode: 0,
      reportedCompletion: true,
      modelUsage: DEFAULT_USAGE,
    },
    evidenceReport: {
      runId: "",
      implementationSummary: "Implemented user routes. Order routes not yet started.",
      filesChanged: ["src/routes/users.ts", "src/models.ts"],
      commandsExecuted: ["pnpm install", "pnpm build", "pnpm test"],
      checksClaimed: [
        { name: "unit-tests", command: "pnpm test", claimedStatus: "passed" },
        { name: "build", command: "pnpm build", claimedStatus: "passed" },
      ],
      assumptions: [],
      knownLimitations: [
        "Order routes (GET /orders, POST /orders, GET /orders/:id) not implemented",
        "Order model missing from schema",
      ],
      remainingUncertainty: [
        "Whether order-related API contracts will be met",
      ],
    },
    workspaceFiles: [
      "src/routes/users.ts",
      "src/models.ts",
      "README.md",
    ],
  },

  // ── 8. Repeated Commands ────────────────────────────────────────────────
  repeatedCommands: {
    label: "Repeated Commands — agent stuck in unproductive loop",
    result: {
      status: "failed",
      ...TIMED(),
      exitCode: 1,
      reportedCompletion: false,
      modelUsage: {
        modelCalls: 90,
        inputTokens: 165000,
        outputTokens: 58000,
        estimatedCostUsd: 1.67,
      },
      error: err(
        "REPEATED_UNPRODUCTIVE_LOOP",
        "Agent ran 'pnpm install' 14 times and 'pnpm test' 23 times without making any file changes between iterations. Trace shows no progress for 35 consecutive model calls.",
        "REPEATED_UNPRODUCTIVE_LOOP",
      ),
    },
    workspaceFiles: [
      "src/routes/users.ts",
      "src/routes/orders.ts",
    ],
  },
};
