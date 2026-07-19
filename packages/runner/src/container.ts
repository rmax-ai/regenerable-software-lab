/**
 * @rsl/runner — Docker container launch for isolated agent execution
 *
 * Launches a Docker container with strict isolation:
 *   - Read-only rootfs
 *   - Selected mounts (read-only and writable)
 *   - No network (network_mode: "none")
 *   - All capabilities dropped
 *   - Non-root user
 *   - CPU and memory limits
 */

import { execSync } from "node:child_process";

export interface ContainerConfig {
  /** Docker image to use */
  image: string;
  /** Command to run inside the container */
  cmd?: string[];
  /** Working directory (inside container) */
  workingDir?: string;
  /** Memory limit, e.g. "2g" */
  memory?: string;
  /** CPU limit, e.g. "2" */
  cpus?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
}

export interface ContainerResult {
  /** Container ID */
  containerId: string;
  /** Exit code of the container process */
  exitCode: number;
  /** stdout from the container */
  stdout: string;
  /** stderr from the container */
  stderr: string;
}

/**
 * Build the docker run argument list from the given config.
 */
function buildDockerArgs(config: ContainerConfig): string[] {
  const args: string[] = [
    "docker",
    "run",
    "--rm",               // auto-remove container on exit
    "--detach",           // run in background, return container ID
    "--init",             // use tini for PID 1
    "--read-only",        // read-only root filesystem
    "--user", "1000:1000", // non-root agent user

    // Mounts: read-only protected paths
    "--mount", "type=bind,source=/spec,target=/spec,readonly",
    "--mount", "type=bind,source=/evaluator,target=/evaluator,readonly",
    "--mount", "type=bind,source=/policies,target=/policies,readonly",
    "--mount", "type=bind,source=/hidden,target=/hidden,readonly",
    "--mount", "type=bind,source=/benchmark-config,target=/benchmark-config,readonly",

    // Mounts: writable workspace
    "--mount", "type=bind,source=/workspace,target=/workspace",

    // tmpfs for temp directories
    "--tmpfs", "/tmp:size=100M,noexec,nosuid,nodev",
    "--tmpfs", "/home/agent:size=10M,noexec,nosuid,nodev",

    // Network isolation: no external access
    "--network", "none",

    // Drop all capabilities
    "--cap-drop", "ALL",

    // Security options
    "--security-opt", "no-new-privileges:true",

    // Resource limits
    "--pids-limit", "100",
  ];

  if (config.memory) {
    args.push("--memory", config.memory);
  }

  if (config.cpus) {
    args.push("--cpus", config.cpus);
  }

  if (config.env) {
    for (const [key, value] of Object.entries(config.env)) {
      args.push("--env", `${key}=${value}`);
    }
  }

  if (config.workingDir) {
    args.push("--workdir", config.workingDir);
  }

  // Image
  args.push(config.image);

  // Command
  if (config.cmd && config.cmd.length > 0) {
    args.push(...config.cmd);
  }

  return args;
}

/**
 * Launch a Docker container with full isolation.
 *
 * Mounts:
 *   Read-only: /spec, /evaluator, /policies, /hidden, /benchmark-config
 *   Writable:  /workspace
 *
 * Network: none
 * Capabilities: none (ALL dropped)
 * User: non-root (uid 1000)
 *
 * @returns The container ID.
 */
export function launchContainer(config: ContainerConfig): string {
  const args = buildDockerArgs(config);
  const stdout = execSync(args.join(" "), {
    encoding: "utf-8",
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const containerId = stdout.trim();
  if (!containerId) {
    throw new Error("Failed to launch container: no container ID returned");
  }
  return containerId;
}

/**
 * Wait for a container to finish and return its exit code and output.
 *
 * @param containerId - The Docker container ID.
 * @param timeoutMs - Max time to wait (default 300_000 ms / 5 min).
 */
export function waitContainer(
  containerId: string,
  timeoutMs = 300_000,
): ContainerResult {
  // Wait for the container to exit
  execSync(`docker wait ${containerId}`, {
    encoding: "utf-8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Grab exit code
  const exitCodeStr = execSync(`docker inspect ${containerId} --format '{{.State.ExitCode}}'`, {
    encoding: "utf-8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exitCode = parseInt(exitCodeStr.trim(), 10);

  // Grab logs
  const stdout = execSync(`docker logs ${containerId} 2>/dev/null || true`, {
    encoding: "utf-8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = execSync(`docker logs ${containerId} 2>&1 1>/dev/null || true`, {
    encoding: "utf-8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return { containerId, exitCode, stdout, stderr };
}

/**
 * Stop and remove a container immediately.
 */
export function removeContainer(containerId: string): void {
  execSync(`docker rm --force ${containerId}`, {
    encoding: "utf-8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
