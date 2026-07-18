# TypeScript Development Guidelines — Regenerable Software Lab

> Companion document to AGENTS.md. Concrete TypeScript patterns for this project.
> Source: Phase 1 research (docs/RESEARCH.md) + software-development-standards.

---

## Project Setup

### pnpm Workspaces

Root `package.json`:
```json
{
  "name": "regenerable-software-lab",
  "private": true,
  "packageManager": "pnpm@10.x",
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "build": "tsc -b",
    "lint": "eslint .",
    "typecheck": "tsc -b --noEmit",
    "format": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Root `pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "packages/harness-adapters/*"
  - "apps/*"
```

Root `.npmrc`:
```
save-workspace-protocol=rolling
engine-strict=true
```

### Package Structure

Each package follows this layout:
```
packages/<name>/
├── package.json        # name: "@rsl/<name>", private: true
├── tsconfig.json       # extends ../../tsconfig.json, references: []
├── src/
│   ├── index.ts        # Public API surface
│   └── ...
├── test/
│   └── ...
└── vitest.config.ts
```

### TypeScript Project References

Root `tsconfig.json` (build config):
```json
{
  "files": [],
  "references": [
    { "path": "packages/benchmark-core" },
    { "path": "packages/trace" },
    { "path": "packages/policies" },
    { "path": "packages/metrics" },
    { "path": "packages/evaluator" },
    { "path": "packages/runner" },
    { "path": "packages/reporting" },
    { "path": "packages/harness-adapters/generic-cli" },
    { "path": "packages/harness-adapters/codex" },
    { "path": "apps/cli" }
  ]
}
```

Package `tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true
  },
  "include": ["src"],
  "references": [
    { "path": "../benchmark-core" }
  ]
}
```

Base `tsconfig.json` (shared settings):
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
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

### Build Order

`tsc -b` at the root builds all packages in dependency order.
No need for manual build scripts per package.
Clean: `tsc -b --clean`

---

## Fastify API Patterns

### Route Registration

```typescript
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { orderRoutes } from "./routes/orders.js";

const app = Fastify({
  logger: true,
}).withTypeProvider<ZodTypeProvider>();

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

await app.register(orderRoutes, { prefix: "/orders" });
await app.listen({ port: 3000 });
```

### Route with Zod Validation

```typescript
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

const createOrderSchema = z.object({
  currency: z.enum(["USD", "EUR", "GBP"]),
  taxRate: z.string().regex(/^0\.\d+$/),
});

const orderResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["draft", "calculated"]),
  currency: z.string(),
  items: z.array(z.object({
    id: z.string().uuid(),
    productId: z.string(),
    name: z.string(),
    unitPrice: z.string(),
    quantity: z.number().int().positive(),
    lineTotal: z.string(),
  })),
  // ...rest of Order
});

export const orderRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post("/", {
    schema: {
      body: createOrderSchema,
      response: { 201: orderResponseSchema },
    },
  }, async (request, reply) => {
    const order = await createOrder(request.body);
    return reply.status(201).send(order);
  });
};
```

### Testing with app.inject()

```typescript
import { buildApp } from "../src/app.js";

test("POST /orders creates draft order", async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/orders",
    payload: { currency: "USD", taxRate: "0.08" },
  });

  expect(response.statusCode).toBe(201);
  const body = response.json();
  expect(body.status).toBe("draft");
});
```

### Global Error Handler

```typescript
app.setErrorHandler((error, request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.status(400).send({
      error: "validation_error",
      details: error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  // Never expose stack traces
  request.log.error({ err: error }, "Unhandled error");
  return reply.status(500).send({ error: "internal_error" });
});
```

---

## CLI Development (Commander.js)

### Why Commander.js over alternatives

Commander.js was selected (see ADR in DECISIONS.md):
- Zero dependencies, ~18ms startup.
- First-class TypeScript types.
- Programmatic testing via `.parseAsync()`.
- Subcommand support with `.command()`.

### CLI Entry Point

```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { verifyCommand } from "./commands/verify.js";
import { compareCommand } from "./commands/compare.js";
import { experimentCommand } from "./commands/experiment.js";
import { reportCommand } from "./commands/report.js";
import { traceCommand } from "./commands/trace.js";

const program = new Command();

program
  .name("rsl")
  .description("Regenerable Software Lab — benchmark runner")
  .version("0.1.0");

program.addCommand(runCommand);
program.addCommand(verifyCommand);
program.addCommand(compareCommand);
program.addCommand(experimentCommand);
program.addCommand(reportCommand);
program.addCommand(traceCommand);

await program.parseAsync(process.argv);
```

### Command Pattern

```typescript
import { Command } from "commander";
import type { RunConfiguration } from "@rsl/benchmark-core";

export const runCommand = new Command("run")
  .description("Run a single benchmark experiment")
  .requiredOption("--benchmark <id>", "Benchmark ID")
  .requiredOption("--profile <profile>", "Verification profile")
  .requiredOption("--harness <id>", "Harness adapter ID")
  .requiredOption("--model <model>", "Model identifier")
  .requiredOption("--seed <number>", "Random seed", parseInt)
  .option("--provider <provider>", "Model provider")
  .action(async (options) => {
    const config: RunConfiguration = {
      runId: crypto.randomUUID(),
      benchmarkVersion: "0.1.0",
      applicationId: options.benchmark,
      profile: options.profile,
      harness: { id: options.harness },
      model: {
        provider: options.provider ?? "openai",
        model: options.model,
        seed: options.seed,
      },
      seed: options.seed,
      limits: { wallClockSeconds: 1800 },
    };
    // ...execute run
  });
```

### Testing CLI Commands

```typescript
test("rsl run validates required options", async () => {
  const program = new Command().addCommand(runCommand);
  await expect(program.parseAsync(["run"], { from: "user" }))
    .rejects.toThrow("required option");
});

test("rsl run --help shows usage", async () => {
  const program = new Command().addCommand(runCommand);
  // Capture stdout during parse
  const result = await captureOutput(() =>
    program.parseAsync(["run", "--help"], { from: "user" })
  );
  expect(result).toContain("--benchmark");
});
```

---

## Testing

### Vitest Configuration

Root `vitest.workspace.ts`:
```typescript
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/benchmark-core",
  "packages/trace",
  "packages/policies",
  "packages/metrics",
  "packages/evaluator",
  "packages/runner",
  "packages/reporting",
  "packages/harness-adapters/*",
  "apps/cli",
]);
```

Per-package `vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@rsl/benchmark-core",
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
```

### Test Conventions

- Test files: `*.test.ts` alongside source in `test/` directory.
- Use descriptive names: `test("POST /orders returns 201 for valid input", ...)`.
- Prefer `app.inject()` over real HTTP for Fastify tests.
- Use the fake harness for all runner integration tests.
- Golden files: store expected outputs in `test/__fixtures__/` and compare.

### Property-Based Testing (fast-check)

```typescript
import fc from "fast-check";
import { Decimal } from "decimal.js";

test("order total equals sum of items minus discounts plus tax", () => {
  fc.assert(
    fc.property(
      fc.array(itemArbitrary(), { minLength: 1 }),
      fc.array(discountArbitrary()),
      fc.float({ min: 0, max: 1 }).map((r) => r.toFixed(2)),
      (items, discounts, taxRate) => {
        const order = calculateOrder(items, discounts, taxRate);
        const expected = computeExpectedTotal(items, discounts, taxRate);
        expect(order.grandTotal).toBe(expected);
      }
    )
  );
});

function itemArbitrary() {
  return fc.record({
    id: fc.uuid(),
    productId: fc.uuid(),
    name: fc.string({ minLength: 1 }),
    unitPrice: fc.float({ min: 0, max: 10000 }).map((p) =>
      new Decimal(p).toFixed(2)
    ),
    quantity: fc.integer({ min: 1, max: 100 }),
  });
}
```

---

## Error Handling

### Result Types for Domain Logic

Prefer explicit result types over throwing for expected failures:
```typescript
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function parseOrderConfig(raw: unknown): Result<OrderConfig, ValidationError> {
  const result = OrderConfigSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: new ValidationError(result.error.issues) };
}
```

### Async Error Boundaries

All async operations at package boundaries must have explicit error handling:
```typescript
try {
  const result = await harness.execute(input);
  trace.record({ type: "harness.completed", payload: result });
} catch (err) {
  const error = normalizeError(err);
  trace.record({ type: "harness.error", payload: { error } });
  return { status: "failed" as const, error };
}
```

### Never

- Never use `any` catch clauses: always `catch (err: unknown)`.
- Never swallow errors silently: always log or record to trace.
- Never expose internal error details in API responses.
- Never throw in Fastify route handlers — return error responses instead.

---

## Logging

Use `pino` as the structured logger (allowed by the dependency policy):

```typescript
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Redact sensitive fields
  redact: ["apiKey", "token", "authorization", "password"],
});
```

Log levels:
- `trace`: fine-grained debugging (trace events in benchmark).
- `debug`: development diagnostics.
- `info`: benchmark lifecycle events (run started, stage completed).
- `warn`: recoverable issues (retry, degraded mode).
- `error`: failures requiring attention.
- `fatal`: unrecoverable (container crash, harness timeout).

---

## Performance

### Hot Path Conventions

The benchmark runner is not latency-sensitive, but:
- Trace events use streaming writes (`fs.createWriteStream`), not buffered arrays.
- Large JSON outputs (run artifacts) use streaming serialization where practical.
- Container stdout/stderr captured via streaming, not loaded into memory.
- Mutation testing runs are parallelized per Vitest worker.

### Resource Limits

- Max trace event: 10KB (truncate oversized payloads).
- Max log line: 4KB.
- Container stdout buffer: 1MB.
- Run artifact directory: capped at 1GB (configurable per SPEC.md §16.1).

---

## Docker + Node.js

### Container Entrypoint

```dockerfile
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 1000 agent
COPY --chown=agent:agent workspace/ /workspace/
USER agent
WORKDIR /workspace
ENTRYPOINT ["dumb-init", "--"]
CMD ["pnpm", "start"]
```

### Runner Container Launch

```typescript
const container = await docker.createContainer({
  Image: "ghcr.io/rmax-ai/regenerable-software-lab/node-runner:0.1.0",
  Cmd: ["pnpm", "install", "--offline", "--frozen-lockfile"],
  HostConfig: {
    ReadonlyRootfs: true,
    Tmpfs: { "/tmp": "rw,noexec,nosuid,size=256M", "/home/agent": "rw,size=1G" },
    NetworkMode: "none",
    CapDrop: ["ALL"],
    Memory: 2 * 1024 * 1024 * 1024,
    NanoCpus: 2_000_000_000,
    Mounts: [
      { Type: "bind", Source: workspacePath, Target: "/workspace", ReadOnly: false },
      { Type: "bind", Source: specPath, Target: "/spec", ReadOnly: true },
    ],
  },
  User: "1000:1000",
});
```

---

## Dependencies

### Adding a Dependency

```bash
pnpm --filter @rsl/evaluator add zod
```

### Version Pinning

All dependencies use exact versions in `package.json`.
`pnpm-lock.yaml` is committed.
No `^` or `~` ranges.
Dependabot/Renovate configured for automated updates.

### Dependency Policy Enforcement

The policy checker (Profile C) validates:
- Only explicitly allowed packages in `dependencies`.
- No git, URL, or local path dependencies.
- No post-install scripts (blocked via `.npmrc` `ignore-scripts=true`).
- Lockfile hash matches before verification.
- License compliance (SPDX identifiers from `pnpm licenses list`).

---

## Code Quality

### ESLint Configuration

Uses `eslint.config.mjs` (flat config) with:
- `typescript-eslint` (strict-type-checked)
- `eslint-plugin-import` (ordered imports)
- `eslint-plugin-unicorn` (modern JS conventions)

### CI Checks

```bash
pnpm lint          # Must pass
pnpm typecheck     # Must pass (tsc --noEmit)
pnpm format        # Must pass (prettier --check)
pnpm test          # Must pass (vitest run)
```

No warnings allowed at any level.
`// eslint-disable-next-line` requires a justification comment.

---

## JSON Lines (JSONL)

### Writing

```typescript
import { createWriteStream } from "node:fs";
import { Transform, pipeline } from "node:stream";
import { StringDecoder } from "node:string_decoder";

const traceStream = createWriteStream("trace.jsonl");

function writeEvent(event: TraceEvent): void {
  const line = JSON.stringify(event) + "\n";
  traceStream.write(line);
}
```

### Reading

```typescript
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

async function* readTrace(path: string): AsyncGenerator<TraceEvent> {
  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line) as TraceEvent;
  }
}
```

---

## JSON Schema Generation (Zod)

Zod v4 has built-in `z.toJSONSchema()`:
```typescript
import { z } from "zod";

const runConfigSchema = z.object({
  runId: z.string().uuid(),
  benchmarkVersion: z.string(),
  profile: z.enum(["basic", "behavioral", "operational"]),
  seed: z.number().int(),
});

// Generate JSON Schema for artifact validation
import { writeFileSync } from "node:fs";
const jsonSchema = z.toJSONSchema(runConfigSchema);
writeFileSync(
  "schemas/run.schema.json",
  JSON.stringify(jsonSchema, null, 2)
);
```

Note: `zod-to-json-schema` (external package) is unmaintained.
Use Zod v4's built-in `z.toJSONSchema()`.
Limitations: `refine`, `superRefine`, `z.undefined()`, `z.never()`, `z.instanceof()` are not representable in JSON Schema.
Use `z.preprocess()` or manual validation for these cases.
