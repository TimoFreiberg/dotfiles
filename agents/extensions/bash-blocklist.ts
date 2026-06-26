/**
 * Bash Blocklist Extension
 *
 * Blocks bash commands that match a list of known footguns. Each rule pairs
 * a regex (matched against the full command string) with a reason that's fed
 * back to the model — phrased as guidance, not just a refusal, so the model
 * can pick a better move instead of flailing.
 *
 * Current rules:
 *
 *  • `find /` — walks the whole filesystem. Slow everywhere; on macOS it also
 *    trips a TCC permission prompt for every protected dir it enters
 *    (Desktop, Documents, Downloads, …). Sessions reach for it as a last
 *    resort when a file isn't where they expect (overwhelmingly: a
 *    playwright-mcp screenshot that landed in the MCP server's cwd, not the
 *    worktree), then pay the cost. We point at scoping or `fd` instead.
 *
 *  • `rg -r` — `rg` is recursive by default; `-r`/`--replace` *replaces* parts
 *    of each match. Almost always a grep-habit typo (someone meaning
 *    `grep -r`), and it silently returns mangled output rather than failing.
 *    Best-effort match: catches `-r` as a standalone short flag or anywhere
 *    in a combined short-flag cluster (`-ir`, `-xyzr`, `-rUS5`, …). Long
 *    options like `--replace`/`--reverse` are left alone deliberately —
 *    those are distinct, intentional features, not the typo this catches.
 *
 * Matching notes:
 *   • Only the `bash` tool is inspected.
 *   • Each rule anchors on a command boundary so it catches the pattern
 *     anywhere in a chained command without matching substrings like
 *     `myfind /...` or `myrg -r`.
 *   • The `rg` rule's token run won't cross `; & |` separators, so
 *     `echo rg rules; grep -r foo` is correctly *not* matched.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// (start | ws | ; & | open-paren) find <flags>? <bare /> (ws | end)
const FIND_ROOT = /(^|[\s;&|(])find\s+(-[A-Za-z]+\s+)*\/(\s|$)/;

// rg (boundary-prefixed), then non-separator tokens, then a short-flag cluster
// (single leading dash) containing 'r'. See file header for the full rationale.
const RG_REPLACE =
  /(?:^|[\s;&|(])rg\s+(?:[^;&|\s]+\s+)*-[A-Za-z0-9]*r[A-Za-z0-9]*/;

const FIND_ROOT_REASON = [
  "`find /` walks the entire filesystem: it's slow and on macOS it triggers a",
  "permission prompt for every protected dir it enters (Desktop, Documents,",
  "Downloads, …). Blocked.",
  "",
  "Instead:",
  "  • Scope to a real directory: `find ~/some/dir -name '<pat>'` or `fd '<pat>' ~/some/dir`.",
  "  • Hunting a playwright-mcp screenshot? It's written to the MCP server's",
  "    working directory, NOT the current worktree — look there (or pass an",
  "    absolute outputPath to the screenshot tool) rather than scanning `/`.",
].join("\n");

const RG_REPLACE_REASON = [
  "`rg` is recursive by default — you don't need (and almost certainly didn't",
  "mean) `-r`. In `rg`, `-r`/`--replace` takes a replacement string and rewrites",
  "each match, so `rg -r <foo> <pat>` returns mangled output instead of failing.",
  "This is usually a `grep -r` habit. Blocked.",
  "",
  "Instead:",
  "  • Just drop the `-r`: `rg '<pat>' <dir>` (rg already recurses).",
  "  • If you genuinely wanted replacement, use `-r '<repl>'` explicitly and",
  "    deliberately — but re-read this block first, it's rarely what you want.",
].join("\n");

const RULES: ReadonlyArray<{ test: RegExp; reason: string }> = [
  { test: FIND_ROOT, reason: FIND_ROOT_REASON },
  { test: RG_REPLACE, reason: RG_REPLACE_REASON },
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return undefined;
    const command = event.input?.command;
    if (typeof command !== "string") return undefined;
    for (const rule of RULES) {
      if (rule.test.test(command)) {
        return { block: true, reason: rule.reason };
      }
    }
    return undefined;
  });
}
