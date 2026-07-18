# Research: TypeScript pnpm Monorepo Best Practices

> Regenerable Software Lab — benchmark for evaluating AI coding agents.
> This document synthesizes current best practices (2025–2026) for 8 technical areas relevant to building a CLI benchmark runner + Fastify reference API.

---

## Table of Contents

1. [pnpm Monorepo Best Practices](#1-pnpm-monorepo-best-practices)
2. [Fastify API Patterns](#2-fastify-api-patterns)
3. [CLI Framework Choice](#3-cli-framework-choice)
4. [Docker + Node.js Isolation](#4-docker--nodejs-isolation)
5. [fast-check Property Testing](#5-fast-check-property-testing)
6. [StrykerJS Mutation Testing](#6-strykerjs-mutation-testing)
7. [Zod to JSON Schema](#7-zod-to-json-schema)
8. [JSON Lines Streaming in Node.js](#8-json-lines-streaming-in-nodejs)

---

## 1. pnpm Monorepo Best Practices

### Workspace Configuration

Define a `pnpm-workspace.yaml` with explicit globs for apps and packages:

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

The root `package.json` must be `"private": true` and should declare the package manager version:

```json
{
  "name": "regenerable-software-lab",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "clean": "pnpm -r clean"
  }
}
```

### Workspace Protocol (workspace:*)

Use the `workspace:*` protocol for all internal cross-package dependencies.
pnpm replaces `workspace:*` with the actual version at publish time.
This prevents accidental semver drift between siblings and ensures local resolution only.

```json
{
  "name": "@rsl/runner",
  "dependencies": {
    "@rsl/benchmark-core": "workspace:*",
    "@rsl/trace": "workspace:*",
    "@rsl/policies": "workspace:*"
  }
}
```

Set `saveWorkspaceProtocol: "rolling"` in `.npmrc` so `pnpm add` auto-uses `workspace:*`:

```
# .npmrc
save-workspace-protocol=rolling
auto-install-peers=true
strict-peer-dependencies=true
```

### TypeScript Project References

Each package needs `composite: true` in its `tsconfig.json` and a `references` array pointing to its dependencies.
The root `tsconfig.json` acts as a coordinator listing all workspace projects.

Root coordinator:

```json
{
  "files": [],
  "references": [
    { "path": "packages/benchmark-core" },
    { "path": "packages/trace" },
    { "path": "packages/policies" },
    { "path": "packages/metrics" },
    { "path": "packages/runner" },
    { "path": "packages/evaluator" },
    { "path": "packages/reporting" },
    { "path": "packages/harness-adapters" },
    { "path": "apps/cli" }
  ]
}
```

Shared base config:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true
  }
}
```

Per-package config:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "include": ["src"],
  "references": [
    { "path": "../benchmark-core" }
  ]
}
```

### Build Order

Run `pnpm -r build` for topological build order (pnpm resolves dependencies automatically).
For faster iterations, use TypeScript project references with `tsc -b` which only rebuilds affected packages.
Never create circular workspace dependencies — pnpm warns about them and `tsc -b` refuses to resolve cycles.

### Package Exports

Use the `exports` field to control the public API surface and prevent deep imports into internal files:

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts"
}
```

### Vitest Workspace

Use a root `vitest.workspace.ts` to run all package tests with a single command:

```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*',
  'apps/*',
]);
```

### Key Rules

- Each package has its own `package.json`, `tsconfig.json`, and clear public entry point.
- Phantom dependencies are impossible with pnpm strict mode — every import must be declared.
- Use `pnpm --filter <package> add <dep>` to install per-package dependencies.
- Use `pnpm --filter <package> <script>` to run commands on specific packages.
- The `--filter` flag resolves dependency order automatically — building `runner` also builds `benchmark-core` first.
- Prefer named exports over default exports in library packages.
- Each package should have a README.md describing its purpose and exported API.

---

## 2. Fastify API Patterns

### Framework Setup

Fastify is the chosen framework for the reference API (order-pricing HTTP service).
Use `fastify-type-provider-zod` for end-to-end type safety from Zod schemas to route handlers.

```typescript
import Fastify from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();
```

### Route Definition with Zod Schemas

Define schemas as Zod objects and pass them to Fastify's schema options.
The type provider infers `request.body`, `request.query`, `request.params` automatically.

```typescript
import { z } from 'zod';

const OrderParamsSchema = z.object({
  id: z.string().uuid(),
});

const OrderBodySchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
    unitPrice: z.string().regex(/^\d+\.\d{2}$/),
  })).min(1),
  currency: z.enum(['USD', 'EUR', 'GBP']).default('USD'),
});

const OrderResponseSchema = z.object({
  id: z.string().uuid(),
  total: z.string(),
  currency: z.enum(['USD', 'EUR', 'GBP']),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int(),
    subtotal: z.string(),
  })),
});

app.post('/orders', {
  schema: {
    body: OrderBodySchema,
    response: {
      201: OrderResponseSchema,
    },
  },
  handler: async (request, reply) => {
    // request.body is typed as z.infer<typeof OrderBodySchema>
    const order = await pricingService.createOrder(request.body);
    return reply.status(201).send(order);
  },
});
```

### Error Handling

Use a global error handler with structured error responses.
Catch Zod validation errors and return consistent 400 responses.
Fastify catches uncaught sync/async errors in route handlers automatically and routes them to the error handler.

```typescript
import { ZodError } from 'zod';

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: 'Validation Error',
      statusCode: 400,
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    });
  }

  if (error.statusCode === 429) {
    return reply.status(429).send({
      error: 'Too Many Requests',
      statusCode: 429,
    });
  }

  // Default — log and return generic 500
  request.log.error(error);
  return reply.status(500).send({
    error: 'Internal Server Error',
    statusCode: 500,
  });
});
```

### Testing with Fastify inject

Use Fastify's built-in `inject()` method for testing without a running server.
This is faster and more reliable than making real HTTP requests.

```typescript
import { test, expect } from 'vitest';
import { buildApp } from './app.js';

test('POST /orders accepts valid payload', async () => {
  const app = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/orders',
    payload: {
      items: [{
        productId: '550e8400-e29b-41d4-a716-446655440000',
        quantity: 2,
        unitPrice: '19.99',
      }],
      currency: 'USD',
    },
  });
  expect(response.statusCode).toBe(201);
  const body = JSON.parse(response.body);
  expect(body).toHaveProperty('id');
  expect(body).toHaveProperty('total');
});

test('POST /orders rejects invalid payload', async () => {
  const app = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/orders',
    payload: { items: [] },
  });
  expect(response.statusCode).toBe(400);
});
```

### Plugin Organization

Organize routes into Fastify plugins for encapsulation.
Each plugin gets its own error handler and schema scope.

```typescript
import { FastifyPluginAsync } from 'fastify';

const orderRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/orders', { schema: { body: OrderBodySchema } },
    async (request, reply) => {
      // ...
    });
};

export default orderRoutes;
```

### Production Recommendations

- Enable `@fastify/compress` for response compression.
- Use `@fastify/helmet` for security headers.
- Keep `ajv.allErrors` disabled by default (enables only when detailed validation feedback is needed).
- Define response schemas to speed up JSON serialization.
- Register `@fastify/cors` if clients access the API from different origins.
- Use `app.addHook('onRequest', ...)` for shared pre-request logic like rate limiting.

### Monetary Arithmetic

Use `Decimal.js` for all monetary calculations (never JavaScript `number`).
Define a Zod brand or transform to enforce decimal-string format at the API boundary.

```typescript
import Decimal from 'decimal.js';

const DecimalString = z.string().regex(/^-?\d+\.\d{2}$/)
  .transform((val) => new Decimal(val));

const PricingSchema = z.object({
  unitPrice: DecimalString,
  quantity: z.number().int().positive(),
  currency: z.enum(['USD', 'EUR', 'GBP']),
});
```

---

## 3. CLI Framework Choice

### Recommendation: Commander.js

**Use Commander.js** for the `rsl` CLI tool. It is the most widely adopted Node.js CLI framework (~500M weekly downloads, zero runtime dependencies), has excellent TypeScript definitions, balances capability with simplicity, and can handle our expected 5–20 subcommands without bloat.

### Framework Comparison

| Feature | Commander | Yargs | Clipanion | Oclif |
|---------|-----------|-------|-----------|-------|
| Bundle size | ~50KB | ~100KB | ~30KB | ~12MB+ |
| Dependencies | 0 | ~7 | 0 | ~30+ |
| TypeScript support | Good types | Verbose config | Class-based native | Strong, class-based |
| Subcommands | First-class | Yes | Yes (path-based) | File-based |
| Startup overhead | ~18ms | ~35ms | ~25ms | ~85–135ms |
| Auto-generated help | Yes | Yes | Yes | Yes |
| Shell completion | Manual | Built-in | Built-in | Built-in |
| Plugin system | No | No | No | Yes |
| Best for | Most CLIs (1–20 cmds) | Complex arg validation | Yarn-style tools | Enterprise 50+ cmds |

### Decision Rationale

For a benchmark CLI with a moderate number of subcommands (`run`, `list`, `report`, `validate`, `config`, etc.):

- Commander provides the best tradeoff of simplicity, speed, and TypeScript ergonomics.
- Zero dependencies means no supply chain risk and fast installs.
- The fluent API is self-documenting and easy to test programmatically.
- Yargs's richer validation can be replicated with Zod schemas (already in the stack).
- Oclif's overhead (12MB deps, 135ms startup) is unnecessary for our scale.

### Implementation Pattern

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { z } from 'zod';

const program = new Command();

program
  .name('rsl')
  .description('Regenerable Software Lab benchmark runner')
  .version('0.1.0');

program
  .command('run')
  .description('Run a benchmark')
  .argument('<benchmark-id>', 'Benchmark identifier')
  .option('-m, --model <provider>', 'Model provider to use', 'default')
  .option('-c, --config <path>', 'Path to config file')
  .option('--seed <number>', 'Random seed for reproducibility')
  .option('--verbose', 'Enable verbose logging')
  .action(async (benchmarkId: string, options: Record<string, unknown>) => {
    const parsed = RunOptionsSchema.safeParse({ benchmarkId, ...options });
    if (!parsed.success) {
      console.error('Invalid arguments:', parsed.error.flatten().fieldErrors);
      process.exit(1);
    }
    await runBenchmark(parsed.data);
  });

program
  .command('list')
  .description('List available benchmarks')
  .option('-t, --tag <tag>', 'Filter by tag')
  .action(async (options) => {
    await listBenchmarks(options.tag);
  });

program.parse();
```

### Testing CLIs

Test Commander CLIs programmatically by calling `.parseAsync()` with an argument array:

```typescript
import { test, expect } from 'vitest';

test('rsl run requires benchmark-id', async () => {
  const { Command } = await import('commander');
  const program = new Command();
  // configure program...
  await expect(program.parseAsync(['node', 'rsl', 'run'], { from: 'user' }))
    .rejects.toThrow();
});
```

### Interactive Prompts

For interactive features (wizard mode), use `@clack/prompts` — it has a smaller API surface than Inquirer, first-class TypeScript support, built-in spinners, and clean output.

```typescript
import * as p from '@clack/prompts';

const model = await p.select({
  message: 'Select model provider',
  options: [
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'local', label: 'Local (Ollama)' },
  ],
});
```

### Exit Codes

Treat exit codes and stderr as part of the CLI contract:
- `0` — success
- `1` — general error (invalid args, runtime failure)
- `2` — usage/parsing error (Commander defaults)
- Exceeding thresholds should use exit code `1` with a clear stderr message.

---

## 4. Docker + Node.js Isolation

### Goal

Containers that run benchmark agents must be maximally isolated: no network access, no writable filesystem except tmpfs, no root privileges, and strict resource limits.

### Base Image Strategy

Use a multi-stage build with `node:24-slim` as the build stage and `node:24-slim` or `gcr.io/distroless/nodejs24` as the runtime stage.
Pin exact digests, never use floating tags.

```dockerfile
# ---- Build Stage ----
FROM node:24-slim@sha256:... AS build
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY apps/cli ./apps/cli
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter @rsl/cli build

# ---- Runtime Stage ----
FROM node:24-slim@sha256:...
ENV NODE_ENV=production
WORKDIR /app

# Install dumb-init for PID 1 signal handling
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --shell /bin/bash --create-home app

COPY --chown=app:app --from=build /app/apps/cli/dist ./dist
COPY --chown=app:app --from=build /app/node_modules ./node_modules
COPY --chown=app:app --from=build /app/packages ./packages

USER app
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

### Non-Root User

- Always run as a non-root user (uid 1000).
- Set `COPY --chown=app:app` so the app user owns its files.
- Never run as root — this is the single most impactful runtime hardening step.
- The OWASP Node.js Docker cheat sheet and official nodejs/docker-node best practices both mandate this.

### Read-Only Root Filesystem

Run with `--read-only` and provide tmpfs mounts for writable directories needed by Node.js:

```bash
docker run --read-only \
  --tmpfs /tmp:size=100M,noexec,nosuid,nodev \
  --tmpfs /home/app/.npm:size=10M \
  my-benchmark-image
```

In Docker Compose:

```yaml
services:
  benchmark:
    image: rsl-benchmark
    read_only: true
    tmpfs:
      - /tmp:size=100M,mode=1777,noexec,nosuid,nodev
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE  # if needed
    security_opt:
      - no-new-privileges:true
    user: "1000:1000"
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
```

### Network Isolation

Benchmark containers should have no network access (or only localhost):

```yaml
services:
  agent:
    image: rsl-benchmark
    network_mode: "none"
```

If the agent needs to call model APIs, use a dedicated network with `network_mode: "host"` disabled and instead use a sidecar proxy or restrict egress with iptables.

### Signal Handling with dumb-init

Node.js was not designed to run as PID 1.
PID 1 in Linux ignores signals with default actions unless a handler is explicitly registered.
Use `dumb-init` or Docker's built-in `--init` flag to:
- Forward kernel signals (SIGTERM, SIGINT) to the Node.js process.
- Reap zombie processes.
- Properly propagate exit codes.

```dockerfile
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

Equivalent runtime flag:

```bash
docker run --init my-benchmark-image
```

### .dockerignore

Prevent secrets, git history, and local `node_modules` from entering the build context:

```
node_modules/
dist/
.env
.git/
.gitignore
*.md
coverage/
reports/
```

### Resource Limits

- Set memory limits (`--memory=512m`) to prevent OOM on the host.
- Set CPU limits (`--cpus=0.5`) for fair scheduling.
- Use `--pids-limit=100` to prevent fork bombs.
- Use `--ulimit nofile=1024:1024` to limit open file descriptors.

### Security Checklist (Hardened Container)

| Control | Setting | Rationale |
|---------|---------|-----------|
| Pinned base image | `node:24-slim@sha256:...` | Reproducible builds, known CVE surface |
| Multi-stage build | Build + runtime | Remove dev deps, toolchain from final image |
| Non-root user | `USER app` | Limits escape blast radius |
| Read-only fs | `--read-only` | Prevents tampering at runtime |
| tmpfs mounts | `/tmp`, `/home/app/.npm` | Writable space in memory only |
| Drop all capabilities | `--cap-drop=ALL` | Minimize kernel attack surface |
| No new privileges | `--security-opt no-new-privileges:true` | Prevents privilege escalation |
| Network none | `--network none` | Air-gapped agent execution |
| Init process | `--init` or `dumb-init` | Proper signal handling + zombie reaping |
| Resource limits | Memory, CPU, PIDs | Prevent DoS on host |
| `.dockerignore` | Exclude secrets, `node_modules`, `.git` | Keep layers clean and small |

---

## 5. fast-check Property Testing

### When to Use Property-Based Tests

Property-based testing (PBT) excels where example-based tests miss edge cases.
Use it for:

- **Monetary calculations**: price computations, tax, discounts, allocation (the MVP API domain).
- **Metric aggregation**: summing benchmark results, computing percentiles, statistical invariants.
- **Data transformations**: serialization/deserialization round-trips, schema validation.
- **Stateful systems**: benchmark runner state machine, session lifecycle.

### Stateless Property Testing Pattern

Define properties that must hold for all valid inputs.
fast-check generates random inputs and attempts to find a counterexample.

```typescript
import fc from 'fast-check';
import { calculateOrderTotal } from './pricing.js';
import Decimal from 'decimal.js';

test('order total equals sum of item subtotals', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          quantity: fc.integer({ min: 1, max: 100 }),
          unitPrice: fc.integer({ min: 1, max: 100000 }).map((n) => new Decimal(n).div(100).toFixed(2)),
        }),
        { minLength: 1, maxLength: 50 }
      ),
      (items) => {
        const total = calculateOrderTotal(items.map((i) => ({
          ...i,
          unitPrice: new Decimal(i.unitPrice),
        })));
        const expected = items.reduce(
          (sum, item) => sum.plus(new Decimal(item.unitPrice).times(item.quantity)),
          new Decimal(0)
        );
        expect(total.toString()).toBe(expected.toFixed(2));
      }
    ),
    { numRuns: 1000 }
  );
});
```

### Round-Trip Properties

Test that serialization + deserialization round-trips preserve data:

```typescript
test('JSON serialization round-trips correctly', () => {
  fc.assert(
    fc.property(
      fc.record({
        id: fc.uuid(),
        total: fc.integer({ min: 0, max: 99999999 }).map((n) => new Decimal(n).div(100).toFixed(2)),
        currency: fc.constantFrom('USD', 'EUR', 'GBP'),
        items: fc.array(fc.record({
          productId: fc.uuid(),
          quantity: fc.integer({ min: 1, max: 100 }),
          subtotal: fc.integer({ min: 0, max: 99999999 }).map((n) => new Decimal(n).div(100).toFixed(2)),
        })),
      }),
      (order) => {
        const json = JSON.stringify(order);
        const parsed = JSON.parse(json);
        expect(parsed).toEqual(order);
      }
    )
  );
});
```

### Invariant Properties

Test invariants that must always hold:

```typescript
test('prices are never negative', () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({
        price: fc.integer({ min: 0, max: 1000000 }),
        quantity: fc.integer({ min: 1, max: 100 }),
      })),
      (items) => {
        const total = calculateOrderTotal(items);
        expect(total.isPositive() || total.isZero()).toBe(true);
      }
    )
  );
});
```

### Model-Based (Stateful) Testing

For stateful systems like a benchmark runner session, use fast-check's model-based testing with commands.
Define a simplified model, commands for each action, and compare model state to real system state.

```typescript
import fc from 'fast-check';

// Model: simplified representation of benchmark state
type Model = {
  pendingBenchmarks: string[];
  completedBenchmarks: string[];
  isRunning: boolean;
};

// Real system
class BenchmarkRunner {
  private pending: string[] = [];
  private completed: string[] = [];
  private running = false;

  enqueue(id: string): void { this.pending.push(id); }
  start(): void {
    if (!this.running && this.pending.length > 0) {
      this.running = true;
    }
  }
  complete(): void {
    if (this.running && this.pending.length > 0) {
      const done = this.pending.shift()!;
      this.completed.push(done);
      this.running = false;
    }
  }
  get state() {
    return { pending: [...this.pending], completed: [...this.completed], isRunning: this.running };
  }
}

// Commands
class EnqueueCommand implements fc.Command<Model, BenchmarkRunner> {
  constructor(readonly id: string) {}
  check = () => true;
  run(m: Model, r: BenchmarkRunner): void {
    r.enqueue(this.id);
    m.pendingBenchmarks.push(this.id);
  }
  toString = () => `enqueue(${this.id})`;
}

class StartCommand implements fc.Command<Model, BenchmarkRunner> {
  check(m: Readonly<Model>) { return !m.isRunning && m.pendingBenchmarks.length > 0; }
  run(m: Model, r: BenchmarkRunner): void {
    r.start();
    m.isRunning = true;
  }
  toString = () => 'start';
}

class CompleteCommand implements fc.Command<Model, BenchmarkRunner> {
  check(m: Readonly<Model>) { return m.isRunning && m.pendingBenchmarks.length > 0; }
  run(m: Model, r: BenchmarkRunner): void {
    const completedId = m.pendingBenchmarks[0];
    r.complete();
    m.pendingBenchmarks.shift();
    m.completedBenchmarks.push(completedId);
    m.isRunning = false;
  }
  toString = () => 'complete';
}

test('benchmark runner state machine invariant', () => {
  fc.assert(
    fc.property(
      fc.commands([
        fc.uuid().map((id) => new EnqueueCommand(id)),
        fc.constant(new StartCommand()),
        fc.constant(new CompleteCommand()),
      ]),
      (cmds) => {
        const setup = () => ({
          model: { pendingBenchmarks: [], completedBenchmarks: [], isRunning: false },
          real: new BenchmarkRunner(),
        });
        fc.modelRun(setup, cmds);
      }
    )
  );
});
```

### Best Practices

- **Default 100 runs** per test — increase to 1000 for critical domain logic.
- **Test both valid and invalid inputs** — use `fc.pre(condition)` to filter preconditions.
- **Shrink failures** — fast-check automatically shrinks failing cases to minimal reproducers; capture `seed` and `path` from error output for replay.
- **Combine with Vitest** — `fc.assert()` inside `test()` blocks works seamlessly.
- **Use custom arbitrars** for domain-specific types (e.g., decimal strings, currency codes, UUIDs).
- **Never use example-based data** in property tests — let fast-check generate it.
- **Run fast-check tests separately** from unit tests for faster feedback during development (`pnpm test:unit` vs `pnpm test:property`).

---

## 6. StrykerJS Mutation Testing

### Installation

```bash
pnpm add -D -w @stryker-mutator/core @stryker-mutator/vitest-runner @stryker-mutator/typescript-checker
```

Use the `-w` flag to install at the workspace root (shared dev dependency).

### Configuration

Create `stryker.config.mjs` at the monorepo root:

```javascript
// stryker.config.mjs
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
const config = {
  testRunner: 'vitest',
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  mutate: [
    'packages/benchmark-core/src/**/*.ts',
    'packages/policies/src/**/*.ts',
    'packages/metrics/src/**/*.ts',
    'packages/runner/src/**/*.ts',
    'packages/evaluator/src/**/*.ts',
    '!**/*.test.ts',
    '!**/*.spec.ts',
    '!**/*.d.ts',
  ],
  vitest: {
    configFile: 'vitest.config.ts',
    dir: 'packages',
    related: true,
  },
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },
  concurrency: 4,
  reporters: ['html', 'clear-text', 'progress'],
  coverageAnalysis: 'perTest',
  incremental: true,
};

export default config;
```

### CI-Specific Configuration

Create a stricter config for CI with focused mutation scope:

```javascript
// stryker.config.ci.mjs
import baseConfig from './stryker.config.mjs';

export default {
  ...baseConfig,
  mutate: [
    'packages/benchmark-core/src/**/*.ts',
    'packages/policies/src/**/*.ts',
    'packages/metrics/src/**/*.ts',
    '!**/*.test.ts',
    '!**/*.d.ts',
  ],
  thresholds: { high: 85, low: 70, break: 65 },
  reporters: ['html', 'json'],
};
```

### Per-Package Stryker Configuration

For monorepos, run Stryker per-package to keep mutation runs fast.
Each package can have its own `stryker.config.mjs`:

```javascript
// packages/pricing/stryker.config.mjs
export default {
  testRunner: 'vitest',
  checkers: ['typescript'],
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/*.d.ts'],
  vitest: {
    configFile: '../../vitest.config.ts',
    dir: 'packages/pricing',
  },
  thresholds: { high: 80, low: 60, break: 50 },
};
```

Run with:

```bash
pnpm --filter @rsl/pricing stryker run
```

### Package.json Scripts

Add to the root `package.json`:

```json
{
  "scripts": {
    "test:mutation": "stryker run",
    "test:mutation:ci": "stryker run stryker.config.ci.mjs"
  }
}
```

### Key Configuration Notes

- **checkers: ['typescript']** — The TypeScript checker validates mutants against the type system first, skipping mutants that would cause compile errors. This avoids wasted test runs on type-invalid mutants.
- **coverageAnalysis: 'perTest'** — Stryker records which tests cover which code and only runs relevant tests per mutant. This dramatically speeds up mutation runs.
- **incremental: true** — Caches previous results so only changed files are re-mutated in CI.
- **The Vitest runner overrides**: `singleThread: true`, `bail: 1`, `coverage.enabled: false`, `watch: false`. Stryker manages its own parallelism.
- **Set `vitest.related: true`** to only run tests related to mutated files (default).
- **Disable `vitest.related`** for integration tests that don't import source files directly (e.g., API endpoint tests using `app.inject`).

### Interpreting Results

- **Killed mutant**: Tests caught the bug — good.
- **Survived mutant**: Tests passed despite the injected bug — the code path is not adequately tested.
- **Timeout**: Mutant caused an infinite loop — usually indicates missing error-path tests.
- **Thresholds**: `break` causes the build to fail. `low` is the warning threshold (yellow). `high` is the target (green).

### CICD Integration Example

```yaml
# .github/workflows/mutation.yml
name: Mutation Testing
on:
  pull_request:
    paths:
      - 'packages/**/src/**/*.ts'
jobs:
  mutation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm stryker run --config stryker.config.ci.mjs
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: mutation-report
          path: reports/mutation/
```

---

## 7. Zod to JSON Schema

### Approach

For Zod v4 (which is the target for this project), use the **built-in `z.toJSONSchema()` function**. The external `zod-to-json-schema` package is unmaintained as of November 2025 and the author recommends switching to Zod v4 native JSON Schema support.

For Zod v3 projects still on the migration path, use `zod-to-json-schema` v3.25+.

### Zod v4 Native (Recommended)

```typescript
import { z } from 'zod';

const OrderSchema = z.object({
  id: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
    unitPrice: z.string(),
  })).min(1),
  total: z.string(),
  currency: z.enum(['USD', 'EUR', 'GBP']),
  createdAt: z.string().datetime(),
});

// Convert to JSON Schema
const jsonSchema = z.toJSONSchema(OrderSchema, {
  target: 'draft-2020-12',
});

console.log(JSON.stringify(jsonSchema, null, 2));
```

Output:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "items": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "properties": {
          "productId": { "type": "string", "format": "uuid" },
          "quantity": { "type": "integer", "minimum": 1 },
          "unitPrice": { "type": "string" }
        },
        "required": ["productId", "quantity", "unitPrice"],
        "additionalProperties": false
      }
    },
    "total": { "type": "string" },
    "currency": { "type": "string", "enum": ["USD", "EUR", "GBP"] },
    "createdAt": { "type": "string", "format": "date-time" }
  },
  "required": ["id", "items", "total", "currency", "createdAt"],
  "additionalProperties": false
}
```

### Configuration Options

```typescript
z.toJSONSchema(schema, {
  // Target spec: 'draft-2020-12' (default), 'draft-07', 'draft-04', 'openapi-3.0'
  target: 'draft-2020-12',

  // How to handle types that can't be represented in JSON Schema
  // 'throw' (default) or 'any' (converts to {})
  unrepresentable: 'throw',

  // How to handle cyclic references: 'ref' (default) or 'throw'
  cycles: 'ref',

  // How to handle reused schemas: 'inline' (default) or 'ref'
  reused: 'ref',

  // Which side of transforms to represent: 'output' (default) or 'input'
  io: 'output',

  // Custom override callback
  override: (ctx) => {
    if (ctx.zodSchema._zod.def.type === 'string' && ctx.zodSchema.description === 'monetary') {
      ctx.jsonSchema.pattern = '^\\d+\\.\\d{2}$';
    }
  },
});
```

### Patterns for Schema Artifacts

For benchmark artifacts that need to be validated by non-TypeScript consumers (e.g., Python evaluators), export JSON Schema files:

```typescript
import { z } from 'zod';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Define all artifact schemas
const BenchmarkResultSchema = z.object({
  id: z.string().uuid(),
  benchmarkId: z.string(),
  model: z.string(),
  score: z.number().min(0).max(100),
  duration: z.number().nonnegative(),
  trace: z.array(z.object({
    timestamp: z.string().datetime(),
    action: z.string(),
    details: z.record(z.unknown()).optional(),
  })),
  error: z.string().optional(),
});

// Export as JSON Schema files
const schemasDir = join(import.meta.dirname, '../../schemas');

writeFileSync(
  join(schemasDir, 'benchmark-result.schema.json'),
  JSON.stringify(z.toJSONSchema(BenchmarkResultSchema, { target: 'draft-2020-12' }), null, 2)
);
```

### Important Limitations

- **Custom refine/superRefine** callbacks cannot be represented as JSON Schema.
  They perform arbitrary runtime validation that JSON Schema has no equivalent for.
  Keep refinements in Zod and run a separate Zod validation step when needed.
- **z.undefined()** is unrepresentable in JSON Schema (there is no `undefined` type in JSON).
- **z.never()** is unrepresentable.
- **z.any()** converts to `{}` (the schema that accepts anything).
- **z.instanceof()** is unrepresentable — use `z.object()` or `z.custom()` instead.
- **Transform and pipe** types: by default `z.toJSONSchema` represents the output type.
  Use `io: 'input'` to represent the input type instead.

### Registry Pattern (Cross-File Schemas)

For a set of related schemas, use a registry to generate interlinked JSON Schema files:

```typescript
const registry = z.globalRegistry;

registry.set('Order', OrderSchema.id('Order'));
registry.set('LineItem', LineItemSchema.id('LineItem'));
registry.set('Currency', CurrencySchema.id('Currency'));

// Generate all schemas as a single JSON Schema with $defs
const fullSchema = z.toJSONSchema(registry, {
  target: 'draft-2020-12',
  reused: 'ref',
});
```

### Implementation Strategy for This Project

1. Define all benchmark artifact schemas as Zod schemas (single source of truth).
2. Use `z.toJSONSchema()` to generate and commit `.json` schema files to `schemas/` directory.
3. Validate artifacts at runtime with Zod (native TypeScript consumers).
4. Provide JSON Schema files for non-TypeScript consumers (Python evaluator, harness).
5. Set `unrepresentable: 'throw'` during development to catch unsupported types early.
6. Set `additionalProperties: false` by default (Zod's default `z.object` behavior).
7. Use `id()` on complex schemas for clean `$ref` generation in the registry.

---

## 8. JSON Lines Streaming in Node.js

### Format Definition

JSON Lines (JSONL, NDJSON) stores one valid JSON object per line, terminated by `\n`.
It is ideal for streaming, append-only logging, and processing large datasets without loading them into memory.
Each line is a self-contained, parseable unit.

### Writing JSONL

Use `fs.createWriteStream` with a Transform stream that stringifies and appends newlines:

```typescript
import { createWriteStream } from 'node:fs';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Write a single record
function writeRecord(stream: Writable, record: unknown): boolean {
  return stream.write(JSON.stringify(record) + '\n');
}

// Streaming write of many records
async function writeJsonl(
  filePath: string,
  records: AsyncIterable<unknown>
): Promise<void> {
  const writable = createWriteStream(filePath, { encoding: 'utf-8' });
  for await (const record of records) {
    writable.write(JSON.stringify(record) + '\n');
  }
  writable.end();
  await new Promise((resolve, reject) => {
    writable.on('finish', resolve);
    writable.on('error', reject);
  });
}
```

### Reading JSONL

Use `readline` with `fs.createReadStream` for streaming, memory-efficient parsing:

```typescript
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

async function* readJsonl<T = unknown>(
  filePath: string
): AsyncGenerator<T> {
  const rl = createInterface({
    input: createReadStream(filePath, 'utf-8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      yield JSON.parse(trimmed) as T;
    } catch (err) {
      throw new Error(`Invalid JSONL at line: ${line.slice(0, 100)}`);
    }
  }
}

// Usage
for await (const record of readJsonl<BenchmarkEvent>('trace.jsonl')) {
  processEvent(record);
}
```

### Streaming Transform Pipeline

For ETL pipelines (read JSONL, transform, write JSONL):

```typescript
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

class JsonlParser extends Transform {
  private buffer = '';
  private lineCount = 0;

  constructor() {
    super({ readableObjectMode: true });
  }

  _transform(chunk: Buffer, _enc: string, cb: (err?: Error | null) => void): void {
    this.buffer += chunk.toString('utf-8');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop()!; // keep partial line in buffer
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.lineCount++;
      try {
        this.push(JSON.parse(trimmed));
      } catch (e) {
        cb(new Error(`JSONL parse error at line ${this.lineCount}: ${(e as Error).message}`));
        return;
      }
    }
    cb();
  }

  _flush(cb: (err?: Error | null) => void): void {
    const tail = this.buffer.trim();
    if (tail) {
      try {
        this.push(JSON.parse(tail));
      } catch (e) {
        cb(new Error(`JSONL parse error at end: ${(e as Error).message}`));
        return;
      }
    }
    cb();
  }
}

class JsonlStringifier extends Transform {
  constructor() {
    super({ writableObjectMode: true });
  }

  _transform(
    record: unknown,
    _enc: string,
    cb: (err?: Error | null, chunk?: Buffer) => void
  ): void {
    cb(null, Buffer.from(JSON.stringify(record) + '\n', 'utf-8'));
  }
}

// Pipeline: read -> parse -> transform -> stringify -> write
await pipeline(
  createReadStream('input.jsonl', 'utf-8'),
  new JsonlParser(),
  new Transform({
    readableObjectMode: true,
    writableObjectMode: true,
    transform(record: any, _enc, cb) {
      record.processedAt = new Date().toISOString();
      cb(null, record);
    },
  }),
  new JsonlStringifier(),
  createWriteStream('output.jsonl', 'utf-8')
);
```

### JSONL for Agent Traces

The benchmark project uses JSONL for trace files (one event per line).
This enables streaming reads during evaluation without loading the entire trace:

```typescript
interface TraceEvent {
  timestamp: string;
  type: 'model_call' | 'shell_command' | 'file_modification' | 'verification';
  data: Record<string, unknown>;
}

class TraceWriter {
  private writable: Writable;
  private count = 0;

  constructor(filePath: string) {
    this.writable = createWriteStream(filePath, { encoding: 'utf-8' });
  }

  write(event: TraceEvent): void {
    this.writable.write(JSON.stringify(event) + '\n');
    this.count++;
  }

  async close(): Promise<void> {
    this.writable.end();
    await new Promise((resolve) => this.writable.on('finish', resolve));
  }

  get eventCount(): number {
    return this.count;
  }
}

class TraceReader {
  async *read(filePath: string): AsyncGenerator<TraceEvent> {
    const rl = createInterface({
      input: createReadStream(filePath, 'utf-8'),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      yield JSON.parse(trimmed) as TraceEvent;
    }
  }
}
```

### Error Handling in JSONL Pipelines

- **Fail-fast** for critical pipelines (trace validation).
- **Skip-and-log** for lenient processing (data analysis).
- Quarantine bad records with line offsets and raw payloads for later debugging.
- **Set a max line size** to prevent memory exhaustion:

```typescript
class SafeJsonlParser extends Transform {
  private buffer = '';
  private readonly maxLineLength: number;

  constructor(maxLineLength = 1_000_000) {
    super({ readableObjectMode: true });
    this.maxLineLength = maxLineLength;
  }

  _transform(chunk: Buffer, _enc: string, cb: (err?: Error | null) => void): void {
    this.buffer += chunk.toString('utf-8');

    if (this.buffer.length > this.maxLineLength * 2) {
      cb(new Error(`JSONL buffer exceeded ${this.maxLineLength} bytes`));
      return;
    }

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop()!;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.length > this.maxLineLength) {
        cb(new Error(`Line exceeds ${this.maxLineLength} bytes`));
        return;
      }
      try {
        this.push(JSON.parse(trimmed));
      } catch (e) {
        cb(new Error(`Parse error: ${(e as Error).message}`));
        return;
      }
    }
    cb();
  }

  _flush(cb: (err?: Error | null) => void): void {
    const tail = this.buffer.trim();
    if (tail) {
      try {
        this.push(JSON.parse(tail));
      } catch (e) {
        cb(new Error(`Parse error at end: ${(e as Error).message}`));
        return;
      }
    }
    cb();
  }
}
```

### Key Rules

- **One JSON object per line** — compact, no pretty-printing, valid JSON.
- **Always end with `\n`** — including the last line (flush on end to handle missing trailing newline).
- **Use `StringDecoder`** — decode UTF-8 safely across chunk boundaries.
- **Use `pipeline()`** — for proper backpressure and error propagation.
- **Use async iteration** (`for await...of`) — clean and safe for most flows.
- **Never split on `},{`** — breaks with nested objects, strings containing braces, or arrays.
- **Prefer JSONL over a single large JSON array** for streaming APIs.
- **Track line numbers** in error messages for debuggability.
- **Set explicit max record size** to protect against giant malformed lines.

### Library Recommendations

For simple use cases, the built-in `readline` + `JSON.parse` pattern is sufficient and has zero dependencies.
For complex stream pipelines, use native `Transform` and `pipeline` from `node:stream/promises`.
The `jsonl-parse` npm package provides a configurable stream parser with memory safety features.
The `stream-json` package offers JSONL-specific parsers and stringers for advanced stream chains.
Avoid `ndjson` — the built-in approach is simpler and performs equally well.

---

## Summary of Recommendations

| Topic | Primary Recommendation | Key Tools |
|-------|----------------------|-----------|
| pnpm monorepo | `workspace:*` protocol, TypeScript project references, Vitest workspace | pnpm 9+, tsc -b, Vitest |
| Fastify API | Zod type provider, plugin-encapsulated routes, `app.inject()` testing | Fastify, `fastify-type-provider-zod` |
| CLI framework | **Commander.js** — typed, composable, testable, zero deps | Commander, `@clack/prompts` |
| Docker isolation | Non-root, `--read-only`, `--cap-drop=ALL`, `--network=none`, `dumb-init` | Multi-stage build, distroless |
| Property testing | fast-check: stateless for domain logic, model-based for state machines | fast-check 4.x |
| Mutation testing | StrykerJS with Vitest runner, per-package configs, incremental mode | StrykerJS 7+, `@stryker-mutator/vitest-runner` |
| Zod to JSON Schema | Zod v4 built-in `z.toJSONSchema()`, registry for cross-file schemas | `z.toJSONSchema()` |
| JSONL streaming | `readline` + `createReadStream`, `Transform` pipelines, `StringDecoder` | Node.js built-in streams |
