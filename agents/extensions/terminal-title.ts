// Sets the terminal title to `{prefix}@{cwd}` with a spinner while the
// agent is running and a done marker after each prompt completes.
//
// - prefix: "thia" when $THIANIA_ROLE is set (any Thia instance), otherwise "pi"
// - cwd: basename of process.cwd() at session_start
// - spinner: 10-frame braille, ~80ms — renders evenly in narrow tab bars
// - done marker: `●` cleared on next agent_start
//
// Writes OSC 0 directly to stdout. Pi's TUI also owns stdout, but terminals
// parse OSC sequences atomically so interleaving is safe in practice. If you
// see render glitches, the write-interleaving is a suspect.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;
const DONE_MARKER = "●";

// OSC 0 sets both icon name and window title; BEL-terminated for broad compat.
function writeTitle(title: string): void {
  process.stdout.write(`\x1b]0;${title}\x07`);
}

export default function (pi: ExtensionAPI) {
  const prefix = process.env.THIANIA_ROLE ? "thia" : "pi";
  const base = path.basename(process.cwd());
  const label = `${prefix}@${base}`;

  let state: "fresh" | "running" | "done" = "fresh";
  let spinnerFrame = 0;
  let spinnerTimer: NodeJS.Timeout | null = null;

  function render(): void {
    switch (state) {
      case "fresh":
        writeTitle(label);
        break;
      case "running":
        writeTitle(`${SPINNER_FRAMES[spinnerFrame]} ${label}`);
        break;
      case "done":
        writeTitle(`${DONE_MARKER} ${label}`);
        break;
    }
  }

  function startSpinner(): void {
    if (spinnerTimer) return;
    spinnerTimer = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
      render();
    }, SPINNER_INTERVAL_MS);
    // Don't let the spinner keep the process alive on its own.
    spinnerTimer.unref();
  }

  function stopSpinner(): void {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  }

  pi.on("session_start", async () => {
    state = "fresh";
    render();
  });

  pi.on("agent_start", async () => {
    state = "running";
    spinnerFrame = 0;
    render();
    startSpinner();
  });

  pi.on("agent_end", async () => {
    stopSpinner();
    state = "done";
    render();
  });

  pi.on("session_shutdown", async () => {
    stopSpinner();
    // Clear title. Most terminals fall back to their default, or the next
    // shell prompt's PROMPT_COMMAND/precmd resets it.
    writeTitle("");
  });
}
