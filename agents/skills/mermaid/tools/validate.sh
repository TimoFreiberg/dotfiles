#!/bin/bash
# Validate a Mermaid diagram by parsing it (no browser needed).
# Usage: validate.sh diagram.mmd

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ $# -lt 1 ]; then
    echo "Usage: $0 diagram.mmd"
    exit 1
fi

INPUT="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"

if [ ! -f "$INPUT" ]; then
    echo "Error: File not found: $INPUT"
    exit 1
fi

# Auto-install mermaid on first run
if [ ! -d "$SCRIPT_DIR/node_modules/mermaid" ]; then
    echo "Installing mermaid (first run only, no Chromium)..."
    (cd "$SCRIPT_DIR" && npm install --silent 2>&1)
fi

echo "Validating: $1"

# Parse using mermaid's own parser — catches syntax errors without Chromium.
if node "$SCRIPT_DIR/parse.mjs" "$INPUT"; then
    echo ""
    echo "ASCII preview:"
    if ! MERMAID_INPUT="$INPUT" npx -y --package beautiful-mermaid node -e '
const fs = require("node:fs");
const path = require("node:path");
const binPath = process.env.PATH.split(":")[0];
const moduleRoot = path.dirname(binPath);
const { renderMermaidAscii } = require(path.join(moduleRoot, "beautiful-mermaid"));
const text = fs.readFileSync(process.env.MERMAID_INPUT, "utf8");
process.stdout.write(renderMermaidAscii(text));
process.stdout.write("\n");
'; then
        echo "(ASCII preview not available for this diagram type)"
    fi
else
    exit 1
fi
