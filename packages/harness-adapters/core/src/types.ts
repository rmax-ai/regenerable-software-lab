// @rsl/harness-core — Additional harness types

export interface HarnessCapability {
  name: string;
  supported: boolean;
}

export function getDefaultCapabilities(): HarnessCapability[] {
  return [
    { name: "file_write", supported: true },
    { name: "shell_exec", supported: true },
    { name: "network_access", supported: false },
  ];
}
