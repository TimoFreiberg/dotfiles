#!/usr/bin/env bash
set -euo pipefail

# Polls for a .done marker file with timeout.
# Usage: wait-for-done.sh <output-file> [timeout-seconds]
#
# Exits 0 when <output-file>.done appears, 1 on timeout.

OUTPUT_FILE="$1"
TIMEOUT="${2:-600}"
INTERVAL=3

deadline=$(($(date +%s) + TIMEOUT))

while true; do
    if [[ -f "$OUTPUT_FILE.done" ]]; then
        exit_code=0
        [[ -f "$OUTPUT_FILE.exit" ]] && exit_code=$(cat "$OUTPUT_FILE.exit")
        echo "Agent finished with exit code $exit_code"
        exit 0
    fi

    now=$(date +%s)
    if (( now >= deadline )); then
        echo "Timed out after ${TIMEOUT}s waiting for agent to finish" >&2
        exit 1
    fi

    # Print a progress indicator: file size so far
    if [[ -f "$OUTPUT_FILE" ]]; then
        size=$(wc -c < "$OUTPUT_FILE" 2>/dev/null || echo 0)
        echo "Still running... output so far: ${size} bytes"
    fi

    sleep "$INTERVAL"
done
