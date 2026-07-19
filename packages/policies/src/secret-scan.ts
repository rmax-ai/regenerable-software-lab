// @rsl/policies — Secret scanner for API keys, tokens, and credentials
// Scans workspace files for secrets, redacts them from logs, and records violations.

import {
  type FailureCategory,
} from "@rsl/benchmark-core";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────

export interface SecretViolation {
  filePath: string;
  lineNumber: number;
  patternName: string;
  category: FailureCategory;
  detail: string;
  severity: "error" | "warning";
  redacted: boolean;
}

export interface SecretScanResult {
  passed: boolean;
  violations: SecretViolation[];
  filesScanned: number;
}

export interface SecretScannerOptions {
  /** Glob patterns to exclude from scanning (default: node_modules, .git, dist). */
  excludePatterns: string[];
  /** Maximum file size in bytes to scan (default: 1MB). */
  maxFileSize: number;
}

// ── Default Patterns ─────────────────────────────────────────────────────

interface SecretPattern {
  name: string;
  regex: RegExp;
  severity: "error" | "warning";
}

const DEFAULT_PATTERNS: SecretPattern[] = [
  // OpenAI / Anthropic API keys
  { name: "OpenAI API Key", regex: /sk-[A-Za-z0-9]{20,}/, severity: "error" },
  { name: "Anthropic API Key", regex: /sk-ant-[A-Za-z0-9]{20,}/, severity: "error" },
  // GitHub tokens (personal, OAuth, app, refresh)
  { name: "GitHub Token", regex: /gh[pousr]_[A-Za-z0-9_]{10,}/, severity: "error" },
  // Google API keys
  { name: "Google API Key", regex: /AIza[0-9A-Za-z_-]{35}/, severity: "error" },
  // AWS access keys
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/, severity: "error" },
  // Slack tokens
  { name: "Slack Bot Token", regex: /xox[baprs]-[0-9A-Za-z-]{10,}/, severity: "error" },
  // Generic bearer tokens in Authorization headers
  { name: "Bearer Token", regex: /Bearer\s+[A-Za-z0-9._~+/-]{20,}/, severity: "warning" },
  // Generic password/secret assignment
  { name: "Generic Secret", regex: /(?:password|secret|api[_-]?key|token)\s*[:=]\s*['"][A-Za-z0-9_!@#$%^&*()=+]{8,}['"]/i, severity: "warning" },
  // JWT tokens (base64url-encoded with dots)
  { name: "JWT Token", regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, severity: "warning" },
];

// ── Redaction ────────────────────────────────────────────────────────────

/**
 * Redact all matched secrets from a line of text, replacing them with a
 * safe placeholder.
 */
export function redactSecrets(line: string, patterns: SecretPattern[] = DEFAULT_PATTERNS): string {
  let redacted = line;
  for (const pattern of patterns) {
    redacted = redacted.replace(pattern.regex, (match) => {
      if (match.length <= 8) return "***";
      return match.slice(0, 4) + "****" + match.slice(-4);
    });
  }
  return redacted;
}

// ── Scanner ──────────────────────────────────────────────────────────────

const DEFAULT_EXCLUDE_PATTERNS = [
  "node_modules",
  ".git",
  "dist",
  ".next",
  "coverage",
  "*.log",
];

const DEFAULT_MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB

export class SecretScanner {
  private patterns: SecretPattern[];
  private options: SecretScannerOptions;

  constructor(
    patterns?: SecretPattern[],
    options?: Partial<SecretScannerOptions>,
  ) {
    this.patterns = patterns ?? DEFAULT_PATTERNS;
    this.options = {
      excludePatterns: options?.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS,
      maxFileSize: options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
    };
  }

  /**
   * Scan a workspace directory for secrets and return violations.
   */
  scanWorkspace(workspacePath: string): SecretScanResult {
    const violations: SecretViolation[] = [];
    const filesScanned = this.walkDirectory(workspacePath, workspacePath, violations);
    return {
      passed: violations.length === 0,
      violations,
      filesScanned,
    };
  }

  /**
   * Scan a single file for secrets.
   */
  scanFile(filePath: string): SecretViolation[] {
    const violations: SecretViolation[] = [];
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const pattern of this.patterns) {
        const match = line.match(pattern.regex);
        if (match) {
          violations.push({
            filePath,
            lineNumber: i + 1,
            patternName: pattern.name,
            category: "SECRET_EXPOSURE",
            detail: `Potential secret found: ${pattern.name} at line ${i + 1}`,
            severity: pattern.severity,
            redacted: true,
          });
        }
      }
    }

    return violations;
  }

  /**
   * Redact all secrets from a given file content, returning safe text.
   */
  redactContent(raw: string): string {
    return raw
      .split("\n")
      .map((line) => redactSecrets(line, this.patterns))
      .join("\n");
  }

  // ── Private ────────────────────────────────────────────────────────────

  private shouldExclude(relativePath: string): boolean {
    for (const pattern of this.options.excludePatterns) {
      if (pattern.includes("*")) {
        // Simple glob — match file extension
        const ext = pattern.replace("*", "");
        if (relativePath.endsWith(ext)) return true;
      } else if (relativePath.startsWith(pattern) || relativePath.includes(`/${pattern}/`)) {
        return true;
      }
    }
    return false;
  }

  private walkDirectory(
    root: string,
    current: string,
    violations: SecretViolation[],
  ): number {
    let filesScanned = 0;
    let entries: string[];

    try {
      entries = readdirSync(current);
    } catch {
      return 0;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry);
      const relPath = relative(root, fullPath);

      if (this.shouldExclude(relPath)) continue;

      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        filesScanned += this.walkDirectory(root, fullPath, violations);
      } else if (stats.isFile() && stats.size <= this.options.maxFileSize) {
        // Only scan text-like files (common extensions)
        if (this.isTextFile(entry)) {
          filesScanned++;
          const fileViolations = this.scanFile(fullPath);
          violations.push(...fileViolations);
        }
      }
    }

    return filesScanned;
  }

  private isTextFile(filename: string): boolean {
    const binaryExtensions = new Set([
      ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg",
      ".woff", ".woff2", ".ttf", ".eot",
      ".zip", ".gz", ".tar", ".7z", ".rar",
      ".pdf", ".doc", ".docx", ".xls", ".xlsx",
      ".mp3", ".mp4", ".avi", ".mov",
      ".wasm", ".o", ".obj", ".pyc",
      ".ttf", ".otf",
    ]);
    const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    return !binaryExtensions.has(ext);
  }
}
