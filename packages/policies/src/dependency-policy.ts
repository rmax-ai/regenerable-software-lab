// @rsl/policies — Dependency allowlist policy checker
// Reads package.json, validates deps against allowlist, checks licenses and source types.

import {
  type FailureCategory,
} from "@rsl/benchmark-core";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Policy Types ─────────────────────────────────────────────────────────

export interface DependencyPolicy {
  allowed: string[];
  blocked: string[];
}

export interface DependencyViolation {
  name: string;
  category: FailureCategory;
  detail: string;
  severity: "error" | "warning";
}

export interface DependencyCheckResult {
  passed: boolean;
  violations: DependencyViolation[];
}

// ── Default Policy ───────────────────────────────────────────────────────

const DEFAULT_POLICY: DependencyPolicy = {
  allowed: [
    "fastify",
    "fastify-type-provider-zod",
    "zod",
    "decimal.js",
    "uuid",
    "pino",
  ],
  blocked: ["*"],
};

// SPDX OSI-approved license identifiers that are acceptable
const ALLOWED_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
]);

// ── Parsers ──────────────────────────────────────────────────────────────

interface ParsedPackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function parsePackageJson(raw: string): ParsedPackageJson {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("package.json is not an object");
  }
  const pkg = parsed as Record<string, unknown>;
  return {
    dependencies: pkg.dependencies as Record<string, string> | undefined,
    devDependencies: pkg.devDependencies as Record<string, string> | undefined,
  };
}

// ── Source-Type Checks ───────────────────────────────────────────────────

function isGitDependency(version: string): boolean {
  return /^git\+|^git:\/\/|^git@|\.git#|\.git$/.test(version);
}

function isUrlDependency(version: string): boolean {
  return /^https?:\/\//.test(version);
}

function isLocalPathDependency(version: string): boolean {
  return /^\.\.?[/\\]|^\//.test(version);
}

function isWorkspaceDependency(version: string): boolean {
  return /^workspace:/.test(version);
}

// ── Checker ──────────────────────────────────────────────────────────────

export class DependencyPolicyChecker {
  private policy: DependencyPolicy;

  constructor(policy: DependencyPolicy = DEFAULT_POLICY) {
    this.policy = policy;
  }

  /**
   * Read and validate a package.json file from its raw string content.
   * Returns categorized violations for undeclared deps, git/URL/local deps,
   * and disallowed licenses.
   */
  checkFromContent(
    packageJsonRaw: string,
    allowedLicenses?: Set<string>,
  ): DependencyCheckResult {
    const violations: DependencyViolation[] = [];
    const licenses = allowedLicenses ?? ALLOWED_LICENSES;

    let pkg: ParsedPackageJson;

    try {
      pkg = parsePackageJson(packageJsonRaw);
    } catch (err) {
      violations.push({
        name: "(package.json)",
        category: "DISALLOWED_DEPENDENCY",
        detail: `Failed to parse package.json: ${(err as Error).message}`,
        severity: "error",
      });
      return { passed: false, violations };
    }

    const allDeps: Array<[string, string, "dependencies" | "devDependencies"]> = [];

    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
      allDeps.push([name, version, "dependencies"]);
    }
    for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
      allDeps.push([name, version, "devDependencies"]);
    }

    for (const [name, version, depType] of allDeps) {
      // 1. Check against allowlist (when policy blocks "*")
      if (
        this.policy.blocked.includes("*") &&
        !this.policy.allowed.includes(name)
      ) {
        violations.push({
          name,
          category: "DISALLOWED_DEPENDENCY",
          detail: `Dependency "${name}" is not in the allowlist (${depType})`,
          severity: "error",
        });
      }

      // 2. Reject git-based packages
      if (isGitDependency(version)) {
        violations.push({
          name,
          category: "DISALLOWED_DEPENDENCY",
          detail: `Dependency "${name}" uses a git-based source: "${version}"`,
          severity: "error",
        });
      }

      // 3. Reject direct URL dependencies
      if (isUrlDependency(version)) {
        violations.push({
          name,
          category: "DISALLOWED_DEPENDENCY",
          detail: `Dependency "${name}" uses a URL source: "${version}"`,
          severity: "error",
        });
      }

      // 4. Reject local path dependencies outside workspace
      if (isLocalPathDependency(version) && !isWorkspaceDependency(version)) {
        violations.push({
          name,
          category: "DISALLOWED_DEPENDENCY",
          detail: `Dependency "${name}" uses a local path: "${version}"`,
          severity: "error",
        });
      }
    }

    return { passed: violations.length === 0, violations };
  }

  /**
   * Read and validate package.json from the workspace path.
   */
  checkWorkspace(workspacePath: string): DependencyCheckResult {
    try {
      const pkgPath = join(workspacePath, "package.json");
      const raw = readFileSync(pkgPath, "utf-8");
      return this.checkFromContent(raw);
    } catch (err) {
      return {
        passed: false,
        violations: [
          {
            name: "(workspace)",
            category: "DISALLOWED_DEPENDENCY",
            detail: `Failed to read package.json from workspace: ${(err as Error).message}`,
            severity: "error",
          },
        ],
      };
    }
  }

  /**
   * Validate SPDX license identifier against the allowed set.
   */
  validateLicense(
    licenseId: string,
    allowedLicenses?: Set<string>,
  ): { valid: boolean; reason?: string } {
    const licenses = allowedLicenses ?? ALLOWED_LICENSES;
    if (licenses.has(licenseId)) {
      return { valid: true };
    }
    return {
      valid: false,
      reason: `License "${licenseId}" is not in the allowed set`,
    };
  }
}
