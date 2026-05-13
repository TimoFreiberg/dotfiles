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
FROM ubuntu:rolling

# --- System dependencies ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    file \
    git \
    unzip \
    fd-find ripgrep \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22.x (required by pi — a Node.js app)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && echo "=== node ===" \
    && node --version && npm --version

# Install pi globally via npm (runs as root so it lands in /usr/lib/node_modules)
RUN npm install -g @earendil-works/pi-coding-agent \
    && echo "=== pi ===" \
    && which pi && pi --help >/dev/null && echo "=== pi works ==="

# Create the pi user that will own all installed tools and run the container.
# Fixed UID means host file ownership won't match — the trade-off for
# having a consistent, predictable user environment inside the container.
RUN useradd -m -s /bin/bash pi

# Everything from here runs as pi, so tools install into /home/pi/*
USER pi

# --- Rust (via rustup) ---
# No ENV overrides — defaults to $HOME/.rustup and $HOME/.cargo (/home/pi/.*)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --no-modify-path \
    && echo "=== rust/cargo ===" \
    && . "$HOME/.cargo/env" \
    && which cargo && cargo --version

# Put cargo on PATH for subsequent layers
ENV PATH="/home/pi/.cargo/bin:$PATH"

# cargo-binstall
RUN curl -L --proto '=https' --tlsv1.2 -sSf \
    https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh \
    | bash \
    && echo "=== cargo-binstall ===" \
    && which cargo-binstall

# jj
RUN cargo binstall --strategies crate-meta-data jj-cli \
    && echo "=== jj ===" \
    && which jj && jj --version

# --- Bun ---
RUN curl -fsSL https://bun.com/install | bash \
    && echo "=== bun ===" \
    && export PATH="$HOME/.bun/bin:$PATH" \
    && which bun && bun --version \
    && echo "bun global bin: $(bun pm bin)"

# --- uv (Python package manager) ---
# No ENV override — defaults to $HOME/.local/bin/uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && echo "=== uv ===" \
    && "$HOME/.local/bin/uv" --version

# --- Final: verify all tools on PATH ---
RUN echo "=== runtime PATH check (simulating container entry) ===" \
    && PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/home/pi/.cargo/bin:/home/pi/.bun/bin:/home/pi/.local/bin" \
       HOME=/home/pi \
    && for tool in cargo jj bun uv pi rustc; do \
        if command -v "$tool" &>/dev/null; then \
            echo "  ✅ $tool: $(command -v $tool)"; \
        else \
            echo "  ❌ $tool: NOT on PATH"; \
        fi; \
    done

# --- Make tools accessible to any runtime UID ---
# The container runs as HOST_UID:HOST_GID (pi-docker -u), not as the pi
# user that owns these installs. Make the home dir writable for caches
# and the tool dirs world-readable/executable.
USER root
RUN chmod -R 777 /home/pi/

# These ENVs are inherited by any user — the runtime user (host UID)
# inherits the right PATH and HOME even though they aren't the pi user.
ENV PATH="/home/pi/.cargo/bin:/home/pi/.bun/bin:/home/pi/.local/bin:$PATH" \
    HOME=/home/pi

# --- Entrypoint for config setup ---
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]

# Default user (overridden at runtime by pi-docker -u HOST_UID:HOST_GID)
USER pi
WORKDIR /workspace
