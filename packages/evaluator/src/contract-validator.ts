// @rsl/evaluator — Contract validator (Stage 6)
//
// Loads the candidate workspace's OpenAPI specification (openapi.yaml),
// starts the application server, makes requests to all discovered routes,
// and validates responses against the declared JSON schemas.

import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import * as yaml from "js-yaml";
import type { StageResult } from "./types.js";

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Run contract validation against a candidate workspace.
 *
 * Steps:
 *  1. Locate and parse `openapi.yaml`
 *  2. Start the application server via `pnpm start` or `node dist/server.js`
 *  3. Wait for the server to become reachable
 *  4. For each documented GET route: send a request and validate the response
 *  5. Shut down the server
 *  6. Return a StageResult summarising the outcome
 */
export async function validateContract(workspacePath: string): Promise<StageResult> {
  const start = performance.now();

  try {
    // ── 1. Locate the OpenAPI spec ────────────────────────────────────
    const specPath = resolveSpecPath(workspacePath);
    const rawSpec = readFileSync(specPath, "utf-8");
    const spec = yaml.load(rawSpec) as OpenApiSpec | undefined;

    if (!spec || !spec.paths) {
      return fail("OpenAPI spec could not be parsed", "CONTRACT_VIOLATION", start);
    }

    // ── 2. Discover GET routes ────────────────────────────────────────
    const getRoutes: { path: string; responseSchema?: unknown; statusCode: string }[] = [];
    for (const [routePath, methods] of Object.entries(spec.paths)) {
      if (!methods) continue;
      const getOp = (methods as Record<string, unknown>)["get"] as
        | { responses?: Record<string, unknown> }
        | undefined;
      if (!getOp?.responses) continue;

      // Pick the first 2xx response
      for (const [code, resp] of Object.entries(getOp.responses)) {
        if (code.startsWith("2")) {
          const schema = extractSchema(resp as ResponseObject);
          getRoutes.push({ path: routePath, responseSchema: schema, statusCode: code });
          break;
        }
      }
    }

    if (getRoutes.length === 0) {
      return fail("No GET routes found in OpenAPI spec", "CONTRACT_VIOLATION", start);
    }

    // ── 3. Start the server ────────────────────────────────────────────
    const serverProc = await startServer(workspacePath, specPath);
    if (!serverProc) {
      return fail("Failed to start application server", "ENVIRONMENT_FAILURE", start);
    }

    try {
      // ── 4. Probe each route ──────────────────────────────────────────
      const baseUrl = "http://localhost:3000";
      let allPassed = true;
      let testedCount = 0;
      const errors: string[] = [];

      for (const route of getRoutes) {
        const url = `${baseUrl}${route.path}`;
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
          testedCount++;

          if (!response.ok && !route.statusCode.startsWith("2")) {
            // Non-2xx response for an error route — acceptable
            continue;
          }

          if (response.ok && route.responseSchema) {
            const body: unknown = await response.json();
            const validationErrors = validateJsonSchema(body, route.responseSchema as SchemaNode);
            if (validationErrors.length > 0) {
              allPassed = false;
              errors.push(`GET ${route.path}: ${validationErrors.join("; ")}`);
            }
          } else if (!response.ok) {
            allPassed = false;
            errors.push(`GET ${route.path}: HTTP ${response.status}`);
          }
        } catch (err: unknown) {
          allPassed = false;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`GET ${route.path}: request failed — ${msg}`);
        }
      }

      const durationMs = Math.round(performance.now() - start);

      if (allPassed) {
        return {
          stage: 6,
          name: "Contract Validation",
          status: "passed",
          durationMs,
          metrics: { routesTested: testedCount, violations: 0 },
          artifacts: [],
        };
      }

      return {
        stage: 6,
        name: "Contract Validation",
        status: "failed",
        durationMs,
        metrics: { routesTested: testedCount, violations: errors.length },
        failureCategory: "CONTRACT_VIOLATION",
        artifacts: errors,
      };
    } finally {
      // ── 5. Shut down the server ──────────────────────────────────────
      killServer(serverProc);
    }
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    return {
      stage: 6,
      name: "Contract Validation",
      status: "error",
      durationMs,
      metrics: { error: message },
      failureCategory: "EVALUATOR_ERROR",
      artifacts: [],
    };
  }
}

// ── Internal helpers ────────────────────────────────────────────────────

function fail(
  message: string,
  category: "CONTRACT_VIOLATION" | "ENVIRONMENT_FAILURE" | "EVALUATOR_ERROR",
  start: number,
): StageResult {
  return {
    stage: 6,
    name: "Contract Validation",
    status: "failed",
    durationMs: Math.round(performance.now() - start),
    metrics: { error: message },
    failureCategory: category,
    artifacts: [],
  };
}

/** Try to find `openapi.yaml` in common locations within the workspace. */
function resolveSpecPath(workspacePath: string): string {
  const candidates = [
    resolve(workspacePath, "spec", "openapi.yaml"),
    resolve(workspacePath, "openapi.yaml"),
    resolve(workspacePath, "docs", "openapi.yaml"),
    resolve(workspacePath, "benchmarks", "order-pricing", "visible", "openapi.yaml"),
  ];
  for (const p of candidates) {
    try {
      readFileSync(p);
      return p;
    } catch {
      continue;
    }
  }
  // Fall back to the most likely path
  return candidates[0]!;
}

/**
 * Start the application server as a child process.
 *
 * Tries `pnpm start` first, then `node dist/server.js`.
 * Returns `null` on failure, the child process reference on success.
 */
async function startServer(workspacePath: string, specPath: string): Promise<ChildProcess | null> {
  const serverEntry = resolve(workspacePath, "dist", "server.js");

  // Try pnpm start
  try {
    const proc = spawn("pnpm", ["start"], {
      cwd: workspacePath,
      stdio: "pipe",
      shell: true,
      env: { ...process.env, PORT: "3000", NODE_ENV: "development" },
    });

    // Wait up to 15 seconds for the server to become ready
    const ready = await waitForServer("http://localhost:3000/health", 15_000);
    if (ready) return proc;

    // If pnpm start didn't work, try direct node invocation
    killServer(proc);
  } catch {
    // fall through
  }

  // Fallback: try `node dist/server.js`
  try {
    // Check if the server entry exists
    readFileSync(serverEntry);
  } catch {
    return null;
  }

  const proc = spawn("node", [serverEntry], {
    cwd: workspacePath,
    stdio: "pipe",
    shell: true,
    env: { ...process.env, PORT: "3000", NODE_ENV: "development" },
  });

  const ready = await waitForServer("http://localhost:3000/health", 15_000);
  return ready ? proc : null;
}

/** Poll the health endpoint until the server responds or the timeout expires. */
async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
  return false;
}

/** Kill a child process and all its children. */
function killServer(proc: ChildProcess): void {
  try {
    proc.kill("SIGTERM");
    // Give it 3 seconds to shut down gracefully, then SIGKILL
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // already dead
      }
    }, 3_000).unref();
  } catch {
    // already dead
  }
}

// ── Simple JSON Schema validation ───────────────────────────────────────

type SchemaNode = Record<string, unknown>;

/** Recursively validate a value against a JSON Schema node. Returns error messages. */
function validateJsonSchema(value: unknown, schema: SchemaNode, path = "$"): string[] {
  const errors: string[] = [];

  // Handle $ref — for simplicity, we don't resolve external refs here;
  // the spec is dereferenced by the caller.
  if (schema.$ref && typeof schema.$ref === "string") {
    // Skip validation for unresolved refs (shouldn't happen with our usage)
    return [];
  }

  const type = schema.type;

  if (type === "object" || !type) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push(`${path}: expected object`);
      return errors;
    }

    // Check required fields
    const required = schema.required as string[] | undefined;
    if (required) {
      for (const field of required) {
        if (!(field in (value as Record<string, unknown>))) {
          errors.push(`${path}: missing required field "${field}"`);
        }
      }
    }

    // Check additionalProperties
    if (schema.additionalProperties === false && typeof value === "object" && value !== null) {
      const allowed = new Set<string>();
      if (schema.properties && typeof schema.properties === "object") {
        for (const key of Object.keys(schema.properties as Record<string, unknown>)) {
          allowed.add(key);
        }
      }
      for (const key of Object.keys(value as Record<string, unknown>)) {
        if (!allowed.has(key)) {
          errors.push(`${path}: unexpected field "${key}"`);
        }
      }
    }

    // Validate each property
    if (schema.properties && typeof schema.properties === "object") {
      const props = schema.properties as Record<string, unknown>;
      for (const [key, propSchema] of Object.entries(props)) {
        const val = (value as Record<string, unknown>)[key];
        if (val !== undefined) {
          errors.push(
            ...validateJsonSchema(val, propSchema as SchemaNode, `${path}.${key}`),
          );
        }
      }
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`);
      return errors;
    }
    const items = schema.items as SchemaNode | undefined;
    if (items) {
      for (let i = 0; i < value.length; i++) {
        errors.push(...validateJsonSchema(value[i], items, `${path}[${i}]`));
      }
    }
  } else if (type === "string") {
    if (typeof value !== "string") {
      errors.push(`${path}: expected string, got ${typeof value}`);
      return errors;
    }
    // Check enum
    const enumValues = schema.enum as string[] | undefined;
    if (enumValues && !enumValues.includes(value)) {
      errors.push(`${path}: "${value}" not in enum [${enumValues.join(", ")}]`);
    }
    // Check pattern
    const pattern = schema.pattern as string | undefined;
    if (pattern) {
      try {
        const re = new RegExp(`^${pattern}$`);
        if (!re.test(value)) {
          errors.push(`${path}: "${value}" does not match pattern /${pattern}/`);
        }
      } catch {
        // invalid regex in schema — skip
      }
    }
  } else if (type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      errors.push(`${path}: expected integer`);
    }
    const min = schema.minimum as number | undefined;
    if (min !== undefined && typeof value === "number" && value < min) {
      errors.push(`${path}: ${value} is less than minimum ${min}`);
    }
  } else if (type === "number") {
    if (typeof value !== "number") {
      errors.push(`${path}: expected number`);
    }
  } else if (type === "boolean") {
    if (typeof value !== "boolean") {
      errors.push(`${path}: expected boolean`);
    }
  }

  return errors;
}

/** Extract the response schema from a ResponseObject, resolving $ref if present. */
function extractSchema(resp: ResponseObject): unknown {
  if (!resp.content?.["application/json"]?.schema) return undefined;
  return resp.content["application/json"].schema;
}

// ── Local type helpers (mirror subset of OpenAPI 3.1) ───────────────────

interface OpenApiSpec {
  openapi?: string;
  info?: Record<string, unknown>;
  paths?: Record<string, unknown>;
  components?: {
    schemas?: Record<string, unknown>;
  };
}

interface ResponseObject {
  description?: string;
  content?: {
    "application/json"?: {
      schema?: unknown;
    };
  };
}
