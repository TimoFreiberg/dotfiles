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
 * - Re-injection requires deferring until `isStreaming=false`. At the
 *   moment `agent_end` fires, the run's `runWithLifecycle` hasn't reached
 *   its `finally` block yet, so `isStreaming` is still true. pi's
 *   `sendCustomMessage` branches on `isStreaming` before `triggerTurn`,
 *   so a direct call silently queues to the follow-up queue instead of
 *   starting a new run. We use `setImmediate` to wait until the next
 *   event-loop tick, after `finishRun()` has flipped `isStreaming=false`.
 *
 * Re-entry guard: when the fix above works, the new run started by the
 * nudge begins with `newMessages = [customMessage, ...]`, so the scan
 * catches `alreadyNudged` on that run's `agent_end` and bails cleanly.
 * A 10-second timestamp cooldown remains as a safety net.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  AgentEndEvent,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

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
// what counts as a fork. Wrapped in <system-reminder> because pi's
// convertToLlm renders custom messages as plain user-role text with no
// metadata, so the XML tag is the only attribution signal. Claude models
// are trained on <system-reminder> as the canonical wrapper for
// automated system notes (Claude Code uses it inside tool_result
// messages for things like offset-past-EOF warnings), so it reads as
// more obviously-not-user-speech than an invented tag would.
const NUDGE_REASON =
  "<system-reminder>" +
  "this turn did work and didn't journal. " +
  "if a fork or correction formed, call the journal skill now." +
  "</system-reminder>";

// Safety-net cooldown in case the `alreadyNudged` scan doesn't catch
// something and we'd otherwise hot-loop.
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
// Helpers: error detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the run ended with an error or user cancellation.
 *
 * An `AssistantMessage` with `stopReason === "error"` or `"aborted"` means
 * the provider returned an error (rate limit, usage limit, etc.) or the user
 * cancelled via Escape. In either case nudging would be noise.
 */
function didEndAbnormally(messages: readonly AgentMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && "stopReason" in msg) {
      const assistant = msg as AssistantMessage;
      return (
        assistant.stopReason === "error" || assistant.stopReason === "aborted"
      );
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  if (!process.env.THIANIA_ROLE) return;

  let lastNudgeAt = 0;

  pi.on("agent_end", async (event) => {
    // Don't nudge when the run ended abnormally — the user already knows
    // something went wrong or they deliberately stopped it.
    if (didEndAbnormally(event.messages)) return;

    const { workCount, didJournal, alreadyNudged } = scanPrompt(event.messages);

    if (alreadyNudged) return; // re-entry after our own nudge
    if (didJournal) return;
    if (workCount < MIN_WORK_COUNT) return;

    const now = Date.now();
    if (now - lastNudgeAt < NUDGE_COOLDOWN_MS) return;
    lastNudgeAt = now;

    // Defer until after `runWithLifecycle`'s `finally` flips
    // `isStreaming = false`. Without this, `sendCustomMessage` takes
    // the streaming branch and silently queues to the follow-up queue
    // instead of starting a new run. See header comment.
    setImmediate(() => {
      pi.sendMessage(
        {
          customType: NUDGE_CUSTOM_TYPE,
          content: NUDGE_REASON,
          display: true,
        },
        { triggerTurn: true },
      );
    });
  });
}
