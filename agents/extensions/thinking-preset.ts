/**
 * Thinking Preset Extension
 *
 * Adds an `alt+e` shortcut that toggles between two thinking presets
 * (deep/fast) without walking the full six-level cycle built into
 * `shift+tab`. Also adds a `/thinking` command for reaching any level.
 *
 * Mapping on Opus 4.7 Bedrock (per pi-mono/packages/ai/src):
 *   off      → thinking disabled entirely
 *   minimal  → Anthropic effort "low"    (duplicates `low` on adaptive models)
 *   low      → Anthropic effort "low"
 *   medium   → Anthropic effort "medium"
 *   high     → Anthropic effort "high"
 *   xhigh    → Anthropic effort "xhigh"  (native on 4.7, was "max" on 4.6)
 *
 * The built-in `shift+tab` cycle is left untouched — use this for the common
 * deep/fast swap and `shift+tab` when you need a level in between.
 *
 * Note: `pi.setThinkingLevel` is clamped to model capabilities. On non-reasoning
 * models (Haiku, older Sonnets), any level collapses to "off" silently.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const DEEP_LEVEL: ThinkingLevel = "xhigh";
const FAST_LEVEL: ThinkingLevel = "low";

const ALL_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

function isValidLevel(v: string): v is ThinkingLevel {
  return (ALL_LEVELS as string[]).includes(v);
}

export default function (pi: ExtensionAPI) {
  // alt+e — toggle between fast and deep presets.
  // If currently at deep, go to fast; otherwise go to deep. Simple rule,
  // no state tracking: when you're somewhere in the middle (e.g. medium
  // via /thinking), alt+e always takes you to deep first.
  pi.registerShortcut("alt+e", {
    description: `Toggle thinking (${FAST_LEVEL} ↔ ${DEEP_LEVEL})`,
    handler: async (ctx) => {
      const current = pi.getThinkingLevel();
      const next: ThinkingLevel =
        current === DEEP_LEVEL ? FAST_LEVEL : DEEP_LEVEL;
      pi.setThinkingLevel(next);
      if (ctx.hasUI) {
        const effective = pi.getThinkingLevel();
        ctx.ui.notify(`thinking: ${effective}`, "info");
      }
    },
  });

  // /thinking [level] — escape hatch to reach any level.
  //   /thinking          → open selector
  //   /thinking <level>  → set directly
  pi.registerCommand("thinking", {
    description: "Set thinking level",
    handler: async (args, ctx) => {
      const arg = args.trim();

      if (arg) {
        if (!isValidLevel(arg)) {
          if (ctx.hasUI) {
            ctx.ui.notify(`unknown thinking level: ${arg}`, "warning");
          }
          return;
        }
        pi.setThinkingLevel(arg);
        if (ctx.hasUI) {
          ctx.ui.notify(`thinking: ${pi.getThinkingLevel()}`, "info");
        }
        return;
      }

      if (!ctx.hasUI) return;

      const current = pi.getThinkingLevel();
      const choice = await ctx.ui.select(
        `Thinking level (current: ${current})`,
        ALL_LEVELS,
      );
      if (!choice || !isValidLevel(choice)) return;
      pi.setThinkingLevel(choice);
      ctx.ui.notify(`thinking: ${pi.getThinkingLevel()}`, "info");
    },
  });
}
