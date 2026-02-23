/**
 * Code Review Extension (based on mitsuhiko's review extension)
 *
 * Provides a `/review` command that prompts the agent to review code changes.
 * Supports multiple review modes:
 * - Review a GitHub pull request (checks out the PR locally)
 * - Review against a base branch (PR style)
 * - Review uncommitted changes
 * - Review a specific commit
 * - Review specific folders/files (snapshot, not diff)
 * - Custom review instructions
 *
 * Usage:
 * - `/review` - show interactive selector
 * - `/review pr 123` - review PR #123 (checks out locally)
 * - `/review pr https://github.com/owner/repo/pull/123` - review PR from URL
 * - `/review uncommitted` - review uncommitted changes directly
 * - `/review branch main` - review against main branch
 * - `/review commit abc123` - review specific commit
 * - `/review folder src docs` - review specific folders/files (snapshot, not diff)
 * - `/review custom "check for security issues"` - custom instructions
 *
 * Project-specific review guidelines:
 * - Create REVIEW_GUIDELINES.md in the same directory as .pi
 * - Its contents are used as the review prompt
 * - If not found, a minimal default prompt is used
 *
 * Before sending, the full review prompt is shown in an editor so you can
 * edit the instructions or replace them entirely. Press enter to confirm,
 * or clear/escape to cancel.
 *
 * Note: PR checkout will fail if there are uncommitted changes that conflict with the PR branch.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { DynamicBorder, BorderedLoader } from "@mariozechner/pi-coding-agent";
import {
  Container,
  type SelectItem,
  SelectList,
  Text,
} from "@mariozechner/pi-tui";
import path from "node:path";
import { promises as fs } from "node:fs";

const REVIEW_STATE_TYPE = "review-session";
let endReviewInProgress = false;

type ReviewSessionState = {
  active: boolean;
  originId?: string;
};

function setReviewWidget(ctx: ExtensionContext, active: boolean) {
  if (!ctx.hasUI) return;
  if (!active) {
    ctx.ui.setWidget("review", undefined);
    return;
  }

  ctx.ui.setWidget("review", (_tui, theme) => {
    const text = new Text(
      theme.fg("warning", "Review session active, return with /end-review"),
      0,
      0,
    );
    return {
      render(width: number) {
        return text.render(width);
      },
      invalidate() {
        text.invalidate();
      },
    };
  });
}

/**
 * Get the current review state from session history.
 * This is the single source of truth for review state - no global variables needed.
 * The state is derived by scanning the session branch for the most recent review state entry.
 */
function getReviewState(ctx: ExtensionContext): ReviewSessionState | undefined {
  let state: ReviewSessionState | undefined;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === REVIEW_STATE_TYPE) {
      state = entry.data as ReviewSessionState | undefined;
    }
  }
  return state;
}

/**
 * Get the review origin ID from session state if an active review exists.
 * Returns undefined if no active review session.
 */
function getReviewOriginId(ctx: ExtensionContext): string | undefined {
  const state = getReviewState(ctx);
  if (state?.active && state.originId) {
    return state.originId;
  }
  return undefined;
}

/**
 * Update the review widget to reflect current session state.
 */
function syncReviewWidget(ctx: ExtensionContext) {
  const originId = getReviewOriginId(ctx);
  setReviewWidget(ctx, originId !== undefined);
}

// Review target types
type ReviewTarget =
  | { type: "uncommitted" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string }
  | { type: "custom"; instructions: string }
  | { type: "folder"; paths: string[] }
  | {
      type: "pullRequest";
      prNumber: number;
      baseBranch: string;
      title: string;
    };

// Minimal prompts - project guidelines provide the detail
const UNCOMMITTED_PROMPT =
  "Review the current code changes (staged, unstaged, and untracked files).";

const BASE_BRANCH_PROMPT_WITH_MERGE_BASE =
  "Review the code changes against the base branch '{baseBranch}'. The merge base commit is {mergeBaseSha}. Run `git diff {mergeBaseSha}` to inspect the changes.";

const BASE_BRANCH_PROMPT_FALLBACK =
  "Review the code changes against the base branch '{branch}'. Find the merge base (e.g., `git merge-base HEAD \"{branch}\"`), then run `git diff` against that SHA.";

const COMMIT_PROMPT_WITH_TITLE =
  'Review the code changes in commit {sha} ("{title}").';

const COMMIT_PROMPT = "Review the code changes in commit {sha}.";

const PULL_REQUEST_PROMPT =
  "Review pull request #{prNumber} (\"{title}\") against base branch '{baseBranch}'. Merge base is {mergeBaseSha}. Run `git diff {mergeBaseSha}` to inspect the changes.";

const PULL_REQUEST_PROMPT_FALLBACK =
  "Review pull request #{prNumber} (\"{title}\") against base branch '{baseBranch}'. Find the merge base (`git merge-base HEAD {baseBranch}`), then `git diff` against that SHA.";

const FOLDER_REVIEW_PROMPT =
  "Review the code in the following paths: {paths}. This is a snapshot review (not a diff). Read the files directly in these paths and provide prioritized, actionable findings.";

// Default review instructions when no REVIEW_GUIDELINES.md exists
const DEFAULT_REVIEW_INSTRUCTIONS = `# Review Guidelines

You are reviewing code changes made by another engineer.

## What to flag

Flag issues that:
1. Meaningfully impact correctness, performance, security, or maintainability.
2. Are discrete and actionable — one issue per finding, not vague concerns.
3. Don't demand rigor inconsistent with the rest of the codebase.
4. Were introduced in the changes being reviewed, not pre-existing problems.
5. The author would likely fix if aware of them.
6. Have provable impact on other parts of the code — don't speculate that a change may break something, identify the parts that are actually affected.
7. Are clearly not intentional changes by the author.

## Common vulnerability classes

Flag when any of these appear in the diff, even if the surrounding code has the same issues:
- **Memory safety**: use-after-free, double-free, uninitialized reads, buffer overflows, unsound \`unsafe\` blocks, lifetime issues in zero-copy parsing.
- **Integer issues**: overflow/truncation on cast, unchecked arithmetic in size calculations, off-by-one in bounds checks.
- **Untrusted input**: unvalidated input flowing into shell commands, file paths (path traversal), format strings, or serialization boundaries. Prefer escaping over sanitization.
- **Concurrency**: data races, missing synchronization, lock ordering violations, TOCTOU in filesystem operations.
- **Resource leaks**: unclosed handles/descriptors, missing cleanup on error paths, unbounded allocations from untrusted sizes.

## Review priorities

1. Call out newly added dependencies and explain why they're needed.
2. Prefer simple, direct solutions over wrappers or abstractions without clear value.
3. Favor fail-fast behavior; avoid logging-and-continue patterns that hide errors.
4. Prefer predictable behavior; crashing is better than silent degradation.
5. Ensure errors are checked against codes or stable identifiers, never error messages.

## Findings format

Tag each finding with a priority level:
- [P0] — Drop everything. Blocking. Only for universal issues that don't depend on assumptions about inputs.
- [P1] — Urgent. Should be addressed in the next cycle.
- [P2] — Normal. Fix eventually.
- [P3] — Low. Nice to have.

For each finding, include the priority tag, file path with line number, and a brief explanation (one paragraph max). Keep code snippets under 3 lines. Use a matter-of-fact tone — no flattery, no exaggeration.

Findings must reference locations that overlap with the actual diff. Ignore trivial style issues unless they obscure meaning. Don't stop at the first finding — list every qualifying issue.

End with an overall verdict: "correct" (no blocking issues) or "needs attention" (has P0/P1 issues).

If there are no qualifying findings, say the code looks good.`;

async function loadProjectReviewGuidelines(
  cwd: string,
): Promise<string | null> {
  let currentDir = path.resolve(cwd);

  while (true) {
    const piDir = path.join(currentDir, ".pi");
    const guidelinesPath = path.join(currentDir, "REVIEW_GUIDELINES.md");

    const piStats = await fs.stat(piDir).catch(() => null);
    if (piStats?.isDirectory()) {
      const guidelineStats = await fs.stat(guidelinesPath).catch(() => null);
      if (guidelineStats?.isFile()) {
        try {
          const content = await fs.readFile(guidelinesPath, "utf8");
          const trimmed = content.trim();
          return trimmed ? trimmed : null;
        } catch {
          return null;
        }
      }
      return null;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

async function getMergeBase(
  pi: ExtensionAPI,
  branch: string,
): Promise<string | null> {
  try {
    const { stdout: upstream, code: upstreamCode } = await pi.exec("git", [
      "rev-parse",
      "--abbrev-ref",
      `${branch}@{upstream}`,
    ]);

    if (upstreamCode === 0 && upstream.trim()) {
      const { stdout: mergeBase, code } = await pi.exec("git", [
        "merge-base",
        "HEAD",
        upstream.trim(),
      ]);
      if (code === 0 && mergeBase.trim()) {
        return mergeBase.trim();
      }
    }

    const { stdout: mergeBase, code } = await pi.exec("git", [
      "merge-base",
      "HEAD",
      branch,
    ]);
    if (code === 0 && mergeBase.trim()) {
      return mergeBase.trim();
    }

    return null;
  } catch {
    return null;
  }
}

async function getLocalBranches(pi: ExtensionAPI): Promise<string[]> {
  const { stdout, code } = await pi.exec("git", [
    "branch",
    "--format=%(refname:short)",
  ]);
  if (code !== 0) return [];
  return stdout
    .trim()
    .split("\n")
    .filter((b) => b.trim());
}

async function getRecentCommits(
  pi: ExtensionAPI,
  limit: number = 10,
): Promise<Array<{ sha: string; title: string }>> {
  const { stdout, code } = await pi.exec("git", [
    "log",
    "--oneline",
    `-n`,
    `${limit}`,
  ]);
  if (code !== 0) return [];

  return stdout
    .trim()
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [sha, ...rest] = line.trim().split(" ");
      return { sha, title: rest.join(" ") };
    });
}

async function hasUncommittedChanges(pi: ExtensionAPI): Promise<boolean> {
  const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
  return code === 0 && stdout.trim().length > 0;
}

function parsePrReference(ref: string): number | null {
  const trimmed = ref.trim();

  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num > 0) {
    return num;
  }

  const urlMatch = trimmed.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  if (urlMatch) {
    return parseInt(urlMatch[1], 10);
  }

  return null;
}

async function getPrInfo(
  pi: ExtensionAPI,
  prNumber: number,
): Promise<
  { baseBranch: string; title: string; headBranch: string } | { error: string }
> {
  const { stdout, stderr, code } = await pi.exec("gh", [
    "pr",
    "view",
    String(prNumber),
    "--json",
    "baseRefName,title,headRefName",
  ]);

  if (code !== 0) {
    const errorMsg = stderr?.trim() || stdout?.trim() || "Unknown error";
    return { error: errorMsg };
  }

  try {
    const data = JSON.parse(stdout);
    if (!data.baseRefName || !data.title || !data.headRefName) {
      return { error: "Unexpected response from gh: missing required fields" };
    }
    return {
      baseBranch: data.baseRefName,
      title: data.title,
      headBranch: data.headRefName,
    };
  } catch {
    return { error: "Failed to parse gh output as JSON" };
  }
}

async function checkoutPr(
  pi: ExtensionAPI,
  prNumber: number,
): Promise<{ success: boolean; error?: string }> {
  const { stdout, stderr, code } = await pi.exec("gh", [
    "pr",
    "checkout",
    String(prNumber),
  ]);

  if (code !== 0) {
    return {
      success: false,
      error: stderr || stdout || "Failed to checkout PR",
    };
  }

  return { success: true };
}

async function getCurrentBranch(pi: ExtensionAPI): Promise<string | null> {
  const { stdout, code } = await pi.exec("git", ["branch", "--show-current"]);
  if (code === 0 && stdout.trim()) {
    return stdout.trim();
  }
  return null;
}

async function getDefaultBranch(pi: ExtensionAPI): Promise<string> {
  const { stdout, code } = await pi.exec("git", [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "--short",
  ]);
  if (code === 0 && stdout.trim()) {
    return stdout.trim().replace("origin/", "");
  }

  const branches = await getLocalBranches(pi);
  if (branches.includes("main")) return "main";
  if (branches.includes("master")) return "master";

  return "main";
}

async function buildReviewPrompt(
  pi: ExtensionAPI,
  target: ReviewTarget,
): Promise<string> {
  switch (target.type) {
    case "uncommitted":
      return UNCOMMITTED_PROMPT;

    case "baseBranch": {
      const mergeBase = await getMergeBase(pi, target.branch);
      if (mergeBase) {
        return BASE_BRANCH_PROMPT_WITH_MERGE_BASE.replace(
          /{baseBranch}/g,
          target.branch,
        ).replace(/{mergeBaseSha}/g, mergeBase);
      }
      return BASE_BRANCH_PROMPT_FALLBACK.replace(/{branch}/g, target.branch);
    }

    case "commit":
      if (target.title) {
        return COMMIT_PROMPT_WITH_TITLE.replace("{sha}", target.sha).replace(
          "{title}",
          target.title,
        );
      }
      return COMMIT_PROMPT.replace("{sha}", target.sha);

    case "custom":
      return target.instructions;

    case "pullRequest": {
      const mergeBase = await getMergeBase(pi, target.baseBranch);
      if (mergeBase) {
        return PULL_REQUEST_PROMPT.replace(
          /{prNumber}/g,
          String(target.prNumber),
        )
          .replace(/{title}/g, target.title)
          .replace(/{baseBranch}/g, target.baseBranch)
          .replace(/{mergeBaseSha}/g, mergeBase);
      }
      return PULL_REQUEST_PROMPT_FALLBACK.replace(
        /{prNumber}/g,
        String(target.prNumber),
      )
        .replace(/{title}/g, target.title)
        .replace(/{baseBranch}/g, target.baseBranch);
    }

    case "folder":
      return FOLDER_REVIEW_PROMPT.replace("{paths}", target.paths.join(", "));
  }
}

function getUserFacingHint(target: ReviewTarget): string {
  switch (target.type) {
    case "uncommitted":
      return "current changes";
    case "baseBranch":
      return `changes against '${target.branch}'`;
    case "commit": {
      const shortSha = target.sha.slice(0, 7);
      return target.title
        ? `commit ${shortSha}: ${target.title}`
        : `commit ${shortSha}`;
    }
    case "custom":
      return target.instructions.length > 40
        ? target.instructions.slice(0, 37) + "..."
        : target.instructions;
    case "pullRequest": {
      const shortTitle =
        target.title.length > 30
          ? target.title.slice(0, 27) + "..."
          : target.title;
      return `PR #${target.prNumber}: ${shortTitle}`;
    }
    case "folder": {
      const joined = target.paths.join(", ");
      return joined.length > 40
        ? `folders: ${joined.slice(0, 37)}...`
        : `folders: ${joined}`;
    }
  }
}

const REVIEW_PRESETS = [
  {
    value: "pullRequest",
    label: "Review a pull request",
    description: "(GitHub PR)",
  },
  {
    value: "baseBranch",
    label: "Review against a base branch",
    description: "(local)",
  },
  {
    value: "uncommitted",
    label: "Review uncommitted changes",
    description: "",
  },
  { value: "commit", label: "Review a commit", description: "" },
  {
    value: "folder",
    label: "Review a folder (or more)",
    description: "(snapshot, not diff)",
  },
  { value: "custom", label: "Custom review instructions", description: "" },
] as const;

export default function reviewExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    syncReviewWidget(ctx);
  });

  pi.on("session_switch", (_event, ctx) => {
    syncReviewWidget(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    syncReviewWidget(ctx);
  });

  async function getSmartDefault(): Promise<
    "uncommitted" | "baseBranch" | "commit"
  > {
    if (await hasUncommittedChanges(pi)) {
      return "uncommitted";
    }

    const currentBranch = await getCurrentBranch(pi);
    const defaultBranch = await getDefaultBranch(pi);
    if (currentBranch && currentBranch !== defaultBranch) {
      return "baseBranch";
    }

    return "commit";
  }

  async function showReviewSelector(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const smartDefault = await getSmartDefault();
    const items: SelectItem[] = REVIEW_PRESETS.map((preset) => ({
      value: preset.value,
      label: preset.label,
      description: preset.description,
    }));
    const smartDefaultIndex = items.findIndex(
      (item) => item.value === smartDefault,
    );

    while (true) {
      const result = await ctx.ui.custom<string | null>(
        (tui, theme, _kb, done) => {
          const container = new Container();
          container.addChild(
            new DynamicBorder((str) => theme.fg("accent", str)),
          );
          container.addChild(
            new Text(theme.fg("accent", theme.bold("Select a review preset"))),
          );

          const selectList = new SelectList(items, Math.min(items.length, 10), {
            selectedPrefix: (text) => theme.fg("accent", text),
            selectedText: (text) => theme.fg("accent", text),
            description: (text) => theme.fg("muted", text),
            scrollInfo: (text) => theme.fg("dim", text),
            noMatch: (text) => theme.fg("warning", text),
          });

          if (smartDefaultIndex >= 0) {
            selectList.setSelectedIndex(smartDefaultIndex);
          }
          selectList.onSelect = (item) => done(item.value);
          selectList.onCancel = () => done(null);

          container.addChild(selectList);
          container.addChild(
            new Text(
              theme.fg("dim", "Press enter to confirm or esc to go back"),
            ),
          );
          container.addChild(
            new DynamicBorder((str) => theme.fg("accent", str)),
          );

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
        },
      );

      if (!result) return null;

      switch (result) {
        case "uncommitted":
          return { type: "uncommitted" };

        case "baseBranch": {
          const target = await showBranchSelector(ctx);
          if (target) return target;
          break;
        }

        case "commit": {
          const target = await showCommitSelector(ctx);
          if (target) return target;
          break;
        }

        case "custom": {
          const target = await showCustomInput(ctx);
          if (target) return target;
          break;
        }

        case "pullRequest": {
          const target = await showPrInput(ctx);
          if (target) return target;
          break;
        }

        case "folder": {
          const target = await showFolderInput(ctx);
          if (target) return target;
          break;
        }
        default:
          return null;
      }
    }
  }

  async function showBranchSelector(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const branches = await getLocalBranches(pi);
    const currentBranch = await getCurrentBranch(pi);
    const defaultBranch = await getDefaultBranch(pi);

    // Filter out current branch — reviewing against yourself is meaningless
    const candidateBranches = currentBranch
      ? branches.filter((b) => b !== currentBranch)
      : branches;

    if (candidateBranches.length === 0) {
      ctx.ui.notify(
        currentBranch
          ? `No other branches found (current branch: ${currentBranch})`
          : "No branches found",
        "error",
      );
      return null;
    }

    const sortedBranches = candidateBranches.sort((a, b) => {
      if (a === defaultBranch) return -1;
      if (b === defaultBranch) return 1;
      return a.localeCompare(b);
    });

    const items: SelectItem[] = sortedBranches.map((branch) => ({
      value: branch,
      label: branch,
      description: branch === defaultBranch ? "(default)" : "",
    }));

    const result = await ctx.ui.custom<string | null>(
      (tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
        container.addChild(
          new Text(theme.fg("accent", theme.bold("Select base branch"))),
        );

        const selectList = new SelectList(items, Math.min(items.length, 10), {
          selectedPrefix: (text) => theme.fg("accent", text),
          selectedText: (text) => theme.fg("accent", text),
          description: (text) => theme.fg("muted", text),
          scrollInfo: (text) => theme.fg("dim", text),
          noMatch: (text) => theme.fg("warning", text),
        });

        selectList.searchable = true;
        selectList.onSelect = (item) => done(item.value);
        selectList.onCancel = () => done(null);

        container.addChild(selectList);
        container.addChild(
          new Text(
            theme.fg("dim", "Type to filter • enter to select • esc to cancel"),
          ),
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
      },
    );

    if (!result) return null;
    return { type: "baseBranch", branch: result };
  }

  async function showCommitSelector(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const commits = await getRecentCommits(pi, 20);

    if (commits.length === 0) {
      ctx.ui.notify("No commits found", "error");
      return null;
    }

    const items: SelectItem[] = commits.map((commit) => ({
      value: commit.sha,
      label: `${commit.sha.slice(0, 7)} ${commit.title}`,
      description: "",
    }));

    const result = await ctx.ui.custom<{ sha: string; title: string } | null>(
      (tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
        container.addChild(
          new Text(theme.fg("accent", theme.bold("Select commit to review"))),
        );

        const selectList = new SelectList(items, Math.min(items.length, 10), {
          selectedPrefix: (text) => theme.fg("accent", text),
          selectedText: (text) => theme.fg("accent", text),
          description: (text) => theme.fg("muted", text),
          scrollInfo: (text) => theme.fg("dim", text),
          noMatch: (text) => theme.fg("warning", text),
        });

        selectList.searchable = true;
        selectList.onSelect = (item) => {
          const commit = commits.find((c) => c.sha === item.value);
          done(commit ?? null);
        };
        selectList.onCancel = () => done(null);

        container.addChild(selectList);
        container.addChild(
          new Text(
            theme.fg("dim", "Type to filter • enter to select • esc to cancel"),
          ),
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
      },
    );

    if (!result) return null;
    return { type: "commit", sha: result.sha, title: result.title };
  }

  async function showCustomInput(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const result = await ctx.ui.editor(
      "Enter review instructions:",
      "Review the code for security vulnerabilities and potential bugs...",
    );

    if (!result?.trim()) return null;
    return { type: "custom", instructions: result.trim() };
  }

  function parseReviewPaths(value: string): string[] {
    return value
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  async function showFolderInput(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const result = await ctx.ui.editor(
      "Enter folders/files to review (space-separated or one per line):",
      ".",
    );

    if (!result?.trim()) return null;
    const paths = parseReviewPaths(result);
    if (paths.length === 0) return null;

    return { type: "folder", paths };
  }

  async function showPrInput(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const prRef = await ctx.ui.editor(
      "Enter PR number or URL (e.g. 123 or https://github.com/owner/repo/pull/123):",
      "",
    );

    if (!prRef?.trim()) return null;

    const prNumber = parsePrReference(prRef);
    if (!prNumber) {
      ctx.ui.notify(
        "Invalid PR reference. Enter a number or GitHub PR URL.",
        "error",
      );
      return null;
    }

    ctx.ui.notify(`Fetching PR #${prNumber} info...`, "info");
    const prInfoResult = await getPrInfo(pi, prNumber);

    if ("error" in prInfoResult) {
      ctx.ui.notify(
        `Failed to get PR #${prNumber}: ${prInfoResult.error}`,
        "error",
      );
      return null;
    }

    // Note: We don't pre-check for uncommitted changes here. That would be a TOCTOU race
    // condition - changes could appear between our check and the actual checkout.
    // Instead, we let `gh pr checkout` fail atomically and report the actual error.
    ctx.ui.notify(`Checking out PR #${prNumber}...`, "info");
    const checkoutResult = await checkoutPr(pi, prNumber);

    if (!checkoutResult.success) {
      ctx.ui.notify(`Failed to checkout PR: ${checkoutResult.error}`, "error");
      return null;
    }

    ctx.ui.notify(
      `Checked out PR #${prNumber} (${prInfoResult.headBranch})`,
      "info",
    );

    return {
      type: "pullRequest",
      prNumber,
      baseBranch: prInfoResult.baseBranch,
      title: prInfoResult.title,
    };
  }

  async function executeReview(
    ctx: ExtensionCommandContext,
    target: ReviewTarget,
    useFreshSession: boolean,
  ): Promise<void> {
    if (getReviewOriginId(ctx)) {
      ctx.ui.notify(
        "Already in a review. Use /end-review to finish first.",
        "warning",
      );
      return;
    }

    if (useFreshSession) {
      const originId = ctx.sessionManager.getLeafId() ?? undefined;
      if (!originId) {
        ctx.ui.notify(
          "Failed to determine review origin. Try again from a session with messages.",
          "error",
        );
        return;
      }

      const entries = ctx.sessionManager.getEntries();
      const firstUserMessage = entries.find(
        (e) => e.type === "message" && e.message.role === "user",
      );

      if (!firstUserMessage) {
        ctx.ui.notify("No user message found in session", "error");
        return;
      }

      try {
        const result = await ctx.navigateTree(firstUserMessage.id, {
          summarize: false,
          label: "code-review",
        });
        if (result.cancelled) {
          return;
        }
      } catch (error) {
        ctx.ui.notify(
          `Failed to start review: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return;
      }

      ctx.ui.setEditorText("");
      // Store the review state in session - this is the single source of truth
      pi.appendEntry(REVIEW_STATE_TYPE, { active: true, originId });
      setReviewWidget(ctx, true);
    }

    const prompt = await buildReviewPrompt(pi, target);
    const hint = getUserFacingHint(target);
    const projectGuidelines = await loadProjectReviewGuidelines(ctx.cwd);

    const instructions = projectGuidelines ?? DEFAULT_REVIEW_INSTRUCTIONS;
    const defaultPrompt = `${instructions}\n\n---\n\n${prompt}`;

    // Let the user edit the review instructions before sending
    const editedPrompt = await ctx.ui.editor(
      "Review instructions (edit or replace, then confirm):",
      defaultPrompt,
    );

    if (!editedPrompt?.trim()) {
      ctx.ui.notify("Review cancelled (empty instructions)", "info");
      return;
    }

    const fullPrompt = editedPrompt.trim();

    const modeHint = useFreshSession ? " (fresh session)" : "";
    ctx.ui.notify(`Starting review: ${hint}${modeHint}`, "info");

    pi.sendUserMessage(fullPrompt);
  }

  function parseArgs(
    args: string | undefined,
  ): ReviewTarget | { type: "pr"; ref: string } | null {
    if (!args?.trim()) return null;

    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

    switch (subcommand) {
      case "uncommitted":
        return { type: "uncommitted" };

      case "branch": {
        const branch = parts[1];
        if (!branch) return null;
        return { type: "baseBranch", branch };
      }

      case "commit": {
        const sha = parts[1];
        if (!sha) return null;
        const title = parts.slice(2).join(" ") || undefined;
        return { type: "commit", sha, title };
      }

      case "custom": {
        const instructions = parts.slice(1).join(" ");
        if (!instructions) return null;
        return { type: "custom", instructions };
      }

      case "folder": {
        const paths = parseReviewPaths(parts.slice(1).join(" "));
        if (paths.length === 0) return null;
        return { type: "folder", paths };
      }
      case "pr": {
        const ref = parts[1];
        if (!ref) return null;
        return { type: "pr", ref };
      }

      default:
        return null;
    }
  }

  async function handlePrCheckout(
    ctx: ExtensionContext,
    ref: string,
  ): Promise<ReviewTarget | null> {
    const prNumber = parsePrReference(ref);
    if (!prNumber) {
      ctx.ui.notify(
        "Invalid PR reference. Enter a number or GitHub PR URL.",
        "error",
      );
      return null;
    }

    ctx.ui.notify(`Fetching PR #${prNumber} info...`, "info");
    const prInfoResult = await getPrInfo(pi, prNumber);

    if ("error" in prInfoResult) {
      ctx.ui.notify(
        `Failed to get PR #${prNumber}: ${prInfoResult.error}`,
        "error",
      );
      return null;
    }

    // Note: We don't pre-check for uncommitted changes here. That would be a TOCTOU race
    // condition - changes could appear between our check and the actual checkout.
    // Instead, we let `gh pr checkout` fail atomically and report the actual error.
    ctx.ui.notify(`Checking out PR #${prNumber}...`, "info");
    const checkoutResult = await checkoutPr(pi, prNumber);

    if (!checkoutResult.success) {
      ctx.ui.notify(`Failed to checkout PR: ${checkoutResult.error}`, "error");
      return null;
    }

    ctx.ui.notify(
      `Checked out PR #${prNumber} (${prInfoResult.headBranch})`,
      "info",
    );

    return {
      type: "pullRequest",
      prNumber,
      baseBranch: prInfoResult.baseBranch,
      title: prInfoResult.title,
    };
  }

  pi.registerCommand("review", {
    description:
      "Review code changes (PR, uncommitted, branch, commit, folder, or custom)",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Review requires interactive mode", "error");
        return;
      }

      if (getReviewOriginId(ctx)) {
        ctx.ui.notify(
          "Already in a review. Use /end-review to finish first.",
          "warning",
        );
        return;
      }

      const { code } = await pi.exec("git", ["rev-parse", "--git-dir"]);
      if (code !== 0) {
        ctx.ui.notify("Not a git repository", "error");
        return;
      }

      let target: ReviewTarget | null = null;
      let fromSelector = false;
      const parsed = parseArgs(args);

      if (parsed) {
        if (parsed.type === "pr") {
          target = await handlePrCheckout(ctx, parsed.ref);
          if (!target) {
            ctx.ui.notify(
              "PR review failed. Returning to review menu.",
              "warning",
            );
          }
        } else {
          target = parsed;
        }
      }

      if (!target) {
        fromSelector = true;
      }

      while (true) {
        if (!target && fromSelector) {
          target = await showReviewSelector(ctx);
        }

        if (!target) {
          ctx.ui.notify("Review cancelled", "info");
          return;
        }

        const entries = ctx.sessionManager.getEntries();
        const messageCount = entries.filter((e) => e.type === "message").length;

        let useFreshSession = false;

        if (messageCount > 0) {
          const choice = await ctx.ui.select("Start review in:", [
            "Empty branch",
            "Current session",
          ]);

          if (choice === undefined) {
            if (fromSelector) {
              target = null;
              continue;
            }
            ctx.ui.notify("Review cancelled", "info");
            return;
          }

          useFreshSession = choice === "Empty branch";
        }

        await executeReview(ctx, target, useFreshSession);
        return;
      }
    },
  });

  const REVIEW_SUMMARY_PROMPT = `We are switching to a coding session to continue working on the code.
Create a structured summary of this review branch for context when returning later.

Summarize the code review that was performed:

1. What was reviewed (files, changes, scope)
2. Key findings and their priority levels
3. The overall verdict
4. Any action items or recommendations

Append a message with this format at the end:

## Next Steps
1. [What should happen next to act on the review]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Code Review Findings

[Priority] Short Title

File: path/to/file.ext:line_number

\`\`\`
affected code snippet
\`\`\`

Preserve exact file paths, function names, and error messages.
`;

  const REVIEW_FIX_FINDINGS_PROMPT = `Use the latest review summary in this session and implement the review findings now.

Instructions:
1. Treat the summary's Findings/Fix Queue as a checklist.
2. Fix in priority order: P0, P1, then P2 (include P3 if quick and safe).
3. If a finding is invalid/already fixed/not possible right now, briefly explain why and continue.
4. Run relevant tests/checks for touched code where practical.
5. End with: fixed items, deferred/skipped items (with reasons), and verification results.`;

  function clearReviewState(ctx: ExtensionContext) {
    setReviewWidget(ctx, false);
    pi.appendEntry(REVIEW_STATE_TYPE, { active: false });
  }

  async function navigateBackWithSummary(
    ctx: ExtensionCommandContext,
    originId: string,
  ): Promise<boolean> {
    const result = await ctx.ui.custom<{
      cancelled: boolean;
      error?: string;
    } | null>((tui, theme, _kb, done) => {
      const loader = new BorderedLoader(
        tui,
        theme,
        "Returning and summarizing review branch...",
      );
      loader.onAbort = () => done(null);

      ctx
        .navigateTree(originId, {
          summarize: true,
          customInstructions: REVIEW_SUMMARY_PROMPT,
          replaceInstructions: true,
        })
        .then(done)
        .catch((err) =>
          done({
            cancelled: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );

      return loader;
    });

    if (result === null) {
      ctx.ui.notify(
        "Summarization cancelled. Use /end-review to try again.",
        "info",
      );
      return false;
    }

    if (result.error) {
      ctx.ui.notify(`Summarization failed: ${result.error}`, "error");
      return false;
    }

    if (result.cancelled) {
      ctx.ui.notify(
        "Navigation cancelled. Use /end-review to try again.",
        "info",
      );
      return false;
    }

    return true;
  }

  pi.registerCommand("end-review", {
    description: "Complete review and return to original position",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("End-review requires interactive mode", "error");
        return;
      }

      if (endReviewInProgress) {
        ctx.ui.notify("/end-review is already running", "info");
        return;
      }

      const reviewOriginId = getReviewOriginId(ctx);
      if (!reviewOriginId) {
        const state = getReviewState(ctx);
        if (state?.active) {
          // Active review but missing origin info - clear the invalid state
          setReviewWidget(ctx, false);
          pi.appendEntry(REVIEW_STATE_TYPE, { active: false });
          ctx.ui.notify(
            "Review state was missing origin info; cleared review status.",
            "warning",
          );
          return;
        }
        ctx.ui.notify(
          "Not in a review branch (use /review first, or review was started in current session mode)",
          "info",
        );
        return;
      }

      endReviewInProgress = true;
      try {
        const choice = await ctx.ui.select("Finish review:", [
          "Return only",
          "Return and fix findings",
          "Return and summarize",
        ]);

        if (choice === undefined) {
          ctx.ui.notify("Cancelled. Use /end-review to try again.", "info");
          return;
        }

        if (choice === "Return only") {
          try {
            const result = await ctx.navigateTree(reviewOriginId, {
              summarize: false,
            });

            if (result.cancelled) {
              ctx.ui.notify(
                "Navigation cancelled. Use /end-review to try again.",
                "info",
              );
              return;
            }
          } catch (error) {
            ctx.ui.notify(
              `Failed to return: ${error instanceof Error ? error.message : String(error)}`,
              "error",
            );
            return;
          }

          clearReviewState(ctx);
          ctx.ui.notify(
            "Review complete! Returned to original position.",
            "info",
          );
          return;
        }

        // Both "Return and summarize" and "Return and fix findings" need summarization
        const success = await navigateBackWithSummary(ctx, reviewOriginId);
        if (!success) return;

        clearReviewState(ctx);

        if (choice === "Return and summarize") {
          if (!ctx.ui.getEditorText().trim()) {
            ctx.ui.setEditorText("Act on the review findings");
          }
          ctx.ui.notify("Review complete! Returned and summarized.", "info");
        } else {
          // "Return and fix findings"
          pi.sendUserMessage(REVIEW_FIX_FINDINGS_PROMPT);
          ctx.ui.notify(
            "Review complete! Returned and queued a follow-up to fix findings.",
            "info",
          );
        }
      } finally {
        endReviewInProgress = false;
      }
    },
  });
}