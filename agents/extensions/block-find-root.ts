/**
 * Block `find /` Extension
 *
 * Blocks bash commands that run `find` rooted at `/` (whole-filesystem walk).
 * On macOS this is slow *and* trips the TCC permission prompts as find
 * descends into ~/Desktop, ~/Documents, ~/Downloads, etc. — every protected
 * directory pops a dialog. Sessions reach for it as a last resort when a file
 * isn't where they expect (overwhelmingly: a playwright-mcp screenshot that
 * landed in the MCP server's cwd, not the worktree), then pay the cost.
 *
 * We block the invocation and hand back a reason that points at the better
 * moves: scope the search to a directory, or use `fd`. The reason string is
 * fed to the model, so it's phrased as guidance, not just a refusal.
 *
 * Matching (deliberately narrow — only a *bare* `/` path argument):
 *   blocks:    `find / -name x`   `find -L / -type d`   `... ; find / ...`
 *   allows:    `find /Users/...`  `find ~ ...`  `find . ...`  `fd ... /`
 * Only the `bash` tool is inspected; the regex anchors on a command boundary
 * so it catches `find /` anywhere in a chained command without matching
 * substrings like `myfind /...`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// (start-of-string | whitespace | ; & | open-paren) find <flags>? <bare /> (ws | end)
const FIND_ROOT = /(^|[\s;&|(])find\s+(-[A-Za-z]+\s+)*\/(\s|$)/;

const REASON = [
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

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return undefined;
    const command = event.input?.command;
    if (typeof command !== "string") return undefined;
    if (FIND_ROOT.test(command)) {
      return { block: true, reason: REASON };
    }
    return undefined;
  });
}
