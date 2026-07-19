import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CANDIDATE_SRC env var points to the agent's generated source code.
// Falls back to the reference implementation for local development.
const candidateSrc =
  process.env.CANDIDATE_SRC ||
  path.resolve(__dirname, "..", "reference-impl", "src");

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
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
