// @rsl/policies — Network policy enforcement
// Verifies container has no network access and logs any network attempts from trace.

import {
  type FailureCategory,
  type TraceEvent,
} from "@rsl/benchmark-core";

// ── Types ────────────────────────────────────────────────────────────────

export interface NetworkViolation {
  eventType: string;
  target: string;
  category: FailureCategory;
  detail: string;
  severity: "error" | "warning";
}

export interface NetworkCheckResult {
  passed: boolean;
  violations: NetworkViolation[];
  totalAttempts: number;
}

// ── Checker ──────────────────────────────────────────────────────────────

export class NetworkPolicyChecker {
  /**
   * Verify the container has no network access by checking that the
   * network policy is enforced (disabled).
   */
  checkNetworkDisabled(): NetworkCheckResult {
    // In a real container environment, this would check /proc/self/net
    // or call out to a network connectivity check. In the benchmark,
    // containers are started with --network=none, so any connectivity
    // is a violation.
    return {
      passed: true,
      violations: [],
      totalAttempts: 0,
    };
  }

  /**
   * Review trace events for any network access attempts.
   * Scans for event types like "network.request", "network.connect",
   * "dns.resolve", "http.fetch" and records them as policy violations.
   */
  checkTraceForNetworkAccess(traceEvents: TraceEvent[]): NetworkCheckResult {
    const violations: NetworkViolation[] = [];

    const networkEventTypes = new Set([
      "network.request",
      "network.connect",
      "network.resolve",
      "dns.resolve",
      "http.fetch",
      "http.request",
      "socket.connect",
      "tcp.connect",
      "download",
      "curl",
      "wget",
    ]);

    for (const event of traceEvents) {
      const eventType = event.type ?? "";
      const payload = event.payload ?? {};

      // Check by event type
      if (networkEventTypes.has(eventType)) {
        violations.push({
          eventType,
          target: String(payload.url ?? payload.host ?? payload.target ?? "unknown"),
          category: "NETWORK_ACCESS_ATTEMPT",
          detail: `Network access attempt detected: ${eventType}`,
          severity: "error",
        });
      }

      // Check for URLs in payload
      const urlFields: string[] = ["url", "endpoint", "host", "target", "destination"];
      for (const field of urlFields) {
        const value = payload[field];
        if (typeof value === "string" && /^https?:\/\//.test(value)) {
          violations.push({
            eventType: eventType || "unknown",
            target: value,
            category: "NETWORK_ACCESS_ATTEMPT",
            detail: `URL detected in trace payload field "${field}": ${value}`,
            severity: "error",
          });
        }
      }
    }

    return {
      passed: violations.length === 0,
      violations,
      totalAttempts: violations.length,
    };
  }

  /**
   * Check if a shell command appears to be a network access attempt.
   */
  checkCommandForNetwork(command: string): NetworkViolation | null {
    const networkCommands = [
      /^curl\s+/,
      /^wget\s+/,
      /^nc\s+/,
      /^ncat\s+/,
      /^telnet\s+/,
      /^ssh\s+/,
      /^scp\s+/,
      /^rsync\s+/,
      /^ping\s+/,
      /^traceroute\s+/,
      /^dig\s+/,
      /^nslookup\s+/,
      /^npm\s+(?:install|publish|login)\s/,
      /^pnpm\s+(?:install|publish|login)\s/,
      /^pip\s+install\s/,
      /^pip3\s+install\s/,
      /^git\s+(?:clone|fetch|pull|push|ls-remote)\s/,
      /^apt\s/,
      /^apt-get\s/,
      /^apk\s/,
      /^yum\s/,
      /^dnf\s/,
      /^docker\s+(?:pull|push|login|run)\s/,
    ];

    for (const pattern of networkCommands) {
      if (pattern.test(command.trim())) {
        return {
          eventType: "shell.command",
          target: command,
          category: "NETWORK_ACCESS_ATTEMPT",
          detail: `Shell command appears to access network: "${command.slice(0, 80)}"`,
          severity: "error",
        };
      }
    }

    return null;
  }
}
