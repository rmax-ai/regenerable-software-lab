// @rsl/policies — Dependency allowlist policy checker
// Placeholder for Profile C implementation

export interface DependencyPolicy {
  allowed: string[];
  blocked: string[];
}

export function checkDependencyPolicy(
  dependencies: Record<string, string>,
  policy: DependencyPolicy
): { passed: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const [name] of Object.entries(dependencies)) {
    if (policy.blocked.includes("*") && !policy.allowed.includes(name)) {
      violations.push(`Dependency "${name}" is not in the allowlist`);
    }
  }
  return { passed: violations.length === 0, violations };
}
