import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "property-tests",
    globals: true,
    include: ["hidden/tests/property/**/*.test.ts"],
    root: "..",
  },
});
