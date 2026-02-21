#!/bin/sh
set -e

REPO="TimoFreiberg/tdo"
BIN_DIR="${HOME}/.local/bin"
BIN="${BIN_DIR}/tdo"
STAMP="${BIN_DIR}/.tdo-checked"
MAX_AGE=86400  # 1 day in seconds

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"
case "${OS}" in
    Darwin)
        case "${ARCH}" in
            arm64|aarch64) ASSET="tdo-macos-arm64" ;;
            *) echo "Unsupported macOS architecture: ${ARCH}" >&2; exit 1 ;;
        esac
        ;;
    Linux)
        case "${ARCH}" in
            x86_64|amd64) ASSET="tdo-linux-x86_64" ;;
            *) echo "Unsupported Linux architecture: ${ARCH}" >&2; exit 1 ;;
        esac
        ;;
    *)
        echo "Unsupported OS: ${OS}" >&2; exit 1 ;;
esac

download() {
    mkdir -p "${BIN_DIR}"
    echo "Downloading tdo..." >&2
    if command -v gh >/dev/null 2>&1; then
        gh release download --repo "${REPO}" --pattern "${ASSET}" --output "${BIN}" --clobber
    else
        curl -fsSL -o "${BIN}" "https://github.com/${REPO}/releases/latest/download/${ASSET}"
    fi
    chmod +x "${BIN}"
    touch "${STAMP}"
    echo "Installed tdo to ${BIN}" >&2
}

needs_update_check() {
    [ ! -f "${STAMP}" ] && return 0
    if [ "$(uname -s)" = "Darwin" ]; then
        stamp_time=$(stat -f %m "${STAMP}")
    else
        stamp_time=$(stat -c %Y "${STAMP}")
    fi
    now=$(date +%s)
    age=$((now - stamp_time))
    [ "${age}" -ge "${MAX_AGE}" ]
}

check_for_update() {
    if command -v gh >/dev/null 2>&1; then
        remote_tag=$(gh release view --repo "${REPO}" --json tagName -q .tagName 2>/dev/null) || return
    else
        remote_tag=$(curl -fsSL -o /dev/null -w '%{redirect_url}' "https://github.com/${REPO}/releases/latest" 2>/dev/null \
            | sed 's|.*/tag/||') || return
    fi
    local_tag=""
    if [ -f "${BIN}" ]; then
        local_tag=$("${BIN}" --version 2>/dev/null | awk '{print "v"$NF}') || true
    fi
    touch "${STAMP}"
    if [ -n "${remote_tag}" ] && [ "${remote_tag}" != "${local_tag}" ]; then
        echo "Updating tdo (${local_tag:-unknown} -> ${remote_tag})..." >&2
        download
    fi
}

# First run: download if missing
if [ ! -f "${BIN}" ]; then
    download
fi

# Background update check if stamp is stale
if needs_update_check; then
    check_for_update &
fi

exec "${BIN}" "$@"
