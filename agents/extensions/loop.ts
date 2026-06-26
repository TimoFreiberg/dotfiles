/**
 * Loop Extension
 *
 * Provides a /loop command that starts a follow-up loop with a breakout condition.
 * The loop keeps sending a prompt on turn end until the agent calls the
 * signal_loop_success tool.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Type } from "typebox";
import {
  complete,
  type Api,
  type Model,
  type UserMessage,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionSwitchEvent,
} from "@earendil-works/pi-coding-agent";
import { compact } from "@earendil-works/pi-coding-agent";
import {
  Container,
  type SelectItem,
  SelectList,
  Text,
} from "@earendil-works/pi-tui";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";

type LoopMode = "tests" | "custom" | "self";

type LoopStateData = {
  active: boolean;
  mode?: LoopMode;
  condition?: string;
  prompt?: string;
  summary?: string;
  loopCount?: number;
};

const LOOP_PRESETS = [
  { value: "tests", label: "Until tests pass", description: "" },
  { value: "custom", label: "Until custom condition", description: "" },
  { value: "self", label: "Self driven (agent decides)", description: "" },
] as const;

const LOOP_STATE_ENTRY = "loop-state";

/**
 * The role tuned for this task in roles.json (text-summary). Keeping it a role
 * (not a hardcoded model id) is the point: the summary model changes per machine
 * / over time while this extension stays constant. Mirrors session-namer.ts, which
 * does the same short-label summary against the same role.
 */
const SUMMARY_ROLE = "text-summary";

const SUMMARY_SYSTEM_PROMPT = `You summarize loop breakout conditions for a status widget.
Return a concise phrase (max 6 words) that says when the loop should stop.
Use plain text only, no quotes, no punctuation, no prefix.

Form should be "breaks when ...", "loops until ...", "stops on ...", "runs until ...", or similar.
Use the best form that makes sense for the loop condition.
`;

/**
 * Shared per-machine role -> model resolver (agents/_lib/roles.mjs).
 *
 * It lives OUTSIDE the extension dir, so a static relative import breaks: pi
 * discovers this extension through the symlink ~/.pi/agent/extensions ->
 * dotfiles/agents/extensions and resolves relative imports against that symlink
 * path, where ../_lib does not exist. We realpath import.meta.url (which crosses
 * the symlink) and dynamic-import the resolver by its absolute on-disk path.
 * Cached so we import it once. Mirrors extensions/session-namer.ts and
 * extensions/answer.ts.
 */
type ResolveRoleModelFn = (
  role: string,
  modelRegistry: {
    find: (provider: string, id: string) => Model<Api> | undefined;
  },
  opts?: { override?: string; agentDir?: string; quiet?: boolean },
) => {
  model: Model<Api>;
  provider?: string;
  id: string;
  thinking?: string;
  spec: string;
} | null;

let resolveRoleModelPromise: Promise<ResolveRoleModelFn> | null = null;
function getResolveRoleModel(): Promise<ResolveRoleModelFn> {
  if (!resolveRoleModelPromise) {
    const realHere = path.dirname(
      fs.realpathSync(fileURLToPath(import.meta.url)),
    );
    const rolesPath = path.resolve(realHere, "../_lib/roles.mjs");
    resolveRoleModelPromise = import(pathToFileURL(rolesPath).href).then(
      (mod) => mod.resolveRoleModel as ResolveRoleModelFn,
    );
  }
  return resolveRoleModelPromise;
}

function buildPrompt(mode: LoopMode, condition?: string): string {
  switch (mode) {
    case "tests":
      return (
        "Run all tests. If they are passing, call the signal_loop_success tool. " +
        "Otherwise continue until the tests pass."
      );
    case "custom": {
      const customCondition =
        condition?.trim() || "the custom condition is satisfied";
      return (
        `Continue until the following condition is satisfied: ${customCondition}. ` +
        "When it is satisfied, call the signal_loop_success tool."
      );
    }
    case "self":
      return "Continue until you are done. When finished, call the signal_loop_success tool.";
  }
}

function summarizeCondition(mode: LoopMode, condition?: string): string {
  switch (mode) {
    case "tests":
      return "tests pass";
    case "custom": {
      const summary = condition?.trim() || "custom condition";
      return summary.length > 48 ? `${summary.slice(0, 45)}...` : summary;
    }
    case "self":
      return "done";
  }
}

function getConditionText(mode: LoopMode, condition?: string): string {
  switch (mode) {
    case "tests":
      return "tests pass";
    case "custom":
      return condition?.trim() || "custom condition";
    case "self":
      return "you are done";
  }
}

async function summarizeBreakoutCondition(
  ctx: ExtensionContext,
  mode: LoopMode,
  condition?: string,
): Promise<string> {
  const fallback = summarizeCondition(mode, condition);

  // Resolve the summary model per-machine via the shared role map. Fail loud
  // (a one-line note) and degrade to the static fallback: the status widget is
  // a convenience, so an unresolved role or a failed model call must never
  // block or crash the loop. Mirrors session-namer.ts's graceful degradation.
  let resolved: ReturnType<ResolveRoleModelFn>;
  try {
    const resolveRoleModel = await getResolveRoleModel();
    resolved = resolveRoleModel(SUMMARY_ROLE, ctx.modelRegistry);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (ctx.hasUI)
      ctx.ui.notify(
        `loop: role '${SUMMARY_ROLE}' unavailable (${message})`,
        "warning",
      );
    return fallback;
  }
  if (!resolved) {
    if (ctx.hasUI)
      ctx.ui.notify(
        `loop: role '${SUMMARY_ROLE}' resolved to no model`,
        "warning",
      );
    return fallback;
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(resolved.model);
  if (!auth.ok) {
    if (ctx.hasUI)
      ctx.ui.notify(
        `loop: no auth for ${resolved.spec} (${auth.error})`,
        "warning",
      );
    return fallback;
  }

  const conditionText = getConditionText(mode, condition);
  const userMessage: UserMessage = {
    role: "user",
    content: [{ type: "text", text: conditionText }],
    timestamp: Date.now(),
  };

  let response: Awaited<ReturnType<typeof complete>>;
  try {
    response = await complete(
      resolved.model,
      { systemPrompt: SUMMARY_SYSTEM_PROMPT, messages: [userMessage] },
      { apiKey: auth.apiKey, headers: auth.headers },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (ctx.hasUI)
      ctx.ui.notify(`loop: summary call failed (${message})`, "warning");
    return fallback;
  }

  if (response.stopReason === "aborted" || response.stopReason === "error") {
    return fallback;
  }

  const summary = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!summary) return fallback;
  return summary.length > 60 ? `${summary.slice(0, 57)}...` : summary;
}

function getCompactionInstructions(mode: LoopMode, condition?: string): string {
  const conditionText = getConditionText(mode, condition);
  return `Loop active. Breakout condition: ${conditionText}. Preserve this loop state and breakout condition in the summary.`;
}

function updateStatus(ctx: ExtensionContext, state: LoopStateData): void {
  if (!ctx.hasUI) return;
  if (!state.active || !state.mode) {
    ctx.ui.setWidget("loop", undefined);
    return;
  }
  const loopCount = state.loopCount ?? 0;
  const turnText = `(turn ${loopCount})`;
  const summary = state.summary?.trim();
  const text = summary
    ? `Loop active: ${summary} ${turnText}`
    : `Loop active ${turnText}`;
  // Plain string, no theme.fg coloring: pilot (rpc mode) renders widget lines as
  // raw text with no ANSI stripping, so theme.fg's escape bytes would show as
  // literal garbage there. The TUI reads fine uncolored too. Matches the
  // tasklist widget's plain-text convention.
  ctx.ui.setWidget("loop", [text]);
}

async function loadState(ctx: ExtensionContext): Promise<LoopStateData> {
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as {
      type: string;
      customType?: string;
      data?: LoopStateData;
    };
    if (
      entry.type === "custom" &&
      entry.customType === LOOP_STATE_ENTRY &&
      entry.data
    ) {
      return entry.data;
    }
  }
  return { active: false };
}

export default function loopExtension(pi: ExtensionAPI): void {
  let loopState: LoopStateData = { active: false };

  function persistState(state: LoopStateData): void {
    pi.appendEntry(LOOP_STATE_ENTRY, state);
  }

  function setLoopState(state: LoopStateData, ctx: ExtensionContext): void {
    loopState = state;
    persistState(state);
    updateStatus(ctx, state);
  }

  function clearLoopState(ctx: ExtensionContext): void {
    const cleared: LoopStateData = { active: false };
    loopState = cleared;
    persistState(cleared);
    updateStatus(ctx, cleared);
  }

  function breakLoop(ctx: ExtensionContext): void {
    clearLoopState(ctx);
    ctx.ui.notify("Loop ended", "info");
  }

  function wasLastAssistantAborted(
    messages: Array<{ role?: string; stopReason?: string }>,
  ): boolean {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message?.role === "assistant") {
        return message.stopReason === "aborted";
      }
    }
    return false;
  }

  function triggerLoopPrompt(ctx: ExtensionContext): void {
    if (!loopState.active || !loopState.mode || !loopState.prompt) return;
    if (ctx.hasPendingMessages()) return;

    const loopCount = (loopState.loopCount ?? 0) + 1;
    loopState = { ...loopState, loopCount };
    persistState(loopState);
    updateStatus(ctx, loopState);

    pi.sendMessage(
      {
        customType: "loop",
        content: loopState.prompt,
        display: true,
      },
      {
        deliverAs: "followUp",
        triggerTurn: true,
      },
    );
  }

  /** Build loop state from a chosen preset value, prompting for the custom condition when needed. */
  async function buildStateFromPreset(
    ctx: ExtensionContext,
    selection: string,
  ): Promise<LoopStateData | null> {
    switch (selection) {
      case "tests":
        return { active: true, mode: "tests", prompt: buildPrompt("tests") };
      case "self":
        return { active: true, mode: "self", prompt: buildPrompt("self") };
      case "custom": {
        const condition = await ctx.ui.editor(
          "Enter loop breakout condition:",
          "",
        );
        if (!condition?.trim()) return null;
        return {
          active: true,
          mode: "custom",
          condition: condition.trim(),
          prompt: buildPrompt("custom", condition.trim()),
        };
      }
      default:
        return null;
    }
  }

  /**
   * Rich TUI selector (SelectList inside a custom widget). Only works in a real
   * terminal: ctx.ui.custom() renders a component factory, which non-tui hosts
   * (pilot rpc mode) can't honor — it rejects with an unsupported-host error.
   * See the `answer` extension's qna/custom handling for the same pattern.
   */
  async function showTuiLoopSelector(
    ctx: ExtensionContext,
  ): Promise<string | null> {
    const items: SelectItem[] = LOOP_PRESETS.map((preset) => ({
      value: preset.value,
      label: preset.label,
      description: preset.description,
    }));

    return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
      container.addChild(
        new Text(theme.fg("accent", theme.bold("Select a loop preset"))),
      );

      const selectList = new SelectList(items, Math.min(items.length, 10), {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      });

      selectList.onSelect = (item) => done(item.value);
      selectList.onCancel = () => done(null);

      container.addChild(selectList);
      container.addChild(
        new Text(theme.fg("dim", "Press enter to confirm or esc to cancel")),
      );
      container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          selectList.handleInput(data);
          tui.requestRender();
        },
      };
    });
  }

  /**
   * Remote fallback for non-tui hosts (pilot rpc mode): use the typed
   * select/input dialogs, which pilot renders as approval cards. Returns the
   * chosen preset value, or null on cancel.
   */
  async function showRemoteLoopSelector(
    ctx: ExtensionContext,
  ): Promise<string | null> {
    const options = LOOP_PRESETS.map((preset) => preset.label);
    const label = await ctx.ui.select("Select a loop preset", options);
    if (label === undefined) return null;
    const index = LOOP_PRESETS.findIndex((preset) => preset.label === label);
    if (index === -1) return null;
    return LOOP_PRESETS[index].value;
  }

  async function showLoopSelector(
    ctx: ExtensionContext,
  ): Promise<LoopStateData | null> {
    // ctx.ui.custom renders a TUI component factory and only works in a real
    // terminal. Non-tui hosts (pilot rpc mode) can't honor it; use the typed
    // select dialog there instead. ctx.hasUI gates both paths (json/print have
    // no UI to show either).
    const selection =
      ctx.mode === "tui"
        ? await showTuiLoopSelector(ctx)
        : await showRemoteLoopSelector(ctx);
    if (!selection) return null;
    return buildStateFromPreset(ctx, selection);
  }

  function parseArgs(args: string | undefined): LoopStateData | null {
    if (!args?.trim()) return null;
    const parts = args.trim().split(/\s+/);
    const mode = parts[0]?.toLowerCase();

    switch (mode) {
      case "tests":
        return { active: true, mode: "tests", prompt: buildPrompt("tests") };
      case "self":
        return { active: true, mode: "self", prompt: buildPrompt("self") };
      case "custom": {
        const condition = parts.slice(1).join(" ").trim();
        if (!condition) return null;
        return {
          active: true,
          mode: "custom",
          condition,
          prompt: buildPrompt("custom", condition),
        };
      }
      default:
        return null;
    }
  }

  pi.registerTool({
    name: "signal_loop_success",
    label: "Signal Loop Success",
    description:
      "Stop the active loop when the breakout condition is satisfied. Only call this tool when explicitly instructed to do so by the user, tool or system prompt.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!loopState.active) {
        return {
          content: [{ type: "text", text: "No active loop is running." }],
          details: { active: false },
        };
      }

      clearLoopState(ctx);

      return {
        content: [{ type: "text", text: "Loop ended." }],
        details: { active: false },
      };
    },
  });

  pi.registerCommand("loop", {
    description: "Start a follow-up loop until a breakout condition is met",
    handler: async (args, ctx) => {
      let nextState = parseArgs(args);
      if (!nextState) {
        if (!ctx.hasUI) {
          ctx.ui.notify(
            "Usage: /loop tests | /loop custom <condition> | /loop self",
            "warning",
          );
          return;
        }
        nextState = await showLoopSelector(ctx);
      }

      if (!nextState) {
        ctx.ui.notify("Loop cancelled", "info");
        return;
      }

      if (loopState.active) {
        const confirm = ctx.hasUI
          ? await ctx.ui.confirm(
              "Replace active loop?",
              "A loop is already active. Replace it?",
            )
          : true;
        if (!confirm) {
          ctx.ui.notify("Loop unchanged", "info");
          return;
        }
      }

      const summarizedState: LoopStateData = {
        ...nextState,
        summary: undefined,
        loopCount: 0,
      };
      setLoopState(summarizedState, ctx);
      ctx.ui.notify("Loop active", "info");
      triggerLoopPrompt(ctx);

      const mode = nextState.mode!;
      const condition = nextState.condition;
      void (async () => {
        const summary = await summarizeBreakoutCondition(ctx, mode, condition);
        if (
          !loopState.active ||
          loopState.mode !== mode ||
          loopState.condition !== condition
        )
          return;
        loopState = { ...loopState, summary };
        persistState(loopState);
        updateStatus(ctx, loopState);
      })();
    },
  });

  pi.on("agent_end", async (event, ctx) => {
    if (!loopState.active) return;

    if (ctx.hasUI && wasLastAssistantAborted(event.messages)) {
      const confirm = await ctx.ui.confirm(
        "Break active loop?",
        "Operation aborted. Break out of the loop?",
      );
      if (confirm) {
        breakLoop(ctx);
        return;
      }
    }

    triggerLoopPrompt(ctx);
  });

  pi.on("session_before_compact", async (event, ctx) => {
    if (!loopState.active || !loopState.mode || !ctx.model) return;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok) return;

    const instructionParts = [
      event.customInstructions,
      getCompactionInstructions(loopState.mode, loopState.condition),
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const compaction = await compact(
        event.preparation,
        ctx.model,
        auth.apiKey ?? "",
        auth.headers,
        instructionParts,
        event.signal,
      );
      return { compaction };
    } catch (error) {
      if (ctx.hasUI) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Loop compaction failed: ${message}`, "warning");
      }
      return;
    }
  });

  async function restoreLoopState(ctx: ExtensionContext): Promise<void> {
    loopState = await loadState(ctx);
    updateStatus(ctx, loopState);

    if (loopState.active && loopState.mode && !loopState.summary) {
      const mode = loopState.mode;
      const condition = loopState.condition;
      void (async () => {
        const summary = await summarizeBreakoutCondition(ctx, mode, condition);
        if (
          !loopState.active ||
          loopState.mode !== mode ||
          loopState.condition !== condition
        )
          return;
        loopState = { ...loopState, summary };
        persistState(loopState);
        updateStatus(ctx, loopState);
      })();
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    await restoreLoopState(ctx);
  });

  pi.on("session_switch", async (_event: SessionSwitchEvent, ctx) => {
    await restoreLoopState(ctx);
  });
}
