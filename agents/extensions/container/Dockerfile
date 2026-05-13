# pi-container: image for running pi (coding agent) inside Docker
#
# Two use cases share this image:
#   1. Tool shimming  — agent runs on host, tools delegate into container
#      (via the container extension, CMD: sleep infinity)
#   2. Full container — agent and tools both run inside the container
#      (via the pi-docker wrapper, CMD: pi)
#
# Build: docker build -t pi-container .
#
# Based on Node.js 22 (Debian bookworm-slim) — pi requires Node >= 20.6

FROM node:22-bookworm-slim

# --- System dependencies ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    file \
    git \
    unzip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Make the node user's home world-writable so the container works with
# arbitrary --user UID:GID (host UID passthrough). Tools like git, npm,
# and cargo need a writable HOME for caches and config.
RUN mkdir -p /home/node && chmod 777 /home/node

# --- Bun ---
# Install via npm (already available from the Node base image) rather than
# the curl|bash installer, which keeps breaking on argument parsing changes.
RUN npm install -g bun

# --- uv (Python package manager) ---
ENV UV_INSTALL=/usr/local/uv \
    PATH=/usr/local/uv:$PATH
RUN curl -LsSf https://astral.sh/uv/install.sh \
    | sh -s -- -y

# --- pi (coding agent harness) ---
RUN npm install -g @earendil-works/pi-coding-agent

# --- Rust (via rustup) ---
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --no-modify-path


# --- Entrypoint for config setup ---
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]

WORKDIR /workspace
