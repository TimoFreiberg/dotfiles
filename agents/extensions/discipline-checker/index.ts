/**
 * Discipline Checker Extension (v0 MVP)
 *
 * On `turn_end`, spawns a fast/cheap child pi process (deepseek-v4-flash)
 * to apply the `verify-action-claims` discipline to the just-finished
 * turn. The child compares the agent's text claims against the actual
 * tool calls + results and reports any mismatches.
 *
 * Fire-and-forget: the main session does NOT wait for the checker. The
 * extension's `turn_end` handler returns immediately; the child runs in
 * the background and writes its finding to the file named by the
 * `DISCIPLINE_CHECKER_FINDINGS_PATH` env var. Without that env var set
 * the extension is inert (logs a warning at load and registers no
 * handler) — there is no default path, by design.
 *
 * Subconscious framing: no UI surfacing in v0. Findings are reviewed
 * out-of-band (e.g., during weaving). Future versions can add Discord
 * pings, severity-gated surfacing, or inline notifications.
 *
 * Project doc:
 *   /Users/thiania/thiania/identity/state/projects/discipline-checker.md
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Required: absolute path the child writes JSONL findings to. No default —
// the extension is inert (warns + registers no handler) if this isn't set,
// so other dotfiles consumers don't get writes to a thiania-specific path.
const FINDINGS_PATH = process.env.DISCIPLINE_CHECKER_FINDINGS_PATH;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DISCIPLINE_PATH = path.join(__dirname, "discipline.md");

const CHECKER_MODEL = "deepseek/deepseek-v4-flash";

// Truncate huge tool results to keep the checker prompt manageable.
// Calibration #1 ran on ~5k input tokens and worked well; production
// turns can have read() outputs of 100k+ chars.
const MAX_TOOL_RESULT_CHARS = 4000;
const MAX_TOTAL_PROMPT_CHARS = 40000;

// ---------------------------------------------------------------------------
// Types (light — only the shape we need from event payloads)
// ---------------------------------------------------------------------------

interface ToolCallPart {
  type: "toolCall";
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface TextPart {
  type: "text";
  text: string;
}

interface ThinkingPart {
  type: "thinking";
  thinking: string;
}

type MessagePart =
  | ToolCallPart
  | TextPart
  | ThinkingPart
  | { type: string; [k: string]: unknown };

interface AssistantMessage {
  role: "assistant";
  content: MessagePart[];
}

interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName?: string;
  content: Array<{ type: string; text?: string } | unknown>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  if (!FINDINGS_PATH) {
    console.warn(
      "[discipline-checker] DISCIPLINE_CHECKER_FINDINGS_PATH not set — " +
        "extension inert. Set it to an absolute path to enable.",
    );
    return;
  }
  pi.on("turn_end", async (event, ctx) => {
    try {
      const message = event.message as AssistantMessage | undefined;

      // Heartbeat: prove the hook fires even when we early-return below.
      // Gated on env so it disappears in normal use.
      if (process.env.DISCIPLINE_CHECKER_DEBUG === "1") {
        const msg = message;
        const partCount = msg?.content?.length ?? 0;
        const trCount =
          (event.toolResults as unknown[] | undefined)?.length ?? 0;
        const entries =
          (ctx.sessionManager?.getEntries?.() as unknown[] | undefined) ?? [];
        let entryRoles: string[] = [];
        try {
          entryRoles = (
            entries as Array<{
              type?: string;
              message?: { role?: string };
            }>
          ).map((e) =>
            e.type === "message"
              ? `msg:${e.message?.role ?? "?"}`
              : `${e.type ?? "?"}`,
          );
        } catch {
          /* shape unknown */
        }
        let windowSummary: Record<string, number> | null = null;
        if (msg && msg.role === "assistant") {
          try {
            const w = collectWindowSinceLastUserMessage(ctx, msg);
            windowSummary = {
              texts: w.texts.length,
              toolCalls: w.toolCalls.length,
              toolResults: w.toolResults.length,
            };
          } catch {
            /* best-effort debug */
          }
        }
        void appendFinding({
          timestamp: new Date().toISOString(),
          sessionId: null,
          sessionFile: null,
          turnIndex: event.turnIndex,
          cwd: ctx?.cwd ?? "",
          checker: CHECKER_MODEL,
          discipline: "verify-action-claims",
          debug: "turn_end-fired",
          messageRole: msg?.role ?? null,
          partCount,
          toolResultCount: trCount,
          entriesCount: entries.length,
          entryRoles,
          windowSummary,
        }).catch(() => {
          /* best-effort */
        });
      }

      if (!message || message.role !== "assistant") return;

      // Trigger: this turn contains text (claim moment). Toolcall-only turns
      // are skipped because there's nothing to verify against the trace yet.
      const currentParts = partitionMessageContent(message.content);
      if (currentParts.texts.length === 0) return;

      // Window: all entries since the last user message (the current
      // claim+action exchange). The model often emits toolcalls and the
      // accompanying claim text in SEPARATE turns, so the current
      // message alone doesn't carry the trace.
      const window = collectWindowSinceLastUserMessage(ctx, message);
      if (window.toolCalls.length === 0) return; // no actions in the window → nothing to verify

      const transcript = formatTranscript(
        window.texts,
        window.toolCalls,
        window.toolResults,
      );
      if (transcript.length > MAX_TOTAL_PROMPT_CHARS) {
        // Skip oversized turns rather than truncate-and-misdiagnose for v0.
        // We can revisit with smarter windowing once we see how often this fires.
        return;
      }

      const sessionFile = ctx.sessionManager?.getSessionFile?.() ?? null;
      const sessionId = sessionFile
        ? path.basename(sessionFile, ".jsonl")
        : null;

      const meta: FindingMeta = {
        timestamp: new Date().toISOString(),
        sessionId,
        sessionFile,
        turnIndex: event.turnIndex,
        cwd: ctx.cwd,
        checker: CHECKER_MODEL,
        discipline: "verify-action-claims",
      };

      if (process.env.DISCIPLINE_CHECKER_DEBUG === "1") {
        void appendFinding({
          ...meta,
          debug: "about-to-spawn-checker",
          transcriptLen: transcript.length,
        }).catch(() => {});
      }

      // Fire-and-forget by default. `DISCIPLINE_CHECKER_SYNC=1` makes the
      // handler await — needed in `-p` mode (parent exits before child
      // closes, so no finding gets written) and useful in tests.
      const checkerPromise = runChecker(transcript, meta).catch(async (err) => {
        // Last-resort logging — write a debug record so silent failures don't disappear.
        await appendFinding({
          ...meta,
          error: err instanceof Error ? err.message : String(err),
          stage: "runChecker",
        }).catch(() => {
          /* truly best-effort */
        });
      });

      if (process.env.DISCIPLINE_CHECKER_SYNC === "1") {
        await checkerPromise;
      } else {
        void checkerPromise;
      }
    } catch (err) {
      // Never let the extension crash the main turn lifecycle.
      void appendFinding({
        timestamp: new Date().toISOString(),
        sessionId: null,
        sessionFile: null,
        turnIndex: event?.turnIndex ?? -1,
        cwd: ctx?.cwd ?? "",
        checker: CHECKER_MODEL,
        discipline: "verify-action-claims",
        error: err instanceof Error ? err.message : String(err),
        stage: "turn_end-handler",
      }).catch(() => {
        /* best-effort */
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Transcript formatting
// ---------------------------------------------------------------------------

function partitionMessageContent(content: MessagePart[]): {
  texts: string[];
  toolCalls: ToolCallPart[];
} {
  const texts: string[] = [];
  const toolCalls: ToolCallPart[] = [];
  for (const part of content) {
    if (part.type === "text" && typeof (part as TextPart).text === "string") {
      const text = (part as TextPart).text.trim();
      if (text) texts.push(text);
    } else if (part.type === "toolCall") {
      toolCalls.push(part as ToolCallPart);
    }
    // Skip thinking parts and anything else — the checker only sees what
    // would be visible to a reviewer of the agent's actions + claims.
  }
  return { texts, toolCalls };
}

interface CheckerWindow {
  texts: string[];
  toolCalls: ToolCallPart[];
  toolResults: ToolResultMessage[];
}

/**
 * Walk the session backwards to find the most recent user message, then
 * forward-collect every assistant text / toolCall / toolResult since.
 *
 * Why: the claim/trace pair that the discipline cares about often spans
 * multiple turns — the model frequently emits a toolcall-only assistant
 * message, then a text-only summary message after the tool result lands.
 * The current `turn_end` event only carries the immediate message, so we
 * pull the wider context from the session manager.
 *
 * The `currentMessage` param is the message from this `turn_end` event;
 * `sessionManager.getEntries()` may not have committed it yet (timing
 * varies), so we include it explicitly.
 */
function collectWindowSinceLastUserMessage(
  ctx: { sessionManager?: { getEntries?: () => unknown[] } },
  currentMessage: AssistantMessage,
): CheckerWindow {
  const window: CheckerWindow = {
    texts: [],
    toolCalls: [],
    toolResults: [],
  };

  const entries =
    (ctx.sessionManager?.getEntries?.() as Array<{
      type?: string;
      message?: {
        role?: string;
        content?: unknown;
        toolCallId?: string;
        toolName?: string;
        isError?: boolean;
      };
    }>) ?? [];

  // Find index of the most recent user message.
  let startIdx = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === "message" && e.message?.role === "user") {
      startIdx = i + 1; // start AFTER the user message
      break;
    }
  }

  // Forward-collect from startIdx to the end of entries.
  let currentMessageSeenInEntries = false;
  for (let i = startIdx; i < entries.length; i++) {
    const e = entries[i];
    if (e.type !== "message" || !e.message) continue;
    const msg = e.message;
    if (msg.role === "assistant") {
      const parts = partitionMessageContent(
        (msg.content as MessagePart[]) ?? [],
      );
      window.texts.push(...parts.texts);
      window.toolCalls.push(...parts.toolCalls);
      // Best-effort detection: is this entry the same message as the one
      // from the event? Compare content shallowly. If we see it, we know
      // we don't need to append it again below.
      if (msg.content === currentMessage.content) {
        currentMessageSeenInEntries = true;
      }
    } else if (msg.role === "toolResult") {
      window.toolResults.push(msg as unknown as ToolResultMessage);
    }
  }

  // Append the current event's message if it wasn't already in entries
  // (timing variance — `turn_end` may fire before the entry is committed).
  if (!currentMessageSeenInEntries) {
    const parts = partitionMessageContent(currentMessage.content);
    window.texts.push(...parts.texts);
    window.toolCalls.push(...parts.toolCalls);
  }

  return window;
}

function formatTranscript(
  texts: string[],
  toolCalls: ToolCallPart[],
  toolResults: ToolResultMessage[],
): string {
  const resultsByCallId = new Map<string, ToolResultMessage>();
  for (const r of toolResults) {
    if (r.toolCallId) resultsByCallId.set(r.toolCallId, r);
  }

  const lines: string[] = [];
  lines.push("# Turn under review");
  lines.push("");
  lines.push("## Agent text (the claims to verify)");
  lines.push("");
  for (const text of texts) {
    lines.push(text);
    lines.push("");
  }

  lines.push("## Tool calls and results (the trace)");
  lines.push("");
  toolCalls.forEach((tc, i) => {
    lines.push(`### [${i + 1}] ${tc.name}`);
    lines.push("");
    lines.push("**Call:**");
    lines.push("```json");
    lines.push(safeJson(tc.arguments));
    lines.push("```");
    lines.push("");
    const result = tc.id ? resultsByCallId.get(tc.id) : undefined;
    if (result) {
      const tag = result.isError ? "Result (ERROR)" : "Result";
      lines.push(`**${tag}:**`);
      lines.push("```");
      lines.push(formatToolResultContent(result));
      lines.push("```");
    } else {
      lines.push("**Result:** (not captured)");
    }
    lines.push("");
  });

  lines.push("## Task");
  lines.push("");
  lines.push(
    "Apply the verify-action-claims discipline (loaded in your system prompt) " +
      "to the agent text above. Compare each action-claim against the tool " +
      "calls and results. Report findings in the exact output format the " +
      "discipline specifies.",
  );
  return lines.join("\n");
}

function safeJson(obj: unknown): string {
  try {
    const s = JSON.stringify(obj, null, 2);
    if (s.length > MAX_TOOL_RESULT_CHARS) {
      return s.slice(0, MAX_TOOL_RESULT_CHARS) + "\n... (truncated)";
    }
    return s;
  } catch {
    return "(unserializable)";
  }
}

function formatToolResultContent(result: ToolResultMessage): string {
  let text: string;
  if (!result.content) {
    text = "(no content)";
  } else if (Array.isArray(result.content)) {
    text = result.content
      .map((part) => {
        if (typeof part === "object" && part !== null && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return safeJson(part);
      })
      .join("\n");
  } else {
    text = String(result.content);
  }
  if (text.length > MAX_TOOL_RESULT_CHARS) {
    return text.slice(0, MAX_TOOL_RESULT_CHARS) + "\n... (truncated)";
  }
  return text;
}

// ---------------------------------------------------------------------------
// Child process spawn (fire-and-forget)
// ---------------------------------------------------------------------------

interface FindingMeta {
  timestamp: string;
  sessionId: string | null;
  sessionFile: string | null;
  turnIndex: number;
  cwd: string;
  checker: string;
  discipline: string;
}

function runChecker(transcript: string, meta: FindingMeta): Promise<void> {
  return new Promise((resolve) => {
    const args = [
      "--mode",
      "json",
      "-p",
      "--no-session",
      // v0: text-only checker, no tool access. A future version could give
      // the checker read/grep to verify world-state claims (e.g., re-read
      // a file the agent claims to have written) instead of inferring from
      // the toolcall trace alone — would catch hidden-failure patterns the
      // trace doesn't surface. Out of scope for v0; latency budget and
      // failure modes both widen.
      "--no-tools",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--model",
      CHECKER_MODEL,
      // Replace pi's default coding-assistant system prompt with the
      // discipline spec — the child is not a coding agent and shouldn't
      // inherit a coding-agent role. `--system-prompt <path>` reads the
      // file the same way `--append-system-prompt` does.
      "--system-prompt",
      DISCIPLINE_PATH,
      transcript,
    ];

    let proc;
    try {
      proc = spawn("pi", args, {
        stdio: ["ignore", "pipe", "pipe"],
        // Detach so the child outlives the parent in -p mode (the parent
        // exits as soon as the turn ends, so without detach the child
        // gets killed before it can write its finding). Don't unref —
        // we still want the parent's await on `runChecker` to actually
        // hold the event loop open until the child closes.
        detached: true,
      });
    } catch (err) {
      void appendFinding({
        ...meta,
        error: err instanceof Error ? err.message : String(err),
        stage: "spawn",
      });
      resolve();
      return;
    }

    let stdout = "";
    let stderr = "";
    const startedAt = Date.now();

    proc.stdout!.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr!.on("data", (d) => {
      stderr += d.toString();
    });

    proc.on("close", async (exitCode) => {
      const durationMs = Date.now() - startedAt;
      try {
        const { reportText, usage, model, stopReason } =
          parseChildOutput(stdout);
        const noViolations = isNoViolationsResponse(reportText);

        await appendFinding({
          ...meta,
          durationMs,
          exitCode: exitCode ?? null,
          stopReason: stopReason ?? null,
          model: model ?? CHECKER_MODEL,
          usage: usage ?? null,
          noViolations,
          report: reportText,
          ...(stderr.trim() ? { stderr: stderr.slice(-2000) } : {}),
        });
      } catch (err) {
        await appendFinding({
          ...meta,
          durationMs,
          exitCode: exitCode ?? null,
          error: err instanceof Error ? err.message : String(err),
          stage: "parseChildOutput",
          rawStdoutTail: stdout.slice(-2000),
          ...(stderr.trim() ? { stderr: stderr.slice(-2000) } : {}),
        }).catch(() => {
          /* best-effort */
        });
      }
      resolve();
    });

    proc.on("error", (err) => {
      void appendFinding({
        ...meta,
        error: err.message,
        stage: "child-error",
      }).catch(() => {
        /* best-effort */
      });
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Child output parsing
// ---------------------------------------------------------------------------

interface ChildUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  totalTokens?: number;
}

function parseChildOutput(stdout: string): {
  reportText: string;
  usage: ChildUsage | null;
  model: string | null;
  stopReason: string | null;
} {
  const lines = stdout.split("\n");
  let reportText = "";
  let usage: ChildUsage | null = null;
  let model: string | null = null;
  let stopReason: string | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      const msg = event.message;
      // Take the LAST assistant message's text — that's the final report.
      const text = (msg.content ?? [])
        .filter((p: any) => p.type === "text")
        .map((p: any) => String(p.text ?? ""))
        .join("\n")
        .trim();
      if (text) reportText = text;
      if (msg.usage) {
        const u = msg.usage;
        usage = {
          input: u.input,
          output: u.output,
          cacheRead: u.cacheRead,
          cacheWrite: u.cacheWrite,
          cost: u.cost?.total,
          totalTokens: u.totalTokens,
        };
      }
      if (msg.model) model = msg.model;
      if (msg.stopReason) stopReason = msg.stopReason;
    }
  }

  return { reportText, usage, model, stopReason };
}

function isNoViolationsResponse(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (/^##\s*No violations found\.?$/im.test(trimmed)) return true;
  // Tolerant fallback for slight rewording.
  if (
    /\bno violations (found|detected)\b/i.test(trimmed) &&
    !/##\s*Violation/i.test(trimmed)
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Finding output (jsonl append, queued for write safety)
// ---------------------------------------------------------------------------

async function appendFinding(record: Record<string, unknown>): Promise<void> {
  // Defensive — the extension entry early-returns when FINDINGS_PATH is
  // unset, so handlers below this point shouldn't reach here. Belt-and-
  // suspenders for any future caller that bypasses the entry guard.
  if (!FINDINGS_PATH) return;
  await withFileMutationQueue(FINDINGS_PATH, async () => {
    await fs.promises.mkdir(path.dirname(FINDINGS_PATH), { recursive: true });
    await fs.promises.appendFile(
      FINDINGS_PATH,
      JSON.stringify(record) + "\n",
      "utf-8",
    );
  });
}
