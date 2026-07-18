import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "reference-impl",
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
    },
  },
});
