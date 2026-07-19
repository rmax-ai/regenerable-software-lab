// @rsl/runner -- Observability checker (SPEC.md §17)
//
// Verifies that the generated server exposes a GET /health endpoint,
// uses structured JSON logging (pino format), and that log lines
// comply with the expected format.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ObservabilityViolation {
  check: string;
  reason: string;
  severity: "error" | "warning";
}

export interface ObservabilityReport {
  healthEndpointAvailable: boolean;
  structuredLoggingDetected: boolean;
  logFormatCompliant: boolean;
  violations: ObservabilityViolation[];
  passed: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────

/** Expected structured log fields per pino convention. */
const PINO_REQUIRED_FIELDS = ["level", "time", "msg"];

/** Common log file patterns to scan. */
const LOG_FILE_PATTERNS = [
  "*.log",
  "*.jsonl",
  "*.ndjson",
  "stdout.log",
  "stderr.log",
  "server.log",
  "app.log",
  "output.log",
];

/** Source file patterns where the server entry point might live. */
const SERVER_FILE_PATTERNS = [
  "src/server.ts",
  "src/server.js",
  "src/index.ts",
  "src/index.js",
  "src/app.ts",
  "src/app.js",
  "src/main.ts",
  "src/main.js",
];

// ── ObservabilityChecker ──────────────────────────────────────────────────

export class ObservabilityChecker {
  /**
   * Run all observability checks against the workspace.
   *
   * @param workspacePath - Absolute path to the workspace root.
   * @returns An ObservabilityReport summarizing all checks.
   */
  check(workspacePath: string): ObservabilityReport {
    const sourceDir = resolve(workspacePath, "source");
    const violations: ObservabilityViolation[] = [];

    // ── Check 1: Health endpoint ─────────────────────────────────────
    const healthEndpointAvailable = this.checkHealthEndpoint(sourceDir);
    if (!healthEndpointAvailable) {
      violations.push({
        check: "healthEndpoint",
        reason: "Server does not expose GET /health endpoint or no server entry point found",
        severity: "error",
      });
    }

    // ── Check 2: Structured JSON logging ─────────────────────────────
    const structuredLoggingDetected = this.checkStructuredLogging(sourceDir);
    if (!structuredLoggingDetected) {
      violations.push({
        check: "structuredLogging",
        reason: "Structured JSON logging (pino format) not detected in server source files",
        severity: "error",
      });
    }

    // ── Check 3: Log format compliance ───────────────────────────────
    const logFormatCompliant = this.checkLogFormat(sourceDir);
    if (!logFormatCompliant) {
      violations.push({
        check: "logFormatCompliance",
        reason: "Log output does not conform to expected JSON format (pino style)",
        severity: "warning",
      });
    }

    return {
      healthEndpointAvailable,
      structuredLoggingDetected,
      logFormatCompliant,
      violations,
      passed: violations.length === 0,
    };
  }

  // ── Health Endpoint Check ───────────────────────────────────────────

  /**
   * Check whether the server exposes a GET /health endpoint.
   *
   * Inspects server source files for route definitions containing
   * "health" or "/health". This is a static analysis check.
   */
  private checkHealthEndpoint(sourceDir: string): boolean {
    if (!existsSync(sourceDir)) {
      return false;
    }

    const serverFiles = this.findSourceFiles(sourceDir);

    for (const filePath of serverFiles) {
      try {
        const content = readFileSync(filePath, "utf-8");

        // Fastify: app.get('/health', ...) or .get('/health', handler)
        if (
          /(\.get|\.route)\s*\(\s*['"`]\/*health['"`]/i.test(content) ||
          /['"`]\/*health['"`]\s*,/.test(content)
        ) {
          return true;
        }

        // Express-style: app.get('/health', ...)
        if (/app\.get\s*\(\s*['"`]\/*health/i.test(content)) {
          return true;
        }

        // Direct HTTP server: createServer with health path
        if (
          /health/.test(content) &&
          /(req\.url|request\.url)\s*===\s*['"`]\/*health['"`]/i.test(content)
        ) {
          return true;
        }

        // Raw handler: if url === '/health' or url.startsWith('/health')
        if (
          /health/i.test(content) &&
          /(url|path)\s*(===|startsWith|includes)\s*\(?['"`]\/*health['"`]/i.test(content)
        ) {
          return true;
        }
      } catch {
        // skip unreadable files
      }
    }

    return false;
  }

  // ── Structured Logging Check ───────────────────────────────────────

  /**
   * Check whether the server uses structured JSON logging (pino format).
   *
   * Looks for pino import/require statements and logger creation patterns.
   */
  private checkStructuredLogging(sourceDir: string): boolean {
    if (!existsSync(sourceDir)) {
      return false;
    }

    const serverFiles = this.findSourceFiles(sourceDir);

    for (const filePath of serverFiles) {
      try {
        const content = readFileSync(filePath, "utf-8");

        // Import pattern: import pino from 'pino'
        if (
          /import\s+pino\s+from\s+['"`]pino['"`]/.test(content) ||
          /const\s+pino\s*=\s*require\s*\(\s*['"`]pino['"`]\s*\)/.test(content)
        ) {
          return true;
        }

        // pino() call pattern
        if (/\b(pino|pinoLogger|createLogger)\s*\(\s*\{/.test(content)) {
          return true;
        }

        // Pino destination / transport
        if (/pino\.(destination|transport|multistream)/.test(content)) {
          return true;
        }

        // Fastify logger: true or { level: ... } configuration
        if (
          /Fastify\s*\(\s*\{[\s\S]{0,500}logger\s*:\s*(true|pino|\{)/i.test(content) ||
          /fastify\s*\(\s*\{[\s\S]{0,500}logger\s*:\s*(true|pino|\{)/i.test(content)
        ) {
          return true;
        }
      } catch {
        // skip unreadable files
      }
    }

    // If no source files reference pino, check for pino in package.json
    const pkgJsonPath = resolve(sourceDir, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        if (
          pkg.dependencies?.pino ||
          pkg.devDependencies?.pino
        ) {
          return true;
        }
      } catch {
        // ignore parse errors
      }
    }

    return false;
  }

  // ── Log Format Compliance Check ────────────────────────────────────

  /**
   * Check whether log output files conform to the expected pino JSON format.
   *
   * Scans log files in the workspace and validates that each line
   * is valid JSON containing the expected pino fields.
   */
  private checkLogFormat(sourceDir: string): boolean {
    if (!existsSync(sourceDir)) {
      return false;
    }

    // Collect log files from the workspace
    const logFiles = this.findLogFiles(sourceDir);

    if (logFiles.length === 0) {
      // No log output to validate -- return false to flag a warning
      return false;
    }

    let totalLines = 0;
    let compliantLines = 0;
    const sampleSize = 200; // max lines to inspect

    for (const logFile of logFiles) {
      try {
        const stat = statSync(logFile);
        // Skip empty files
        if (stat.size === 0) {
          continue;
        }

        // Read first portion of the file
        const content = readFileSync(logFile, "utf-8");
        const lines = content.split("\n").filter((l) => l.trim().length > 0);

        for (const line of lines) {
          if (totalLines >= sampleSize) {
            break;
          }
          totalLines++;

          if (this.isValidPinoLine(line)) {
            compliantLines++;
          }
        }

        if (totalLines >= sampleSize) {
          break;
        }
      } catch {
        // skip unreadable files
      }
    }

    if (totalLines === 0) {
      return false;
    }

    // At least 80% of sampled lines should be compliant
    return compliantLines / totalLines >= 0.8;
  }

  /**
   * Validate a single log line against pino JSON format.
   *
   * A valid pino line is JSON with at least "level", "time", and "msg" fields.
   */
  private isValidPinoLine(line: string): boolean {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") {
        return false;
      }

      // Must have the three required pino fields
      for (const field of PINO_REQUIRED_FIELDS) {
        if (!(field in parsed)) {
          return false;
        }
      }

      // "level" must be a number (pino numeric levels) or known string label
      const level = parsed["level"];
      if (typeof level !== "number" && typeof level !== "string") {
        return false;
      }

      // "msg" must be a string
      if (typeof parsed["msg"] !== "string") {
        return false;
      }

      // "time" must be a number (epoch ms) or ISO string
      const time = parsed["time"];
      if (typeof time !== "number" && typeof time !== "string") {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  // ── File Discovery Helpers ─────────────────────────────────────────

  /**
   * Find server source files in the source directory.
   */
  private findSourceFiles(sourceDir: string): string[] {
    const files: string[] = [];

    // Check common server entry points first
    for (const pattern of SERVER_FILE_PATTERNS) {
      const candidate = resolve(sourceDir, pattern);
      if (existsSync(candidate)) {
        files.push(candidate);
      }
    }

    // Also scan for any .ts or .js files that might contain server code
    try {
      const entries = readdirSync(sourceDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isFile() &&
          (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))
        ) {
          const fullPath = resolve(sourceDir, entry.name);
          if (!files.includes(fullPath)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // unreadable
    }

    return files;
  }

  /**
   * Find log files in the source directory.
   */
  private findLogFiles(sourceDir: string): string[] {
    const files: string[] = [];

    try {
      const entries = readdirSync(sourceDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          if (
            lower.endsWith(".log") ||
            lower.endsWith(".jsonl") ||
            lower.endsWith(".ndjson") ||
            lower.endsWith("stdout.log") ||
            lower.endsWith("stderr.log") ||
            lower.endsWith("server.log") ||
            lower.endsWith("app.log") ||
            lower.endsWith("output.log")
          ) {
            files.push(resolve(sourceDir, entry.name));
          }
        }
      }

      // Also check for a dedicated logs/ or log/ directory
      const logDirs = ["logs", "log", "test-results"];
      for (const dirName of logDirs) {
        const logDir = resolve(sourceDir, dirName);
        if (existsSync(logDir)) {
          try {
            const logEntries = readdirSync(logDir, { withFileTypes: true });
            for (const entry of logEntries) {
              if (entry.isFile() && entry.name.toLowerCase().endsWith(".log")) {
                files.push(resolve(logDir, entry.name));
              }
            }
          } catch {
            // skip
          }
        }
      }
    } catch {
      // unreadable
    }

    return [...new Set(files)]; // deduplicate
  }
}
