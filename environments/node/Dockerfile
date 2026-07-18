# ---- Build Stage ----
FROM node:24-slim@sha256:2f4203c87a8340ad9a6a0cd274bde56358d3da2a2426f19d111e278aaf2d3e76 AS build

ARG WORKSPACE=/workspace
WORKDIR ${WORKSPACE}

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency manifests first for layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/

# Install dependencies (frozen lockfile ensures reproducibility)
RUN pnpm install --frozen-lockfile --offline 2>/dev/null || pnpm install --frozen-lockfile

# Build all packages
RUN pnpm build 2>/dev/null || echo "Build step skipped (no build script defined at this level)"

# ---- Runtime Stage ----
FROM node:24-slim@sha256:2f4203c87a8340ad9a6a0cd274bde56358d3da2a2426f19d111e278aaf2d3e76

ARG WORKSPACE=/workspace
ARG AGENT_UID=1000
ARG AGENT_GID=1000

ENV NODE_ENV=production
ENV WORKSPACE=${WORKSPACE}
ENV TMPDIR=/tmp

# Install dumb-init for proper PID 1 signal handling and zombie reaping
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root agent user
RUN groupadd --gid ${AGENT_GID} agent \
    && useradd --uid ${AGENT_UID} --gid agent --shell /bin/bash --create-home agent

# Create writable directories with proper ownership
RUN mkdir -p ${WORKSPACE} /tmp \
    && chown -R agent:agent ${WORKSPACE} /tmp

# Copy entrypoint script
COPY --chown=agent:agent entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Copy application artifacts from build stage
COPY --chown=agent:agent --from=build ${WORKSPACE}/node_modules ${WORKSPACE}/node_modules
COPY --chown=agent:agent --from=build ${WORKSPACE}/packages ${WORKSPACE}/packages
COPY --chown=agent:agent --from=build ${WORKSPACE}/apps ${WORKSPACE}/apps
COPY --chown=agent:agent --from=build ${WORKSPACE}/package.json ${WORKSPACE}/package.json
COPY --chown=agent:agent --from=build ${WORKSPACE}/pnpm-lock.yaml ${WORKSPACE}/pnpm-lock.yaml
COPY --chown=agent:agent --from=build ${WORKSPACE}/pnpm-workspace.yaml ${WORKSPACE}/pnpm-workspace.yaml

# Switch to non-root user
USER agent

# Use WORKSPACE as default working directory
WORKDIR ${WORKSPACE}

# dumb-init handles signal forwarding and zombie reaping
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Default: start with pnpm or fall back to interactive shell
CMD ["sh", "-c", "pnpm start 2>/dev/null || /bin/bash"]
