#!/bin/bash
#
# entrypoint.sh — Regenerable Software Lab node-runner entrypoint
#
# 1. Installs dependencies from lockfile (offline, frozen)
# 2. Executes the passed command
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Install project dependencies (offline + frozen lockfile for reproducibility)
# ---------------------------------------------------------------------------
if [ -f "pnpm-lock.yaml" ] || [ -f "package.json" ]; then
  echo "[entrypoint] Installing dependencies (offline, frozen lockfile)..."
  pnpm install --offline --frozen-lockfile 2>/dev/null || \
    echo "[entrypoint] Warning: offline install failed, continuing anyway."
fi

# ---------------------------------------------------------------------------
# Execute the command
# ---------------------------------------------------------------------------
if [ $# -eq 0 ]; then
  echo "[entrypoint] No command provided. Starting interactive shell."
  exec /bin/bash
fi

exec "$@"
