# TypeScript Development — Regenerable Software Lab

> Day-to-day engineering standards for this project.
> See `AGENTS.md` for project-wide conventions.

## Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js 24 | LTS, stable ESM |
| Package manager | pnpm 9+ | Workspace protocol, strict deps |
| Language | TypeScript 5.x | `strict: true` everywhere |
| Build | tsc + tsx | TypeScript compiler for build, tsx for dev scripts |
| Linter | ESLint 9 flat config | typescript-eslint |
| Formatter | Prettier or dprint | Consistent across packages |
| Test runner | Vitest | ESM-native, fast, TS support |
| Property tests | fast-check | Property-based testing for invariants |
| Mutation testing | StrykerJS | Mutation score measurement |

## Package Management

```bash
# Install everything
pnpm install

# Add dep to specific package
pnpm --filter @rsl/runner add zod

# Add dev dep
pnpm --filter @rsl/runner add -D vitest

# Run script in one package
pnpm --filter @rsl/runner test

# Run script across all packages
pnpm -r build
```

Workspace protocol for internal deps:
```json
{
  "dependencies": {
    "@rsl/benchmark-core": "workspace:*"
  }
}
```

## TypeScript Configuration

Base `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

Per-package tsconfig extends base:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

## Zod Schema Patterns

All external inputs validated with Zod:

```typescript
import { z } from "zod";

// Schema definition
export const RunConfigurationSchema = z.object({
  runId: z.string().min(1),
  benchmarkVersion: z.string(),
  applicationId: z.string(),
  profile: z.enum(["basic", "behavioral", "operational"]),
  seed: z.number().int().positive(),
});

// Type inference
export type RunConfiguration = z.infer<typeof RunConfigurationSchema>;

// Validation at boundary
export function parseRunConfiguration(input: unknown): RunConfiguration {
  return RunConfigurationSchema.parse(input);
}
```

JSON Schema export for documentation:
```typescript
import { zodToJsonSchema } from "zod-to-json-schema";
const jsonSchema = zodToJsonSchema(RunConfigurationSchema);
```

## Error Handling

```typescript
// Custom error hierarchy
export class BenchmarkError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BenchmarkError";
  }
}

export class VerificationError extends BenchmarkError {
  constructor(
    message: string,
    public readonly stage: string,
    public readonly failureCategory?: string,
  ) {
    super(message, "VERIFICATION_FAILED", { stage, failureCategory });
    this.name = "VerificationError";
  }
}

// Result type for operations that can fail
export type Result<T, E = BenchmarkError> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

## Testing

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";

describe("Runner", () => {
  it("creates a fresh workspace for each run", async () => {
    const runner = new BenchmarkRunner(config);
    const record = await runner.run(mockRunConfig);
    expect(record.status).toBe("completed");
  });

  it("enforces wall clock limits", async () => {
    // Use fake harness with controlled timing
  });

  it("rejects protected file modifications", async () => {
    // Use fake harness that attempts to write to /spec
  });
});
```

### Test organization
```
packages/runner/
├── src/
│   ├── runner.ts
│   └── ...
└── tests/
    ├── runner.test.ts
    ├── fixtures/
    │   └── sample-config.yaml
    └── helpers/
        └── mock-harness.ts
```

## Logging

Use pino for structured logging:
```typescript
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

logger.info({ runId, stage: "build" }, "Build started");
logger.error({ err, runId }, "Verification failed");
```

No `console.log` in production code. Use logger at appropriate levels:
- `trace`: Detailed internal state
- `debug`: Useful for debugging
- `info`: Key lifecycle events (run started, stage completed)
- `warn`: Recoverable issues (retry, degraded mode)
- `error`: Failures requiring attention
- `fatal`: Unrecoverable, process exit

## CLI Development

Use a CLI framework (commander or clipanion):
```typescript
import { Command } from "commander";

const program = new Command();

program
  .name("rsl")
  .description("Regenerable Software Lab benchmark runner")
  .version("0.1.0");

program
  .command("run")
  .description("Run one benchmark experiment")
  .requiredOption("--benchmark <id>", "Benchmark identifier")
  .requiredOption("--profile <profile>", "Verification profile")
  .requiredOption("--harness <id>", "Harness adapter")
  .requiredOption("--model <model>", "Model identifier")
  .option("--seed <n>", "Random seed", "42")
  .action(async (options) => {
    // ...
  });

program.parse();
```

## File I/O

Prefer `node:fs/promises` for async operations:
```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const content = await readFile(configPath, "utf-8");
await mkdir(runDir, { recursive: true });
await writeFile(join(runDir, "trace.jsonl"), event + "\n", { flag: "a" });
```

## Key Gotchas

- **pnpm strict mode**: Undeclared dependencies are not accessible even if hoisted by another package. Always declare what you import.
- **ESM in Node.js**: Use `.js` extensions in imports even for TypeScript files (`import { foo } from "./bar.js"`).
- **JSON imports**: Use `import data from "./file.json" with { type: "json" }` or `createRequire`.
- **Decimal.js strings**: Always create Decimals from strings, never numbers (`new Decimal("10.50")`, not `new Decimal(10.50)`).
- **Docker non-root**: All Dockerfiles must use a non-root user. Test with `USER node`.
- **No __dirname in ESM**: Use `import.meta.url` with `fileURLToPath`.
