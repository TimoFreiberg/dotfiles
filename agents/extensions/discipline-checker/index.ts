/**
 * Discipline Checker Extension (v0 MVP)
 *
 * On `turn_end`, runs a fast/cheap LLM in-process (via `complete()` from
 * `@earendil-works/pi-ai`) to apply the `verify-action-claims` discipline
 * to the just-finished turn. The checker compares the agent's text
 * claims against the actual tool calls + results and writes any
 * findings to a JSONL file.
 *
 * The handler `await`s the checker call. With one in-process LLM call
 * and an `AbortSignal.timeout`, there's no parent-vs-child lifecycle
 * dance — the await holds whether we're in TUI or `pi -p` mode.
 *
 * Subconscious framing: no UI surfacing in v0 for findings themselves.
 * Findings are reviewed out-of-band (e.g., during weaving). Setup
 * problems (model unavailable, auth missing) DO surface via
 * `ctx.ui.notify` so a misconfigured extension doesn't silently rot.
 *
 * Configuration (all env vars, all optional):
 *   DISCIPLINE_CHECKER_MODEL          provider/modelId; default
 *                                     deepseek/deepseek-v4-flash. Set
 *                                     to e.g. bedrock/anthropic.claude-3-5-haiku
 *                                     on machines without deepseek auth.
 *   DISCIPLINE_CHECKER_FINDINGS_PATH  absolute path for JSONL findings;
 *                                     default os.tmpdir()/pi-discipline-
 *                                     findings-<sessionId>.jsonl.
 *   DISCIPLINE_CHECKER_DEBUG=1        write a heartbeat record on every
 *                                     turn_end fire (off by default).
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
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_MODEL_SPEC = "deepseek/deepseek-v4-flash";
const MODEL_SPEC = process.env.DISCIPLINE_CHECKER_MODEL ?? DEFAULT_MODEL_SPEC;
const FINDINGS_PATH_OVERRIDE = process.env.DISCIPLINE_CHECKER_FINDINGS_PATH;

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
  const modelSpec = parseModelSpec(MODEL_SPEC);
  if (!modelSpec) {
    console.warn(
      `[discipline-checker] Invalid DISCIPLINE_CHECKER_MODEL=${MODEL_SPEC} ` +
        `(expected "provider/modelId") — extension inert.`,
    );
    return;
  }

  // Resolved on first turn (we need ctx for the session id default) and
  // cached for the rest of the session.
  let findingsPath: string | null = null;
  // Once we determine the configured model+auth doesn't work, stop trying
  // every turn. Notify the user the first time it happens; stay quiet after.
  let inert = false;

  pi.on("turn_end", async (event, ctx) => {
    if (inert) return;
    if (!findingsPath) {
      findingsPath = resolveFindingsPath(ctx);
      console.log(`[discipline-checker] findings → ${findingsPath}`);
    }
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
        void appendFinding(findingsPath, {
          timestamp: new Date().toISOString(),
          sessionId: null,
          sessionFile: null,
          turnIndex: event.turnIndex,
          cwd: ctx.cwd,
          checker: MODEL_SPEC,
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
        checker: MODEL_SPEC,
        discipline: "verify-action-claims",
      };

      if (transcript.length > MAX_TOTAL_PROMPT_CHARS) {
        // Don't ship a 40k+ char prompt at the checker; truncating it
        // could misdiagnose. Record the skip so the audit trail is
        // honest about what we did and didn't check.
        await appendFinding(findingsPath, {
          ...meta,
          stage: "skipped",
          reason: "oversized",
          transcriptLen: transcript.length,
          maxPromptChars: MAX_TOTAL_PROMPT_CHARS,
        }).catch(() => {});
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
          `discipline-checker: model "${MODEL_SPEC}" not found in registry. ` +
            `Set DISCIPLINE_CHECKER_MODEL to a configured model (e.g. ` +
            `amazon-bedrock/global.anthropic.claude-haiku-4-5, ` +
            `google/gemini-2.5-flash) or unset to use the ` +
            `default (${DEFAULT_MODEL_SPEC}). Extension inert for the rest of this session.`,
          "error",
        );
        await appendFinding(findingsPath, {
          ...meta,
          stage: "model-unavailable",
          requestedModel: MODEL_SPEC,
        }).catch(() => {});
        inert = true;
        return;
      }
      if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
        notifyUser(
          ctx,
          `discipline-checker: provider "${modelSpec.provider}" has no ` +
            `configured auth on this machine. Set DISCIPLINE_CHECKER_MODEL ` +
            `to a model whose provider is configured (run \`pi\` and check ` +
            `available models). Extension inert for the rest of this session.`,
          "error",
        );
        await appendFinding(findingsPath, {
          ...meta,
          stage: "auth-not-configured",
          requestedModel: MODEL_SPEC,
        }).catch(() => {});
        inert = true;
        return;
      }
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        notifyUser(
          ctx,
          `discipline-checker: auth for "${MODEL_SPEC}" unavailable: ${auth.error}. ` +
            `Extension inert for the rest of this session.`,
          "error",
        );
        await appendFinding(findingsPath, {
          ...meta,
          stage: "auth-unavailable",
          requestedModel: MODEL_SPEC,
          authError: auth.error,
        }).catch(() => {});
        inert = true;
        return;
      }

      if (process.env.DISCIPLINE_CHECKER_DEBUG === "1") {
        void appendFinding(findingsPath, {
          ...meta,
          debug: "about-to-call-checker",
          transcriptLen: transcript.length,
        }).catch(() => {});
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
            `discipline-checker: checker call failed: ${errorMessage ?? "unknown"}. ` +
              `Extension inert for the rest of this session.`,
            "error",
          );
          inert = true;
        }
        const noViolations = !isError && isNoViolationsResponse(reportText);
        await appendFinding(findingsPath, {
          ...meta,
          durationMs,
          stopReason,
          model: result.responseModel ?? result.model ?? MODEL_SPEC,
          usage: result.usage ?? null,
          ...(isError
            ? {
                stage: "complete-error",
                error: errorMessage ?? "unknown",
              }
            : {
                noViolations,
                report: reportText,
              }),
        });
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        await appendFinding(findingsPath, {
          ...meta,
          durationMs,
          error: err instanceof Error ? err.message : String(err),
          stage: "complete",
        }).catch(() => {});
      }
    } catch (err) {
      // Never let the extension crash the main turn lifecycle.
      const fp = findingsPath ?? FINDINGS_PATH_OVERRIDE ?? null;
      if (fp) {
        void appendFinding(fp, {
          timestamp: new Date().toISOString(),
          sessionId: null,
          sessionFile: null,
          turnIndex: event.turnIndex,
          cwd: ctx.cwd,
          checker: MODEL_SPEC,
          discipline: "verify-action-claims",
          error: err instanceof Error ? err.message : String(err),
          stage: "turn_end-handler",
        }).catch(() => {
          /* best-effort */
        });
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
// ---------------------------------------------------------------------------
// Checker output + helpers
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

function resolveFindingsPath(ctx: ExtensionContext): string {
  if (FINDINGS_PATH_OVERRIDE) return FINDINGS_PATH_OVERRIDE;
  // Per-session default file under tmpdir so concurrent sessions don't
  // compete for one file. Findings persist for the OS's tmp lifetime.
  const sid = ctx.sessionManager?.getSessionId?.() ?? "unknown";
  return path.join(os.tmpdir(), `pi-discipline-findings-${sid}.jsonl`);
}

// ---------------------------------------------------------------------------
// Finding output (jsonl append, queued for write safety)
// ---------------------------------------------------------------------------

async function appendFinding(
  findingsPath: string,
  record: Record<string, unknown>,
): Promise<void> {
  await withFileMutationQueue(findingsPath, async () => {
    await fs.promises.mkdir(path.dirname(findingsPath), { recursive: true });
    await fs.promises.appendFile(
      findingsPath,
      JSON.stringify(record) + "\n",
      "utf-8",
    );
  });
}
