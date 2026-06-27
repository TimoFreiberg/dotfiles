/**
 * Goal Extension
 *
 * Provides a /goal command that starts a follow-up loop driving toward a goal.
 * The loop keeps re-sending the goal prompt on turn end until the agent calls
 * the signal_goal_success tool (which it does when the goal is achieved).
 *
 * The prompt is the only parameter — there are no presets or breakout
 * "conditions". The agent is told the goal verbatim (as the re-driven user
 * message each turn) AND via a standing system-prompt block injected while
 * the loop is active, which is what actually authorizes and instructs the
 * agent to call signal_goal_success when the goal is met. The agent context
 * grows across iterations
 * (compaction handles overflow; the goal prompt is preserved through it),
 * which is the right trade for tight fix-retry-fix cycles and watchful-waiting.
 * For long multistep plan work where fresh context per step matters, compose
 * implementer + reviewer subagents from the goal prompt instead.
 */

import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { compact } from "@earendil-works/pi-coding-agent";

type GoalStateData = {
  active: boolean;
  prompt?: string;
  loopCount?: number;
};

const GOAL_STATE_ENTRY = "goal-state";

// Status widget label ceiling. The prompt is shown verbatim (truncated on a
// word boundary) — no model call to shorten it, since it's already a
// user-authored string and summarizing it would only add latency + a failure
// surface for a status label.
const MAX_LABEL_LEN = 48;

/** Truncate the goal prompt to a widget-friendly length on a word boundary. */
function truncateLabel(prompt: string): string {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  if (trimmed.length <= MAX_LABEL_LEN) return trimmed;
  const slice = trimmed.slice(0, MAX_LABEL_LEN);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > MAX_LABEL_LEN - 15 ? lastSpace : MAX_LABEL_LEN;
  return `${slice
    .slice(0, cut)
    .replace(/[\s\-–—:;,.]+$/, "")
    .trim()}…`;
}

function getCompactionInstructions(prompt: string): string {
  return `Goal loop active. Goal: ${prompt}. Preserve this goal-loop state and the goal prompt in the summary.`;
}

function getGoalLoopInstructions(prompt: string): string {
  return `

## Goal loop

You are in a goal loop driving toward this goal:

${prompt}

Keep working toward it across turns. When the goal is fully achieved, call the \`signal_goal_success\` tool to end the loop. This system-prompt block is the explicit instruction that authorizes calling that tool — call it the moment the goal is met, not before, and not to signal partial progress.
`;
}

function updateStatus(ctx: ExtensionContext, state: GoalStateData): void {
  if (!ctx.hasUI) return;
  if (!state.active || !state.prompt) {
    ctx.ui.setWidget("goal", undefined);
    return;
  }
  const loopCount = state.loopCount ?? 0;
  const label = truncateLabel(state.prompt);
  const text = `Goal: ${label} (turn ${loopCount})`;
  // Plain string, no theme.fg coloring: pilot (rpc mode) renders widget lines as
  // raw text with no ANSI stripping, so theme.fg's escape bytes would show as
  // literal garbage there. The TUI reads fine uncolored too. Matches the
  // tasklist widget's plain-text convention.
  ctx.ui.setWidget("goal", [text]);
}

async function loadState(ctx: ExtensionContext): Promise<GoalStateData> {
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as {
      type: string;
      customType?: string;
      data?: GoalStateData;
    };
    if (
      entry.type === "custom" &&
      entry.customType === GOAL_STATE_ENTRY &&
      entry.data
    ) {
      return entry.data;
    }
  }
  return { active: false };
}

export default function goalExtension(pi: ExtensionAPI): void {
  let goalState: GoalStateData = { active: false };

  function persistState(state: GoalStateData): void {
    pi.appendEntry(GOAL_STATE_ENTRY, state);
  }

  function setGoalState(state: GoalStateData, ctx: ExtensionContext): void {
    goalState = state;
    persistState(state);
    updateStatus(ctx, state);
  }

  function clearGoalState(ctx: ExtensionContext): void {
    const cleared: GoalStateData = { active: false };
    goalState = cleared;
    persistState(cleared);
    updateStatus(ctx, cleared);
  }

  function breakGoal(ctx: ExtensionContext): void {
    clearGoalState(ctx);
    ctx.ui.notify("Goal ended", "info");
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

  function triggerGoalPrompt(ctx: ExtensionContext): void {
    if (!goalState.active || !goalState.prompt) return;
    if (ctx.hasPendingMessages()) return;
    // Capture the narrowed prompt before reassigning goalState — the spread
    // below widens goalState.prompt back to `string | undefined` per the
    // GoalStateData type, which sendMessage's content field rejects.
    const prompt = goalState.prompt;
    const loopCount = (goalState.loopCount ?? 0) + 1;
    goalState = { ...goalState, loopCount };
    persistState(goalState);
    updateStatus(ctx, goalState);

    pi.sendMessage(
      {
        customType: "goal",
        content: prompt,
        display: true,
      },
      {
        deliverAs: "followUp",
        triggerTurn: true,
      },
    );
  }

  /**
   * Resolve the goal prompt from command args. With args, use them verbatim;
   * without, open an editor (works in both TUI and pilot rpc mode, which
   * renders it as an approval card). Returns null on cancel / empty input.
   */
  async function resolveGoalPrompt(
    args: string | undefined,
    ctx: ExtensionContext,
  ): Promise<string | null> {
    const fromArgs = args?.trim();
    if (fromArgs) return fromArgs;

    if (!ctx.hasUI) {
      ctx.ui.notify("Usage: /goal <prompt>", "warning");
      return null;
    }

    const prompt = await ctx.ui.editor("Enter the goal prompt:", "");
    return prompt?.trim() || null;
  }

  pi.registerTool({
    name: "signal_goal_success",
    label: "Signal Goal Success",
    description:
      "Stop the active goal loop when the goal is achieved. Only call this tool when explicitly instructed to do so by the user, tool or system prompt.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!goalState.active) {
        return {
          content: [{ type: "text", text: "No active goal is running." }],
          details: { active: false },
        };
      }

      clearGoalState(ctx);

      return {
        content: [{ type: "text", text: "Goal ended." }],
        details: { active: false },
      };
    },
  });

  pi.registerCommand("goal", {
    description:
      "Start a goal loop: keep re-driving the prompt until the agent signals success. Usage: /goal <prompt>",
    handler: async (args, ctx) => {
      const prompt = await resolveGoalPrompt(args, ctx);
      if (!prompt) {
        ctx.ui.notify("Goal cancelled", "info");
        return;
      }

      if (goalState.active) {
        const confirm = ctx.hasUI
          ? await ctx.ui.confirm(
              "Replace active goal?",
              "A goal is already active. Replace it?",
            )
          : true;
        if (!confirm) {
          ctx.ui.notify("Goal unchanged", "info");
          return;
        }
      }

      setGoalState({ active: true, prompt, loopCount: 0 }, ctx);
      ctx.ui.notify("Goal active", "info");
      triggerGoalPrompt(ctx);
    },
  });

  // Surface the loop to the agent each turn via the system prompt. This is
  // the explicit instruction the signal_goal_success tool description gates on
  // ("Only call this tool when explicitly instructed ... by ... system prompt").
  // Dynamic: re-evaluated every turn, so clearing the goal stops the injection
  // automatically — no cleanup needed. Session-scoped goalState means subagent
  // sessions (active=false) never get this framing.
  pi.on("before_agent_start", async (event) => {
    if (!goalState.active || !goalState.prompt) return undefined;
    return {
      systemPrompt:
        event.systemPrompt + getGoalLoopInstructions(goalState.prompt),
    };
  });

  pi.on("agent_end", async (event, ctx) => {
    if (!goalState.active) return;

    if (ctx.hasUI && wasLastAssistantAborted(event.messages)) {
      const confirm = await ctx.ui.confirm(
        "Break active goal?",
        "Operation aborted. Break out of the goal loop?",
      );
      if (confirm) {
        breakGoal(ctx);
        return;
      }
    }

    triggerGoalPrompt(ctx);
  });

  pi.on("session_before_compact", async (event, ctx) => {
    if (!goalState.active || !goalState.prompt || !ctx.model) return;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok) return;

    const instructionParts = [
      event.customInstructions,
      getCompactionInstructions(goalState.prompt),
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
        ctx.ui.notify(`Goal compaction failed: ${message}`, "warning");
      }
      return;
    }
  });

  async function restoreGoalState(ctx: ExtensionContext): Promise<void> {
    goalState = await loadState(ctx);
    updateStatus(ctx, goalState);
  }

  // session_start fires for every session activation (reason: startup, reload,
  // new, resume, fork) AFTER the new session manager is installed, so
  // loadState reads the now-active session's entries. The old session_switch
  // handler was removed: pi renamed it to session_before_switch, which fires
  // BEFORE the swap while ctx.sessionManager still points at the old session,
  // so restoring there would load the stale (pre-switch) goal state.
  pi.on("session_start", async (_event, ctx) => {
    await restoreGoalState(ctx);
  });
}
