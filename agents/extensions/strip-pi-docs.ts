/**
 * Strip pi-docs Extension
 *
 * Removes the "Pi documentation (read only when…)" paragraph from pi's DEFAULT
 * system prompt every turn. That block points the model at the installed
 * package's README/docs/examples; we reach pi's docs through the `extend-pi`
 * skill instead, so the inline pointer is redundant context.
 *
 * Global (lives in ~/.pi/agent/extensions/ → loads for every pi session,
 * including pilot, regardless of project trust). It edits the assembled prompt
 * via `before_agent_start`, so the tool list stays dynamic — unlike a
 * `customPrompt`, this doesn't freeze the tools/guidelines sections.
 *
 * Robustness (deliberately fails loud, never silently mangles):
 *  - Skips silently when a custom system prompt is in effect (SYSTEM.md,
 *    --system-prompt, custom templates) — those have no doc block to strip.
 *  - Anchors on the block's exact START heading and END line (the 3 middle
 *    lines hold install-specific absolute paths, so they're matched loosely).
 *  - Asserts the text immediately BEFORE the block (the guidelines tail) and
 *    that the block isn't extended with extra bullets immediately AFTER it.
 *  - On ANY surprise (heading/end moved, something inserted before/after) it
 *    logs loudly and leaves pi's prompt untouched, so a future pi release that
 *    reshapes this region gets noticed and reviewed rather than half-stripped.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// The last guideline pi emits — always present, always last (added
// unconditionally after the tool guidelines). The doc block sits right after it.
const GUIDELINES_TAIL = "- Show file paths clearly when working with files";
const SEP = "\n\n";
// Exact first line of the block. Stable (no paths).
const DOC_HEADING =
  "Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):";
// Exact last line of the block. Stable (no paths) — the path-bearing lines are
// all above it, so we match heading→end and discard whatever's between.
const DOC_END =
  "- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)";

function warn(reason: string, ctx?: ExtensionContext): void {
  const msg = `[strip-pi-docs] ${reason} — leaving pi's default prompt unchanged. Review this extension against pi's current system prompt.`;
  console.error(msg);
  // Best-effort surfacing to the host UI (e.g. pilot). No-op / harmless if the
  // host has no UI channel; never let a notify failure break the turn.
  try {
    ctx?.ui?.notify?.(msg, "warning");
  } catch {
    /* notify is best-effort in headless hosts */
  }
}

export default function stripPiDocs(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    // A custom system prompt legitimately has no doc block — nothing to strip,
    // and its absence is not a surprise. Skip quietly.
    if (event.systemPromptOptions?.customPrompt) {
      return undefined;
    }

    const prompt = event.systemPrompt;

    const headingIdx = prompt.indexOf(DOC_HEADING);
    if (headingIdx === -1) {
      warn("could not find the 'Pi documentation' heading", ctx);
      return undefined;
    }
    if (prompt.indexOf(DOC_HEADING, headingIdx + DOC_HEADING.length) !== -1) {
      warn("found more than one 'Pi documentation' heading", ctx);
      return undefined;
    }

    const endAnchorIdx = prompt.indexOf(DOC_END, headingIdx);
    if (endAnchorIdx === -1) {
      warn("found the doc heading but not its expected end line", ctx);
      return undefined;
    }
    const blockEnd = endAnchorIdx + DOC_END.length;

    // BEFORE anchor: the block must sit immediately after the guidelines tail.
    // If pi inserts a new section between them, this no longer holds.
    const expectedPrefix = GUIDELINES_TAIL + SEP;
    if (
      prompt.slice(headingIdx - expectedPrefix.length, headingIdx) !==
      expectedPrefix
    ) {
      warn(
        "unexpected text before the doc block (pi may have inserted a new section ahead of it)",
        ctx,
      );
      return undefined;
    }

    // AFTER anchor: a bullet directly after our end line means the doc list grew
    // past what we know. Refuse rather than strip-and-orphan the new bullets.
    if (prompt.startsWith("\n- ", blockEnd)) {
      warn(
        "the doc list continues past our end anchor (pi may have added new doc bullets)",
        ctx,
      );
      return undefined;
    }

    // Strip the separator + block; the guidelines tail flows straight into
    // whatever pi appends next (project context / skills / date / cwd).
    const stripped =
      prompt.slice(0, headingIdx - SEP.length) + prompt.slice(blockEnd);
    return { systemPrompt: stripped };
  });
}
