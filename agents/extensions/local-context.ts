/**
 * Local (uncommitted) project context Extension
 *
 * Pi natively loads AGENTS.md / CLAUDE.md walking up from cwd plus the global
 * ~/.pi/agent/AGENTS.md. It has no equivalent of Claude Code's CLAUDE.local.md
 * — the per-developer, gitignored instructions file. This extension adds that.
 *
 * The local file is read from the repository containing the current working
 * directory. A jj workspace or git worktree therefore only sees local
 * instructions present in that checkout, never a different checkout's file.
 *
 * Resolution checks for `.jj/repo` or `.git` while walking up from cwd and
 * returns the directory containing the marker.
 *
 * The canonical file is AGENTS.local.md; CLAUDE.local.md is a compatibility
 * fallback. Contents are re-read each turn so edits show up without a restart.
 *
 * Install: lives in ~/.pi/agent/extensions/ (global), so it applies to every
 * repo, not just one.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// AGENTS.local.md is canonical; CLAUDE.local.md remains a compatibility fallback.
const LOCAL_FILES = ["AGENTS.local.md", "CLAUDE.local.md"];

/** Resolve the repository root containing the current working directory. */
function resolveRepoRoot(startCwd: string): string | null {
  let dir = path.resolve(startCwd);
  const fsRoot = path.parse(dir).root;

  while (true) {
    if (
      fs.existsSync(path.join(dir, ".jj", "repo")) ||
      fs.existsSync(path.join(dir, ".git"))
    ) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir || dir === fsRoot) return null;
    dir = parent;
  }
}

/** Read the canonical local file, falling back to its Claude-compatible name. */
function loadLocalContext(
  repoRoot: string,
): { text: string; files: string[] } | null {
  for (const name of LOCAL_FILES) {
    const p = path.join(repoRoot, name);
    try {
      if (!fs.statSync(p).isFile()) continue;
      const content = fs.readFileSync(p, "utf8").trim();
      if (content) return { text: `### ${name} (${p})\n\n${content}`, files: [name] };
    } catch {
      continue;
    }
  }

  return null;
}

export default function (pi: ExtensionAPI) {
  let repoRoot: string | null = null;

  pi.on("session_start", async (_event, ctx) => {
    repoRoot = resolveRepoRoot(ctx.cwd);
    if (!repoRoot) return;
    const loaded = loadLocalContext(repoRoot);
    if (loaded) {
      ctx.ui.notify(
        `Loaded local context: ${loaded.files.join(", ")} (from ${repoRoot})`,
        "info",
      );
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (!repoRoot) return undefined;
    const loaded = loadLocalContext(repoRoot); // re-read so edits show up live
    if (!loaded) return undefined;

    return {
      systemPrompt:
        event.systemPrompt +
        `

## Local (uncommitted) project instructions

The following come from the repository's local instruction files — not checked
in, specific to this developer's setup. Treat them with the same weight as the
committed AGENTS.md / CLAUDE.md context.

${loaded.text}
`,
    };
  });
}
