import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    name: "hidden-tests",
    root: __dirname,
    globals: true,
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/property/**"],
    // Force isolation between test runner instances
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
