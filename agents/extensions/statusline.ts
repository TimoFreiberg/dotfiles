/**
 * Statusline Extension
 *
 * Replaces pi's default 2-line footer with a single-line Claude Code-style
 * statusline, modeled after ~/dotfiles/claude/statusline.sh.
 *
 * Shape:
 *   /(◉ᴗᴗ◉)\ | dotfiles | Opus 4.6 ·xhigh | main | 42% | $0.42
 *
 * The Thia kaomoji only appears when THIANIA_ROLE env var is set (stock pi
 * leaves it unset).
 *
 * Context % colors by threshold; context window size is shown in dim next to
 * it (e.g. `42%/200k`, `?/200k` right after compaction).
 *   <30%  success (green)
 *   ≥30%  warning (yellow)
 *   ≥50%  ANSI 256 color 208 (orange; no matching theme slot)
 *   ≥70%  error (red)
 *
 * VCS: jj bookmark preferred, falls back to git branch (via footerData).
 * No dirty marker. Refreshed on session_start / turn_start / turn_end —
 * no file-system watcher, so the bookmark can lag if you mutate the repo
 * outside the agent mid-session.
 *
 * Extension statuses set via ctx.ui.setStatus() are preserved on a second
 * line when any are set (pi default behavior).
 */

import { execFile } from "node:child_process";
import { basename } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type TUI,
} from "@earendil-works/pi-tui";

// ── helpers ──────────────────────────────────────────────────────────────

type VcsKind = "jj" | "git";
type VcsInfo = { kind: VcsKind; bookmark: string } | null;

const VCS_TIMEOUT_MS = 2000;

function tryJj(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "jj",
      [
        "log",
        "-R",
        cwd,
        "--no-graph",
        "-r",
        "latest(ancestors(@) & bookmarks())",
        "-T",
        "bookmarks",
        "--limit",
        "1",
      ],
      { timeout: VCS_TIMEOUT_MS },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const bookmark = stdout.split("\n")[0]?.trim();
        resolve(bookmark || null);
      },
    );
  });
}

function tryGit(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      [
        "-C",
        cwd,
        "--no-optional-locks",
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ],
      { timeout: VCS_TIMEOUT_MS },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const branch = stdout.trim();
        resolve(branch || null);
      },
    );
  });
}

async function detectVcs(cwd: string): Promise<VcsInfo> {
  const jjBranch = await tryJj(cwd);
  if (jjBranch !== null) return { kind: "jj", bookmark: jjBranch };
  const gitBranch = await tryGit(cwd);
  if (gitBranch !== null) return { kind: "git", bookmark: gitBranch };
  return null;
}

// "anthropic/claude-opus-4-6" → "Opus 4.6", "sonnet-4-5-20250929" → "Sonnet 4.5"
function friendlyModel(modelId: string | undefined): string {
  if (!modelId) return "no-model";
  const m = modelId.match(/(opus|sonnet|haiku)-(\d+)-?(\d+)?/i);
  if (!m || !m[1] || !m[2]) return modelId;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  return m[3] ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`;
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

function colorPct(pct: number, display: string, theme: Theme): string {
  if (pct >= 70) return theme.fg("error", display);
  // ANSI 256 color 208 is a saturated orange. No theme slot matches — theme
  // colors skip straight from warning (yellow) to error (red).
  if (pct >= 50) return `\x1b[38;5;208m${display}\x1b[0m`;
  if (pct >= 30) return theme.fg("warning", display);
  return theme.fg("success", display);
}

function aggregateCost(ctx: ExtensionContext): number {
  let cost = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      cost += (entry.message as AssistantMessage).usage.cost.total;
    }
  }
  return cost;
}

// Match pi's default footer sanitizer so a multi-line setStatus() call doesn't
// break layout on our second line.
function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

// ── extension ────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let vcsInfo: VcsInfo = null;
  let refreshInFlight = false;
  let currentTui: TUI | null = null;
  const harnessRole = process.env.THIANIA_ROLE;

  async function refreshVcs(cwd: string): Promise<void> {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const next = await detectVcs(cwd);
      const changed =
        next?.kind !== vcsInfo?.kind || next?.bookmark !== vcsInfo?.bookmark;
      vcsInfo = next;
      if (changed) currentTui?.requestRender();
    } finally {
      refreshInFlight = false;
    }
  }

  function renderStatus(
    width: number,
    ctx: ExtensionContext,
    theme: Theme,
    footerData: ReadonlyFooterDataProvider,
  ): string[] {
    const parts: string[] = [];

    // 1. Harness marker (only when THIANIA_ROLE set).
    if (harnessRole) {
      parts.push(theme.fg("accent", "/(◉ᴗᴗ◉)\\"));
    }

    // 2. cwd basename.
    const cwd = ctx.sessionManager.getCwd();
    const dirName = basename(cwd) || cwd;
    parts.push(theme.fg("dim", dirName));

    // 3. Model name + thinking level (only when model supports reasoning).
    const modelName = friendlyModel(ctx.model?.id);
    let modelPart = theme.fg("accent", modelName);
    if (ctx.model?.reasoning) {
      const level = pi.getThinkingLevel();
      modelPart += theme.fg("dim", ` ·${level}`);
    }
    parts.push(modelPart);

    // 4. VCS bookmark. Prefer our locally detected value (jj or git); fall
    //    back to footerData's git branch (which has a file-system watcher)
    //    if our async refresh hasn't landed yet.
    const bookmark = vcsInfo?.bookmark ?? footerData.getGitBranch();
    if (bookmark) {
      parts.push(theme.fg("success", bookmark));
    }

    // 5. Context percentage / window size (percent colored by threshold,
    //    window size dimmed).
    const ctxUsage = ctx.getContextUsage();
    if (ctxUsage) {
      const windowStr = formatTokens(ctxUsage.contextWindow);
      if (ctxUsage.percent != null) {
        const pctStr = `${Math.round(ctxUsage.percent)}%`;
        parts.push(
          `${colorPct(ctxUsage.percent, pctStr, theme)}${theme.fg("dim", `/${windowStr}`)}`,
        );
      } else {
        parts.push(theme.fg("dim", `?/${windowStr}`));
      }
    }

    // 6. Session cost.
    const cost = aggregateCost(ctx);
    if (cost > 0) {
      parts.push(theme.fg("success", `$${cost.toFixed(2)}`));
    }

    const sep = theme.fg("dim", " | ");
    let line = parts.join(sep);
    if (visibleWidth(line) > width) {
      line = truncateToWidth(line, width, theme.fg("dim", "..."));
    }

    const lines = [line];

    // Preserve pi's default extension-status rendering on a 2nd line.
    const statuses = footerData.getExtensionStatuses();
    if (statuses.size > 0) {
      const sorted = Array.from(statuses.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, text]) => sanitizeStatusText(text));
      const statusLine = sorted.join(" ");
      lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
    }

    return lines;
  }

  pi.on("session_start", async (_event, ctx) => {
    void refreshVcs(ctx.sessionManager.getCwd()).catch(() => {});

    ctx.ui.setFooter((tui, theme, footerData) => {
      currentTui = tui;
      const unsub = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: () => {
          unsub();
          if (currentTui === tui) currentTui = null;
        },
        invalidate() {},
        render(width: number): string[] {
          return renderStatus(width, ctx, theme, footerData);
        },
      };
    });
  });

  pi.on("turn_start", async (_event, ctx) => {
    void refreshVcs(ctx.sessionManager.getCwd()).catch(() => {});
  });

  pi.on("turn_end", async (_event, ctx) => {
    void refreshVcs(ctx.sessionManager.getCwd()).catch(() => {});
  });
}
