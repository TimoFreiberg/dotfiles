/**
 * Discipline Checker Extension
 *
 * On `turn_end`, runs a fast/cheap LLM in-process (via `complete()` from
 * `@earendil-works/pi-ai`) to apply the `verify-action-claims` discipline
 * to the just-finished turn. The checker compares the agent's text
 * claims against the actual tool calls + results.
 *
 * If the checker reports violations, the extension injects a
 * `<discipline-checker>...</discipline-checker>`-wrapped message into the
 * session via `pi.sendMessage`. The next turn's LLM context includes it,
 * so the main agent sees the nudge and can self-correct. The TUI also
 * renders the message inline (purple custom-message box) so the human
 * user sees that a check fired.
 *
 * No-violations turns are silent — no notification, no entry, no log.
 * The whole point is to free up the main task; "all clear" every turn
 * is anti-noise.
 *
 * Setup problems (model unavailable, auth missing, malformed config)
 * surface via `ctx.ui.notify` at error level and the extension goes
 * inert for the session — until the resolved model spec changes (e.g.
 * the user edits the config file), which resets inert and retries.
 *
 * The handler `await`s the checker call. With one in-process LLM call
 * and an `AbortSignal.timeout`, there's no parent-vs-child lifecycle
 * dance — the await holds whether we're in TUI or `pi -p` mode.
 *
 * Configuration
 * -------------
 * Config file: ~/.config/pi/agent/discipline-checker.json (gitignored).
 * Re-read every turn — edit the file, the next turn picks it up. No
 * pi/shell restart needed.
 *
 * Shape (all keys optional):
 *   {
 *     "model": "provider/modelId",   // e.g. "deepseek/deepseek-v4-flash"
 *     "debug": false                 // log heartbeat lines to stderr
 *   }
 *
 * Env vars are respected as a per-key fallback when the config file
 * doesn't set the corresponding value:
 *   DISCIPLINE_CHECKER_MODEL    → config.model
 *   DISCIPLINE_CHECKER_DEBUG=1  → config.debug
 *
 * No default model. If neither config nor env provides one, the
 * extension goes inert with a notification.
 */

import { complete } from "@earendil-works/pi-ai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG_PATH = path.join(
  process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
  "pi",
  "agent",
  "discipline-checker.json",
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DISCIPLINE_PATH = path.join(__dirname, "discipline.md");
// Read once at module load; the spec is static and small.
const DISCIPLINE_SPEC = fs.readFileSync(DISCIPLINE_PATH, "utf-8");

// Truncate huge tool results to keep the checker prompt manageable.
// Calibration #1 ran on ~5k input tokens and worked well; production
// turns can have read() outputs of 100k+ chars.
const MAX_TOOL_RESULT_CHARS = 4000;
const MAX_TOTAL_PROMPT_CHARS = 40000;

// Hard ceiling for the checker call. PR description observed 11.7s and
// 2.9s in the wild on deepseek-v4-flash; 60s is a generous timeout that
// still bounds the worst case.
const CHECKER_TIMEOUT_MS = 60_000;

interface ResolvedConfig {
  /** "provider/modelId" or null if nothing is configured. */
  modelSpec: string | null;
  debug: boolean;
  /** Set if the config file exists but couldn't be read/parsed. */
  configError: string | null;
}

/**
 * Read ~/.config/pi/agent/discipline-checker.json fresh every call.
 * File missing is fine — fall through to env vars / null. Malformed JSON
 * or unreadable file surfaces as `configError` so the caller can notify
 * and go inert.
 */
function resolveConfig(): ResolvedConfig {
  let fileModel: string | undefined;
  let fileDebug: boolean | undefined;
  let configError: string | null = null;

  try {
    const text = fs.readFileSync(CONFIG_PATH, "utf-8");
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.model === "string") fileModel = parsed.model;
      if (typeof parsed.debug === "boolean") fileDebug = parsed.debug;
    } catch (e) {
      configError = `malformed JSON in ${CONFIG_PATH}: ${e instanceof Error ? e.message : String(e)}`;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      configError = `cannot read ${CONFIG_PATH}: ${e instanceof Error ? e.message : String(e)}`;
    }
    // ENOENT: file doesn't exist — fall through to env / null.
  }

  const envModel = process.env.DISCIPLINE_CHECKER_MODEL;
  const envDebug = process.env.DISCIPLINE_CHECKER_DEBUG === "1";

  return {
    modelSpec: fileModel ?? envModel ?? null,
    debug: fileDebug ?? envDebug,
    configError,
  };
}

function parseModelSpec(
  spec: string,
): { provider: string; modelId: string } | null {
  const slash = spec.indexOf("/");
  if (slash < 1 || slash === spec.length - 1) return null;
  return { provider: spec.slice(0, slash), modelId: spec.slice(slash + 1) };
}

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
  // True after a fatal setup problem (model unavailable, auth missing,
  // checker call always erroring). Reset to false when the resolved model
  // spec changes — e.g. the user edits the config file to fix things.
  let inert = false;
  // Tracks the last `cfg.modelSpec` we observed. Comparing across turns
  // lets us detect a config edit and retry the extension.
  let lastResolvedModelSpec: string | null = null;

  pi.on("turn_end", async (event, ctx) => {
    const cfg = resolveConfig();

    // Config-driven inert reset: if the model spec changed since last
    // turn, give the extension another chance.
    if (cfg.modelSpec !== lastResolvedModelSpec) {
      lastResolvedModelSpec = cfg.modelSpec;
      inert = false;
    }

    if (inert) return;

    if (cfg.configError) {
      notifyUser(
        ctx,
        `discipline-checker: ${cfg.configError}. Fix the file (or remove it) ` +
          `and the next turn will retry. Inert for now.`,
        "error",
      );
      inert = true;
      return;
    }

    if (!cfg.modelSpec) {
      notifyUser(
        ctx,
        `discipline-checker: no model configured. Set "model" in ${CONFIG_PATH} ` +
          `(e.g. {"model": "deepseek/deepseek-v4-flash"}) or DISCIPLINE_CHECKER_MODEL ` +
          `env var. Inert.`,
        "error",
      );
      inert = true;
      return;
    }

    if (cfg.debug) {
      const partCount =
        (event.message as { content?: unknown[] } | undefined)?.content
          ?.length ?? 0;
      console.error(
        `[discipline-checker] turn ${event.turnIndex} fired ` +
          `(model=${cfg.modelSpec}, partCount=${partCount})`,
      );
    }
    try {
      const message = event.message as AssistantMessage | undefined;
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
        // Skip oversized turns rather than truncate-and-misdiagnose.
        if (cfg.debug) {
          console.error(
            `[discipline-checker] turn ${event.turnIndex} skipped ` +
              `(transcript ${transcript.length} > ${MAX_TOTAL_PROMPT_CHARS} chars)`,
          );
        }
        return;
      }

      const modelSpec = parseModelSpec(cfg.modelSpec);
      if (!modelSpec) {
        notifyUser(
          ctx,
          `discipline-checker: invalid model spec "${cfg.modelSpec}" ` +
            `(expected "provider/modelId"). Inert.`,
          "error",
        );
        inert = true;
        return;
      }

      // Resolve model + auth lazily on first turn that needs them. Failure
      // here is a setup problem we want the user to see, not a silent skip.
      const model = ctx.modelRegistry.find(
        modelSpec.provider,
        modelSpec.modelId,
      );
      if (!model) {
        notifyUser(
          ctx,
          `discipline-checker: model "${cfg.modelSpec}" not found in registry. ` +
            `Set "model" in ${CONFIG_PATH} to a configured model and the next ` +
            `turn will retry. Inert for now.`,
          "error",
        );
        inert = true;
        return;
      }
      if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
        notifyUser(
          ctx,
          `discipline-checker: provider "${modelSpec.provider}" has no ` +
            `configured auth on this machine. Inert.`,
          "error",
        );
        inert = true;
        return;
      }
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        notifyUser(
          ctx,
          `discipline-checker: auth for "${cfg.modelSpec}" unavailable: ${auth.error}. Inert.`,
          "error",
        );
        inert = true;
        return;
      }

      if (cfg.debug) {
        console.error(
          `[discipline-checker] turn ${event.turnIndex} calling checker ` +
            `(transcript=${transcript.length} chars)`,
        );
      }

      const startedAt = Date.now();
      try {
        const result = await complete(
          model,
          {
            systemPrompt: DISCIPLINE_SPEC,
            messages: [
              {
                role: "user",
                content: transcript,
                timestamp: Date.now(),
              },
            ],
          },
          {
            apiKey: auth.apiKey,
            headers: auth.headers,
            signal: AbortSignal.timeout(CHECKER_TIMEOUT_MS),
          },
        );
        const durationMs = Date.now() - startedAt;
        const reportText = extractAssistantText(result);
        const stopReason = result.stopReason ?? null;
        const errorMessage = (result as { errorMessage?: string }).errorMessage;
        const isError = stopReason === "error" || stopReason === "aborted";

        if (isError) {
          notifyUser(
            ctx,
            `discipline-checker: checker call failed: ${errorMessage ?? "unknown"}. Inert.`,
            "error",
          );
          inert = true;
          return;
        }

        if (cfg.debug) {
          const usageStr = result.usage ? JSON.stringify(result.usage) : "-";
          console.error(
            `[discipline-checker] turn ${event.turnIndex} done ` +
              `(${durationMs}ms, stopReason=${stopReason}, usage=${usageStr})`,
          );
        }

        if (isNoViolationsResponse(reportText) || !reportText) {
          // Silent on "all clear" — no notification, no entry. The whole
          // point of this extension is to free up the main task; "no
          // violations" every turn would be noise.
          return;
        }

        // Inject the violation report into the session. The agent sees it
        // in next-turn context (so it can self-correct or acknowledge);
        // the TUI renders it inline as a custom message so the user can
        // see that a check fired. The <discipline-checker> wrapper makes
        // the side-channel nature unambiguous to the next-turn LLM.
        const wrapped = `<discipline-checker>\n${reportText}\n</discipline-checker>`;
        pi.sendMessage({
          customType: "discipline-checker",
          content: wrapped,
          display: true,
        });
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        if (cfg.debug) {
          console.error(
            `[discipline-checker] turn ${event.turnIndex} failed ` +
              `after ${durationMs}ms: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      // Never let the extension crash the main turn lifecycle.
      if (cfg.debug) {
        console.error(
          `[discipline-checker] turn ${event.turnIndex} handler error: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
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
 * Reading the agent-session.js flow, `message_end` (which calls
 * `appendMessage`) fires before `turn_end`, so by the time we run here
 * the current message should already be in `getEntries()`. The
 * dedup-by-content-identity + fallback append is defensive against a
 * future change to that ordering invariant.
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

function safeSlice(s: string, n: number): string {
  if (s.length <= n) return s;
  let cut = s.slice(0, n);
  // Avoid splitting a UTF-16 surrogate pair: if we ended on a high
  // surrogate (D800-DBFF), drop it so the slice ends on a complete code point.
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut + "\n... (truncated)";
}

function safeJson(obj: unknown): string {
  try {
    return safeSlice(JSON.stringify(obj, null, 2), MAX_TOOL_RESULT_CHARS);
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
  return safeSlice(text, MAX_TOOL_RESULT_CHARS);
}

// ---------------------------------------------------------------------------
// Checker output + helpers
// ---------------------------------------------------------------------------

/** Pull the text content out of a complete()-returned AssistantMessage. */
function extractAssistantText(msg: {
  content?: Array<{ type?: string; text?: unknown }>;
}): string {
  return (msg.content ?? [])
    .filter((p) => p.type === "text")
    .map((p) => String(p.text ?? ""))
    .join("\n")
    .trim();
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

function notifyUser(
  ctx: ExtensionContext,
  message: string,
  level: "info" | "warning" | "error",
): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
  } else {
    // Print mode (`pi -p`): no UI, fall back to stderr so the user still sees it.
    console.error(`[discipline-checker] ${message}`);
  }
}
