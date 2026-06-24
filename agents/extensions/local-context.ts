/**
 * Local (uncommitted) project context Extension
 *
 * Pi natively loads AGENTS.md / CLAUDE.md walking up from cwd plus the global
 * ~/.pi/agent/AGENTS.md. It has no equivalent of Claude Code's CLAUDE.local.md
 * — the per-developer, gitignored instructions file. This extension adds that,
 * and fixes a wrinkle neither tool handles: such files live in .gitignore, so
 * jj workspaces (and git worktrees) never materialize them. From inside
 * ~/src/fastly/Varnish-hashset the file simply isn't on disk.
 *
 * The trick: resolve the *main* repo root from any working copy and read the
 * local file from there, so one source of truth (the file in the main checkout)
 * feeds every workspace.
 *
 * Resolution, checked walking up from cwd:
 *   - jj: `.jj/repo` is a DIRECTORY in the main/default workspace (root = that
 *     dir), and a FILE in a secondary workspace whose contents are a path to
 *     <main>/.jj/repo (root = up two from the resolved target).
 *   - git: `.git` may be a dir (main checkout) or a file (worktree). `git
 *     rev-parse --git-common-dir` resolves to <main>/.git in both cases; the
 *     main root is its parent. Colocated jj+git repos hit the jj branch first.
 *
 * Files read from the resolved root: CLAUDE.local.md, AGENTS.local.md.
 * Contents are re-read each turn so edits show up without a restart.
 *
 * Install: lives in ~/.pi/agent/extensions/ (global), so it applies to every
 * repo, not just one.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LOCAL_FILES = ["CLAUDE.local.md", "AGENTS.local.md"];

/** Resolve the main repo root from any working copy (jj workspace, git worktree, or plain). */
function resolveMainRepoRoot(startCwd: string): string | null {
  let dir = path.resolve(startCwd);
  const fsRoot = path.parse(dir).root;

  while (true) {
    const jjRepo = path.join(dir, ".jj", "repo");
    if (fs.existsSync(jjRepo)) {
      if (fs.statSync(jjRepo).isDirectory()) {
        // main / default workspace: the repo root is this dir
        return dir;
      }
      // secondary jj workspace: .jj/repo is a file holding a path to <main>/.jj/repo,
      // relative to this workspace's .jj directory.
      const target = fs.readFileSync(jjRepo, "utf8").trim();
      const resolved = path.resolve(path.join(dir, ".jj"), target);
      return path.dirname(path.dirname(resolved));
    }

    const gitPath = path.join(dir, ".git");
    if (fs.existsSync(gitPath)) {
      // pure git (colocated jj+git already returned above via the jj branch).
      // --git-common-dir resolves to <main>/.git for both main checkouts and
      // worktrees; the main root is its parent.
      try {
        const commonDir = execFileSync(
          "git",
          ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          { cwd: dir, encoding: "utf8" },
        ).trim();
        if (commonDir) return path.dirname(commonDir);
      } catch {
        // fall through to using this dir
      }
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir || dir === fsRoot) return null;
    dir = parent;
  }
}

/** Read the local instruction files from the repo root, concatenated. Null if none. */
function loadLocalContext(
  repoRoot: string,
): { text: string; files: string[] } | null {
  const parts: string[] = [];
  const found: string[] = [];

  for (const name of LOCAL_FILES) {
    const p = path.join(repoRoot, name);
    try {
      if (!fs.statSync(p).isFile()) continue;
    } catch {
      continue; // missing
    }
    const content = fs.readFileSync(p, "utf8").trim();
    if (content) {
      parts.push(`### ${name} (${p})\n\n${content}`);
      found.push(name);
    }
  }

  if (parts.length === 0) return null;
  return { text: parts.join("\n\n"), files: found };
}

export default function (pi: ExtensionAPI) {
  let repoRoot: string | null = null;

  pi.on("session_start", async (_event, ctx) => {
    repoRoot = resolveMainRepoRoot(ctx.cwd);
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
