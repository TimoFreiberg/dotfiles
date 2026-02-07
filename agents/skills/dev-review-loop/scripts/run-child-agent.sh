#!/usr/bin/env bash
set -euo pipefail

# Runs a child pi agent in a tmux pane and signals completion.
#
# Usage: run-child-agent.sh <socket> <session> <output-file> <workdir> [pi-args...]
#
# The script:
#   1. Sends a pi -p command to the tmux pane
#   2. Redirects stdout/stderr to <output-file>
#   3. Touches <output-file>.done when pi exits
#
# The caller should poll for <output-file>.done to know when the agent is finished.

SOCKET="$1"; shift
SESSION="$1"; shift
OUTPUT_FILE="$1"; shift
WORKDIR="$1"; shift
# Remaining args are passed to pi

# Clean up any previous run artifacts
rm -f "$OUTPUT_FILE" "$OUTPUT_FILE.done" "$OUTPUT_FILE.exit"

# Build the pi command with proper quoting
# We write a temporary script to avoid complex quoting in send-keys
RUNNER_SCRIPT="$OUTPUT_FILE.run.sh"
cat > "$RUNNER_SCRIPT" <<'SCRIPT_HEADER'
#!/usr/bin/env bash
set -euo pipefail
OUTPUT_FILE="$1"; shift
WORKDIR="$1"; shift
cd "$WORKDIR"
SCRIPT_HEADER

# Append the pi invocation with all args properly quoted
{
    printf 'pi -p --no-session'
    for arg in "$@"; do
        printf ' %q' "$arg"
    done
    printf ' 2>&1 | tee "%s"\n' "$OUTPUT_FILE"
    printf 'echo ${PIPESTATUS[0]} > "%s.exit"\n' "$OUTPUT_FILE"
    printf 'touch "%s.done"\n' "$OUTPUT_FILE"
} >> "$RUNNER_SCRIPT"

chmod +x "$RUNNER_SCRIPT"

# Send the runner script to the tmux pane
tmux -S "$SOCKET" send-keys -t "$SESSION" -- "bash $(printf '%q' "$RUNNER_SCRIPT") $(printf '%q' "$OUTPUT_FILE") $(printf '%q' "$WORKDIR")" Enter
