import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CANDIDATE_SRC env var points to the agent's generated source code.
// Falls back to the reference implementation for local development.
const candidateSrc =
  process.env.CANDIDATE_SRC ||
  path.resolve(__dirname, "..", "reference-impl", "src");

// AGENT_NODE_MODULES: agent's node_modules dir for packages the agent
// installed but aren't in this hidden directory (e.g. decimal.js).
const agentModules = process.env.AGENT_NODE_MODULES;

// TEST_MODE: "hidden" | "property" | "all" — controls which tests run
const testMode = process.env.TEST_MODE || "hidden";

const include =
  testMode === "property"
    ? ["tests/property/**/*.test.ts"]
    : testMode === "all"
      ? ["tests/**/*.test.ts"]
      : ["tests/**/*.test.ts"]; // hidden = all non-property excluded below

export default defineConfig({
  resolve: {
    alias: {
      "@candidate": candidateSrc,
      // Resolve packages from agent's node_modules when available.
      // This lets property tests find fast-check, decimal.js, etc.
      ...(agentModules
        ? {
            "fast-check": path.join(agentModules, "fast-check"),
            "decimal.js": path.join(agentModules, "decimal.js"),
          }
        : {}),
    },
  },
  test: {
    name: "hidden-tests",
    root: __dirname,
    globals: true,
    include,
    exclude:
      testMode === "property"
        ? []
        : testMode === "hidden"
          ? ["tests/property/**"]
          : [],
    // Keep property runs bounded; HTTP inject loops can otherwise overrun CI.
    testTimeout: testMode === "property" ? 30_000 : 10_000,
    hookTimeout: 10_000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Fastify inject / open handles can keep the worker alive after completion.
    forceExit: true,
  },
});
