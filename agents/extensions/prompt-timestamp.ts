/**
 * Stamp each user message with the wall-clock time it was sent.
 *
 * Why: the agent has no built-in sense of elapsed time between turns.
 * Seeing per-message timestamps lets it notice when a reply lands hours
 * later vs. seconds later — useful both for adjusting tone after a long
 * gap and for not over-engineering a quick back-and-forth.
 *
 * Uses the `context` event so the user's stored input and visible
 * scrollback stay unchanged — only the deep-copied message payload sent
 * to the LLM gets the prefix. Mirrors the
 * `hookSpecificOutput.additionalContext` behavior of the Claude Code
 * companion at ~/.claude/hooks/user-prompt-timestamp.py.
 *
 * Each `UserMessage` already carries a stable `timestamp: number`
 * (Unix ms) from when it was originally sent, so we stamp from that
 * rather than `new Date()`. This means stamps don't drift across the
 * multiple LLM calls within a single turn, and historical messages
 * carry their original send-time even after compaction or session
 * restore.
 *
 * Auto-discovered from ~/.pi/agent/extensions/.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function formatTimestamp(date: Date): string {
  // UTC only on purpose: avoids per-machine TZ variance (host vs.
  // sandbox vs. whichever machine sources this dotfile). The model
  // knows the user's local TZ from context if it ever needs to convert.
  const iso = date.toISOString().replace(/\.\d{3}Z$/, "Z");
  return `[prompt received ${iso}]`;
}

const STAMP_PREFIX = "[prompt received ";

function alreadyStamped(text: string): boolean {
  return text.startsWith(STAMP_PREFIX);
}

export default function (pi: ExtensionAPI) {
  pi.on("context", async (event, _ctx) => {
    const messages = event.messages.map((m) => {
      const msg = m as { role?: string; content?: unknown; timestamp?: number };
      if (msg.role !== "user") return m;
      // Defensive: skip if the message somehow has no timestamp.
      if (typeof msg.timestamp !== "number") return m;

      const stamp = formatTimestamp(new Date(msg.timestamp));

      if (typeof msg.content === "string") {
        if (alreadyStamped(msg.content)) return m;
        return { ...msg, content: `${stamp}\n${msg.content}` };
      }

      if (Array.isArray(msg.content)) {
        const parts = msg.content as Array<{ type?: string; text?: string }>;
        const first = parts[0];
        if (
          first &&
          first.type === "text" &&
          typeof first.text === "string" &&
          alreadyStamped(first.text)
        ) {
          return m;
        }
        return {
          ...msg,
          content: [{ type: "text", text: stamp }, ...parts],
        };
      }

      return m;
    });
    return { messages: messages as typeof event.messages };
  });
}
