/**
 * Turn Diagnostics Extension
 *
 * Captures agent turns that END WITHOUT A PROPER RESPONSE — the symptom where
 * the turn stops after a tool call and the model never produces a final answer,
 * while pi itself stays alive and responsive.
 *
 * It is a passive OBSERVER: it subscribes to lifecycle events, returns nothing
 * from every handler (so it can never modify messages, tool results, or provider
 * payloads), and writes an incident report ONLY when a turn ends abnormally.
 * Healthy turns leave no trace, so the log only ever contains real incidents.
 *
 * ── What it detects ────────────────────────────────────────────────────────
 * A turn loop, simplified, is:  assistant(toolUse) → run tool → tool result →
 * send result back to model → repeat … → assistant(stop). A healthy turn ends
 * with the last message being an assistant message whose stopReason is "stop".
 *
 *   PREMATURE_STOP_AFTER_TOOL  agent_end fired, but the last message is a
 *                              toolResult. The loop quit instead of sending the
 *                              result back to the model.
 *                              → `lastTool.terminate === true`: a tool requested
 *                                termination (see lastTool.name — expected only
 *                                for structured_output / answer style tools).
 *                              → `lastTool.terminate === false`: the loop ended
 *                                with no tool asking it to — a pi-core bug.
 *
 *   PREMATURE_STOP_TOOLUSE     agent_end fired with the last assistant message
 *                              still at stopReason "toolUse" and no tool result.
 *
 *   STALL                      No events at all for PI_TURN_STALL_MS while a run
 *                              was active — the loop is hung (process alive). The
 *                              `trace` tail + `lastEventType` + `toolsInFlight`
 *                              localize it: stuck before the next request
 *                              (last event = tool_execution_end / turn_end),
 *                              waiting on the response body (last event =
 *                              before_provider_request / after_provider_response),
 *                              or inside a long-running tool (toolsInFlight set).
 *
 * ── Output ─────────────────────────────────────────────────────────────────
 * One JSON line per incident appended to:
 *   ~/.pi/agent/turn-incidents.jsonl   (override: $PI_TURN_INCIDENT_FILE)
 * A warning notification points at the file each time one is captured. Nothing
 * is ever written to stdout/stderr (that would corrupt the TUI).
 *
 * ── Tuning ─────────────────────────────────────────────────────────────────
 *   PI_TURN_STALL_MS       stall threshold in ms (default 180000; 0 disables the
 *                          watchdog). Keep it well above the model's worst-case
 *                          time-to-first-token so long thinking doesn't false-trip.
 *   PI_TURN_INCIDENT_FILE  absolute path for the incident log.
 *
 * Portable: the only pi import is a type (erased at load), so the same file works
 * under pi-tui and under an embedded SDK session (e.g. pilot) — drop it in the
 * extensions dir, or load it via createAgentSession's extension config.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const STALL_MS = Number(process.env.PI_TURN_STALL_MS ?? 180_000);
// Lives in the agent dir next to sessions/, auth.json, etc. — NOT inside
// sessions/, so it is never mistaken for a session file. (Hardcodes ~/.pi per
// request; getAgentDir() would be the rebrand-safe alternative.)
const INCIDENT_FILE =
  process.env.PI_TURN_INCIDENT_FILE ??
  join(homedir(), ".pi", "agent", "turn-incidents.jsonl");
const MAX_TRACE = 1000; // bound memory on pathological runs

type TraceEntry = { t: number; type: string; [k: string]: unknown };
type LastTool = { name?: string; isError?: boolean; terminate?: boolean };

export default function (pi: ExtensionAPI) {
  let runActive = false;
  let runStart = 0;
  let trace: TraceEntry[] = [];
  let lastTool: LastTool | undefined;
  let toolsInFlight = new Set<string>();
  let lastEventType = "";
  let lastEventAt = 0;
  let reported = false; // one incident per run
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let lastCtx: any;

  const now = () => Date.now();

  const clearWatchdog = () => {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = undefined;
    }
  };

  const armWatchdog = () => {
    clearWatchdog();
    if (STALL_MS <= 0 || !runActive) return;
    watchdog = setTimeout(onStall, STALL_MS);
    // Don't let our timer keep the process alive on its own.
    watchdog.unref?.();
  };

  // Note any event: refreshes the stall clock; structural events also append to
  // the trace. High-frequency stream/update events refresh the clock but are not
  // appended (they would bury the trace in token-by-token noise).
  const note = (
    type: string,
    fields?: Record<string, unknown>,
    append = true,
  ) => {
    lastEventType = type;
    lastEventAt = now();
    if (runActive) {
      if (append && trace.length < MAX_TRACE) {
        trace.push({ t: lastEventAt - runStart, type, ...(fields ?? {}) });
      }
      armWatchdog();
    }
  };

  const ctxInfo = (ctx: any) => ({
    sessionFile: ctx?.sessionManager?.getSessionFile?.() ?? null,
    cwd: ctx?.cwd ?? null,
    model: ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
  });

  const preview = (text: unknown): string | undefined =>
    typeof text === "string"
      ? text.replace(/\s+/g, " ").slice(0, 160)
      : undefined;

  const summarizeMessages = (messages: any[], n = 6) =>
    (messages ?? []).slice(-n).map((m) => {
      const content = Array.isArray(m?.content) ? m.content : [];
      const toolCalls = content
        .filter((c: any) => c?.type === "toolCall")
        .map((c: any) => c?.name);
      const firstText = content.find((c: any) => c?.type === "text")?.text;
      return {
        role: m?.role,
        stopReason: m?.stopReason,
        toolName: m?.toolName,
        isError: m?.isError,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        text: preview(typeof m?.content === "string" ? m.content : firstText),
      };
    });

  // Best-effort current conversation tail from the session, for stalls (where
  // agent_end never delivers a messages array).
  const tailFromSession = (ctx: any) => {
    try {
      const branch = ctx?.sessionManager?.getBranch?.() ?? [];
      const msgs = branch
        .filter((e: any) => e?.type === "message" && e?.message)
        .map((e: any) => e.message);
      return summarizeMessages(msgs);
    } catch {
      return undefined;
    }
  };

  const dump = (
    kind: string,
    extra: Record<string, unknown>,
    ctx: any,
    tail: unknown,
  ) => {
    if (reported) return;
    reported = true;
    const rec = {
      time: new Date().toISOString(),
      kind,
      ...ctxInfo(ctx),
      runMs: runStart ? now() - runStart : null,
      lastEventType,
      msSinceLastEvent: lastEventAt ? now() - lastEventAt : null,
      lastTool: lastTool ?? null,
      toolsInFlight: [...toolsInFlight],
      ...extra,
      tail,
      trace,
    };
    try {
      mkdirSync(dirname(INCIDENT_FILE), { recursive: true });
      appendFileSync(INCIDENT_FILE, `${JSON.stringify(rec)}\n`);
    } catch {
      // Swallow: a diagnostic must never break the agent.
    }
    try {
      ctx?.ui?.notify?.(
        `⚠ turn ${kind} captured → ${INCIDENT_FILE}`,
        "warning",
      );
    } catch {
      // notify is a no-op outside TUI/RPC; ignore.
    }
  };

  function onStall() {
    if (!runActive || reported) return;
    dump("STALL", { stallMs: STALL_MS }, lastCtx, tailFromSession(lastCtx));
    // Leave runActive set: a late agent_end can still arrive; `reported` blocks
    // a duplicate report either way.
  }

  const beginRun = (ctx: any) => {
    runActive = true;
    runStart = now();
    trace = [];
    lastTool = undefined;
    toolsInFlight = new Set();
    reported = false;
    lastCtx = ctx;
    note("agent_start");
  };

  // ── Subscriptions (all handlers return void — never modify the run) ────────
  pi.on("agent_start", (_e, ctx) => beginRun(ctx));

  pi.on("turn_start", (e: any, ctx) => {
    lastCtx = ctx;
    note("turn_start", { turnIndex: e?.turnIndex });
  });

  pi.on("context", (_e, ctx) => {
    lastCtx = ctx;
    note("context");
  });

  pi.on("before_provider_request", (_e, ctx) => {
    lastCtx = ctx;
    note("before_provider_request");
  });

  pi.on("after_provider_response", (e: any, ctx) => {
    lastCtx = ctx;
    note("after_provider_response", { status: e?.status });
  });

  pi.on("message_start", (e: any, ctx) => {
    lastCtx = ctx;
    note("message_start", {
      role: e?.message?.role,
      stopReason: e?.message?.stopReason,
    });
  });

  // Token stream: refresh the stall clock, but don't append (avoids noise).
  pi.on("message_update", (_e, ctx) => {
    lastCtx = ctx;
    note("message_update", undefined, false);
  });

  pi.on("message_end", (e: any, ctx) => {
    lastCtx = ctx;
    note("message_end", {
      role: e?.message?.role,
      stopReason: e?.message?.stopReason,
      toolName: e?.message?.toolName,
      isError: e?.message?.isError,
    });
  });

  pi.on("tool_execution_start", (e: any, ctx) => {
    lastCtx = ctx;
    if (e?.toolCallId) toolsInFlight.add(e.toolCallId);
    note("tool_execution_start", {
      toolName: e?.toolName,
      toolCallId: e?.toolCallId,
    });
  });

  pi.on("tool_execution_update", (_e, ctx) => {
    lastCtx = ctx;
    note("tool_execution_update", undefined, false);
  });

  pi.on("tool_execution_end", (e: any, ctx) => {
    lastCtx = ctx;
    if (e?.toolCallId) toolsInFlight.delete(e.toolCallId);
    const terminate = Boolean(e?.result?.terminate);
    lastTool = { name: e?.toolName, isError: e?.isError, terminate };
    note("tool_execution_end", {
      toolName: e?.toolName,
      isError: e?.isError,
      terminate,
    });
  });

  pi.on("turn_end", (e: any, ctx) => {
    lastCtx = ctx;
    note("turn_end", {
      stopReason: e?.message?.stopReason,
      toolResults: Array.isArray(e?.toolResults)
        ? e.toolResults.length
        : undefined,
    });
  });

  pi.on("agent_end", (e: any, ctx) => {
    lastCtx = ctx;
    note("agent_end");
    clearWatchdog();

    const messages: any[] = Array.isArray(e?.messages) ? e.messages : [];
    const last = messages[messages.length - 1];
    let anomaly: string | undefined;
    if (last?.role === "toolResult") {
      anomaly = "PREMATURE_STOP_AFTER_TOOL";
    } else if (last?.role === "assistant" && last?.stopReason === "toolUse") {
      anomaly = "PREMATURE_STOP_TOOLUSE";
    }
    // stopReason "stop" is healthy; "aborted" (user Esc) and "error" (surfaced
    // to the user) are benign terminations, not the silent-stop symptom.

    if (anomaly) {
      dump(
        anomaly,
        { lastTerminate: lastTool?.terminate ?? false },
        ctx,
        summarizeMessages(messages),
      );
    }
    runActive = false;
  });

  pi.on("session_shutdown", () => {
    clearWatchdog();
    runActive = false;
  });
}
