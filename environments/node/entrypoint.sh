#!/bin/bash
#
# entrypoint.sh — Regenerable Software Lab container entrypoint
#
# Responsibilities:
#   1. Source any setup/init scripts present in the container
#   2. Execute the command passed as arguments
#   3. Signal forwarding is handled by dumb-init (PID 1)
#
# Usage:
#   docker run <image> [command...]
#   docker run <image> node dist/index.js
#   docker run <image> /bin/bash
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Source setup scripts
# ---------------------------------------------------------------------------
# If a setup directory exists, source all .sh scripts in sorted order.
SETUP_DIR="/setup"
if [ -d "${SETUP_DIR}" ]; then
  for script in $(find "${SETUP_DIR}" -maxdepth 1 -name '*.sh' -type f | sort); do
    # shellcheck disable=SC1090
    . "${script}"
  done
fi

# Source workspace-level init if present
WORKSPACE_INIT="${WORKSPACE:-/workspace}/.container-init.sh"
if [ -f "${WORKSPACE_INIT}" ]; then
  # shellcheck disable=SC1090
  . "${WORKSPACE_INIT}"
fi

# ---------------------------------------------------------------------------
# Environment validation
# ---------------------------------------------------------------------------
# Warn if running as root (should not happen in production)
if [ "$(id -u)" = "0" ]; then
  echo "[WARNING] Container running as root. Expected uid 1000 (agent)." >&2
fi

# ---------------------------------------------------------------------------
# Execute the command
# ---------------------------------------------------------------------------
# If no arguments are provided, default to an interactive shell
if [ $# -eq 0 ]; then
  echo "[INFO] No command provided. Starting interactive shell." >&2
  exec /bin/bash
fi

# Execute the passed command
exec "$@"
