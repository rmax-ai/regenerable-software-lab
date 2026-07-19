# ---- Runtime Node image for isolated agent execution ----
FROM node:24-slim

ARG AGENT_UID=1000

ENV NODE_ENV=production
ENV WORKSPACE=/workspace
ENV TMPDIR=/tmp

# Install dumb-init for proper PID 1 signal forwarding and zombie reaping
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Create non-root agent user (uid 1000, no password)
RUN groupadd --gid ${AGENT_UID} agent \
    && useradd --uid ${AGENT_UID} --gid agent --shell /bin/bash --create-home agent \
    && passwd -d agent

# Set up /workspace (writable) and /spec (read-only mount point)
RUN mkdir -p /workspace /spec \
    && chown -R agent:agent /workspace

# Copy entrypoint script
COPY --chown=agent:agent entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Switch to non-root user
USER agent

WORKDIR /workspace

# dumb-init handles signal forwarding and zombie reaping
ENTRYPOINT ["dumb-init", "--"]

# Default command: start the application via pnpm
CMD ["pnpm", "start"]
