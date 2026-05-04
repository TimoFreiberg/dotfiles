/**
 * Journal Nudge Extension
 *
 * On `agent_end` (pi's parallel to Claude Code's Stop hook), nudge the
 * agent to journal if the completed prompt did real work and never called
 * the journal skill.
 *
 * Port of ~/.claude/hooks/journal-nudge.py adapted to pi's event model.
 * Key differences from the Claude version:
 * - pi exposes AgentMessage[] directly via `event.messages`, so no
 *   transcript-JSONL parsing.
 * - pi built-in tool names are lowercase (`bash`, `edit`, `write`).
 * - pi skills are prompt expansions, not tool calls, so the only signal
 *   that journaling happened is a `bash` call running the journal script.
 * - Re-injection uses `pi.sendMessage` with `triggerTurn: true`; the
 *   re-entry guard checks for our customType in the current prompt's
 *   messages, plus a module-level timestamp belt-and-suspenders.
 *
 * Design:
 * - Fires on `agent_end`. `event.messages` is the conversation slice for
 *   this prompt (one user message plus whatever the agent produced).
 * - Counts "work" tool uses: `edit`, `write`, plus `bash` commands that
 *   match side-effect-y substrings. Recon bash (ls, jj log, git status,
 *   gh pr view, grep, etc.) is ignored — over-counting inflates the nudge.
 * - Detects journaling: any `bash` command whose string contains
 *   `skills/journal/scripts/journal`.
 * - If `work >= MIN_WORK_COUNT` and `!didJournal`, injects a custom
 *   message with `triggerTurn: true` so the agent gets one more inference
 *   pass with the nudge visible.
 * - Re-entry guard: if any message in the current prompt is already our
 *   custom type, bail. Plus a 10s timestamp cooldown as a safety net.
 */

import type {
  AgentEndEvent,
  ExtensionAPI,
} from "@mariozechner/pi-coding-agent";

// AgentMessage isn't re-exported from the package root, but we can pull its
// shape off AgentEndEvent.messages without relying on the internal export.
type AgentMessage = AgentEndEvent["messages"][number];

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const NUDGE_CUSTOM_TYPE = "journal-nudge";

// Tool names considered "real work" without further inspection. `bash` is
// handled separately (see BASH_WORK_MARKERS). Pure `read`/`grep`/`glob`
// don't count.
const WORK_TOOLS = new Set(["edit", "write"]);

// Minimum "work" tool-use count in a prompt before the nudge fires. Single
// actions (one edit, one commit) are usually execution of something already
// decided; judgment-formation turns accumulate several actions.
const MIN_WORK_COUNT = 3;

// Bash commands count as work only if they look side-effect-y. Matched as
// substrings — false positives are cheap, false negatives just skip a nudge.
const BASH_WORK_MARKERS: readonly string[] = [
  "jj commit",
  "jj squash",
  "jj rebase",
  "jj new",
  "jj abandon",
  "jj bookmark",
  "jj describe",
  "jj split",
  "jj duplicate",
  "jj push",
  "git commit",
  "git push",
  "git rebase",
  "git merge",
  "git reset",
  "git checkout",
  "git add",
  "git rm",
  "git mv",
  "gh pr create",
  "gh pr edit",
  "gh pr merge",
  "gh pr comment",
  "gh pr close",
  "gh issue create",
  "gh issue comment",
  "gh issue close",
  " > ",
  " >> ",
  "mv ",
  "rm ",
  "mkdir ",
  "cp ",
  "touch ",
  "chmod ",
  "ln ",
  "sed -i",
  "tee ",
];

// Substrings that mean the prompt directly invoked the journal CLI.
// Clears the nudge AND doesn't count as "work" (journaling is cleanup,
// not fresh judgment-formation).
const JOURNAL_BASH_MARKERS: readonly string[] = [
  "skills/journal/scripts/journal",
];

// Content of the injected nudge. Kept short — the agent has internalized
// what counts as a fork.
const NUDGE_REASON =
  "this turn did work and didn't journal. " +
  "if a fork or correction formed, call the journal skill now.";

// Safety-net cooldown to avoid tight loops if event.messages unexpectedly
// doesn't include our injected custom message.
const NUDGE_COOLDOWN_MS = 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ScanResult {
  workCount: number;
  didJournal: boolean;
  alreadyNudged: boolean;
}

function scanPrompt(messages: readonly AgentMessage[]): ScanResult {
  let workCount = 0;
  let didJournal = false;
  let alreadyNudged = false;

  for (const msg of messages) {
    if (msg.role === "custom" && msg.customType === NUDGE_CUSTOM_TYPE) {
      alreadyNudged = true;
      continue;
    }

    if (msg.role !== "assistant") continue;
    if (!Array.isArray(msg.content)) continue;

    for (const block of msg.content) {
      if (!block || typeof block !== "object") continue;
      if ((block as { type?: string }).type !== "toolCall") continue;

      const call = block as {
        type: "toolCall";
        name: string;
        arguments?: Record<string, unknown>;
      };
      const name = call.name;
      const args = call.arguments ?? {};

      if (name === "bash") {
        const cmd = typeof args.command === "string" ? args.command : "";
        if (JOURNAL_BASH_MARKERS.some((m) => cmd.includes(m))) {
          didJournal = true;
        } else if (BASH_WORK_MARKERS.some((m) => cmd.includes(m))) {
          workCount += 1;
        }
        // Recon bash (ls, jj log, git status, grep, etc.) is ignored.
      } else if (WORK_TOOLS.has(name)) {
        workCount += 1;
      }
      // Other tools (read, glob, grep, skill, etc.) are ignored.
    }
  }

  return { workCount, didJournal, alreadyNudged };
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  let lastNudgeAt = 0;

  pi.on("agent_end", async (event) => {
    const { workCount, didJournal, alreadyNudged } = scanPrompt(event.messages);

    if (alreadyNudged) return; // re-entry after our own nudge
    if (didJournal) return;
    if (workCount < MIN_WORK_COUNT) return;

    // Cooldown safety-net: if something went sideways with the
    // alreadyNudged detection, at least don't hot-loop.
    const now = Date.now();
    if (now - lastNudgeAt < NUDGE_COOLDOWN_MS) return;
    lastNudgeAt = now;

    pi.sendMessage(
      {
        customType: NUDGE_CUSTOM_TYPE,
        content: NUDGE_REASON,
        display: true,
      },
      { triggerTurn: true, deliverAs: "followUp" },
    );
  });
}
