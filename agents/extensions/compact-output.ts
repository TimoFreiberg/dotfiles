/**
 * Compact Tool Output Extension
 *
 * Makes tool output minimal in the default (collapsed) view:
 * a single line showing the tool name, args, and line count.
 * Ctrl+O still shows the full expanded output.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  createReadTool,
  createBashTool,
  createWriteTool,
  keyHint,
  highlightCode,
  getLanguageFromPath,
  formatSize,
  DEFAULT_MAX_BYTES,
} from "@mariozechner/pi-coding-agent";
import { Text, Container } from "@mariozechner/pi-tui";
import { relative } from "path";

// ── helpers ─────────────────────────────────────────────────────────

function shortenPath(path: string, cwd: string): string {
  if (!path) return path;
  const clean = path.startsWith("@") ? path.slice(1) : path;
  try {
    const rel = relative(cwd, clean);
    if (rel && !rel.startsWith("../../../") && rel.length < clean.length)
      return rel;
  } catch {}
  return clean;
}

function replaceTabs(s: string): string {
  return s.replace(/\t/g, "  ");
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Strip a leading `cd <cwd> && ` or `cd <cwd>;` no-op prefix from bash commands. */
function stripCdPrefix(command: string, cwd: string): string {
  // Match: cd /exact/cwd && rest  or  cd '/exact/cwd' && rest  (with optional quotes/semicolons)
  const escaped = cwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^cd\\s+['"]?${escaped}['"]?\\s*(?:&&|;)\\s*`);
  return command.replace(re, "");
}

function pathDisplay(rawPath: string | null, cwd: string, theme: any): string {
  if (rawPath === null) return theme.fg("toolOutput", "...");
  if (!rawPath) return theme.fg("toolOutput", "...");
  return theme.fg("accent", shortenPath(rawPath, cwd));
}

function getTextOutput(result: any): string {
  if (!result) return "";
  const textBlocks =
    result.content?.filter((c: any) => c.type === "text") || [];
  return textBlocks
    .map((c: any) => (c.text || "").replace(/\r/g, ""))
    .join("\n");
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

/** Build fully styled code string with syntax highlighting. */
function buildStyledCode(
  code: string,
  filePath: string | null,
  theme: any,
): string {
  const lang = filePath ? getLanguageFromPath(filePath) : undefined;
  const cleaned = replaceTabs(code);
  const lines = lang ? highlightCode(cleaned, lang) : cleaned.split("\n");
  return lines
    .map((line: string) => (lang ? line : theme.fg("toolOutput", line)))
    .join("\n");
}

/** Build the expand hint suffix: " — 42 lines (ctrl+o to expand)" */
function expandSuffix(
  lineCount: number,
  theme: any,
  warningText?: string,
): string {
  let s =
    theme.fg("muted", ` — ${lineCount} line${lineCount !== 1 ? "s" : ""} (`) +
    keyHint("app.tools.expand", "to expand") +
    theme.fg("muted", ")");
  if (warningText) s += " " + warningText;
  return s;
}

function renderTruncationWarning(result: any, theme: any): string {
  const t = result.details?.truncation;
  if (!t?.truncated) return "";
  if (t.firstLineExceedsLimit) {
    return theme.fg(
      "warning",
      `[First line exceeds ${formatSize(t.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`,
    );
  }
  if (t.truncatedBy === "lines") {
    return theme.fg(
      "warning",
      `[Truncated: ${t.outputLines} of ${t.totalLines} lines]`,
    );
  }
  return theme.fg(
    "warning",
    `[Truncated: ${t.outputLines} lines (${formatSize(t.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`,
  );
}

/**
 * Create a lazy renderable whose text is built by `buildLine()` at render time.
 * This lets renderCall's component pick up info set later by renderResult.
 */
function lazyLine(buildLine: () => string): any {
  const inner = new Text("", 0, 0);
  return {
    _cachedPrefix: undefined as string | undefined,
    render(width: number): string[] {
      inner.setText(buildLine());
      return inner.render(width);
    },
    invalidate() {
      inner.invalidate();
    },
  };
}

/**
 * Return context.lastComponent if it's a lazyLine with a matching prefix,
 * otherwise create a fresh one. The lazy closure captures `state` by
 * reference so suffix updates from renderResult are picked up at paint time.
 */
function cachedLazyLine(prefix: string, state: any, context: any): any {
  const existing = context.lastComponent;
  if (existing && existing._cachedPrefix === prefix) {
    return existing;
  }
  const comp = lazyLine(() => prefix + (state.resultSuffix || ""));
  comp._cachedPrefix = prefix;
  return comp;
}

// ── extension ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();

  // Only override read, write, bash, and grep with compact rendering.
  // ls and find are left as built-in tools to avoid unnecessary
  // tool registrations (saves tokens in the tool schema).

  // For the single-line collapsed view, renderResult stores a suffix string
  // in context.state and returns an empty Container. The renderCall component
  // is a lazy renderable that reads the suffix at paint time (after renderResult
  // has set it).

  // --- read -----------------------------------------------------------
  const builtinRead = createReadTool(cwd);
  pi.registerTool({
    ...builtinRead,
    // Spread breaks reference equality so tool-execution.ts picks up our custom renderers
    parameters: { ...builtinRead.parameters },
    renderCall(args: any, theme: any, context: any) {
      context.state.resultSuffix = "";
      const rawPath = str(args?.file_path ?? args?.path);
      const offset = args?.offset;
      const limit = args?.limit;

      let pd = pathDisplay(rawPath, cwd, theme);
      if (offset !== undefined || limit !== undefined) {
        const s = offset ?? 1;
        const e = limit !== undefined ? s + limit - 1 : "";
        pd += theme.fg("warning", `:${s}${e ? `-${e}` : ""}`);
      }
      const prefix = `${theme.fg("toolTitle", theme.bold("read"))} ${pd}`;
      return cachedLazyLine(prefix, context.state, context);
    },
    renderResult(
      result: any,
      { expanded, isPartial }: any,
      theme: any,
      context: any,
    ) {
      if (isPartial) {
        context.state.resultSuffix = "";
        return new Container();
      }
      const output = getTextOutput(result);
      if (result.isError) {
        context.state.resultSuffix = "";
        return new Text(theme.fg("error", output), 0, 0);
      }
      if (!output) {
        context.state.resultSuffix = "";
        return new Container();
      }

      const rawPath = str(context.args?.file_path ?? context.args?.path);
      const warning = renderTruncationWarning(result, theme);

      if (expanded) {
        context.state.resultSuffix = "";
        let text = "\n\n" + buildStyledCode(output, rawPath, theme);
        if (warning) text += "\n" + warning;
        return new Text(text, 0, 0);
      }

      // Collapsed: set suffix for the lazy header line
      context.state.resultSuffix = expandSuffix(
        countLines(output),
        theme,
        warning || undefined,
      );
      return new Container();
    },
  });

  // --- write ----------------------------------------------------------
  const builtinWrite = createWriteTool(cwd);
  pi.registerTool({
    ...builtinWrite,
    // Spread breaks reference equality so tool-execution.ts picks up our custom renderers
    parameters: { ...builtinWrite.parameters },
    renderCall(args: any, theme: any, context: any) {
      context.state.resultSuffix = "";
      const rawPath = str(args?.file_path ?? args?.path);
      const pd = pathDisplay(rawPath, cwd, theme);
      const prefix = `${theme.fg("toolTitle", theme.bold("write"))} ${pd}`;
      return cachedLazyLine(prefix, context.state, context);
    },
    renderResult(
      result: any,
      { expanded, isPartial }: any,
      theme: any,
      context: any,
    ) {
      if (isPartial) {
        context.state.resultSuffix = "";
        return new Container();
      }
      if (result.isError) {
        context.state.resultSuffix = "";
        return new Text(theme.fg("error", getTextOutput(result)), 0, 0);
      }

      const rawPath = str(context.args?.file_path ?? context.args?.path);
      const fileContent = str(context.args?.content);

      if (!fileContent) {
        context.state.resultSuffix = "";
        const output = getTextOutput(result);
        return output
          ? new Text(theme.fg("toolOutput", output), 0, 0)
          : new Container();
      }

      if (expanded) {
        context.state.resultSuffix = "";
        return new Text(
          "\n\n" + buildStyledCode(fileContent, rawPath, theme),
          0,
          0,
        );
      }

      context.state.resultSuffix = expandSuffix(countLines(fileContent), theme);
      return new Container();
    },
  });

  // --- bash -----------------------------------------------------------
  const builtinBash = createBashTool(cwd);
  pi.registerTool({
    ...builtinBash,
    // Spread breaks reference equality so tool-execution.ts picks up our custom renderers
    parameters: { ...builtinBash.parameters },
    renderCall(args: any, theme: any, context: any) {
      context.state.resultSuffix = "";
      const raw = str(args?.command);
      const command = raw ? stripCdPrefix(raw, cwd) : raw;
      const timeout = args?.timeout;
      const tsuf = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
      const cd = command ? command : theme.fg("toolOutput", "...");
      const prefix = theme.fg("toolTitle", theme.bold(`$ ${cd}`)) + tsuf;
      return cachedLazyLine(prefix, context.state, context);
    },
    renderResult(
      result: any,
      { expanded, isPartial }: any,
      theme: any,
      context: any,
    ) {
      if (isPartial) {
        context.state.resultSuffix = "";
        return new Container();
      }
      const output = getTextOutput(result).trim();
      if (!output) {
        context.state.resultSuffix = "";
        return new Container();
      }

      if (expanded) {
        context.state.resultSuffix = "";
        const styled = output
          .split("\n")
          .map((l: string) => theme.fg("toolOutput", l))
          .join("\n");
        let text = `\n${styled}`;
        const tr = result.details?.truncation;
        const fp = result.details?.fullOutputPath;
        if (tr?.truncated || fp) {
          const w: string[] = [];
          if (fp) w.push(`Full output: ${fp}`);
          if (tr?.truncated) w.push("output truncated");
          text += `\n${theme.fg("warning", `[${w.join(". ")}]`)}`;
        }
        return new Text(text, 0, 0);
      }

      // Collapsed: single-line suffix
      let warningText: string | undefined;
      const tr = result.details?.truncation;
      const fp = result.details?.fullOutputPath;
      if (tr?.truncated || fp) {
        const w: string[] = [];
        if (fp) w.push(`Full output: ${fp}`);
        if (tr?.truncated) w.push("output truncated");
        warningText = theme.fg("warning", `[${w.join(". ")}]`);
      }
      context.state.resultSuffix = expandSuffix(
        countLines(output),
        theme,
        warningText,
      );
      return new Container();
    },
  });

  // --- grep (disabled – not needed, default pi doesn't use it) --------
  // const builtinGrep = createGrepTool(cwd);
  /* pi.registerTool({
    ...builtinGrep,
    parameters: { ...builtinGrep.parameters },
    renderCall(args: any, theme: any, context: any) {
      context.state.resultSuffix = "";
      const pattern = str(args?.pattern) || "...";
      const rawPath = str(args?.path);
      const glob = str(args?.glob);

      let detail = theme.fg("accent", pattern);
      if (rawPath) detail += ` ${pathDisplay(rawPath, cwd, theme)}`;
      if (glob) detail += theme.fg("muted", ` --glob ${glob}`);
      if (args?.ignoreCase) detail += theme.fg("muted", " -i");
      if (args?.literal) detail += theme.fg("muted", " --literal");
      if (args?.context) detail += theme.fg("muted", ` -C${args.context}`);
      if (args?.limit) detail += theme.fg("muted", ` --limit ${args.limit}`);

      const prefix = `${theme.fg("toolTitle", theme.bold("grep"))} ${detail}`;
      const state = context.state;
      return lazyLine(() => prefix + (state.resultSuffix || ""));
    },
    renderResult(
      result: any,
      { expanded, isPartial }: any,
      theme: any,
      context: any,
    ) {
      if (isPartial) {
        context.state.resultSuffix = "";
        return new Container();
      }
      const output = getTextOutput(result).trim();
      if (!output) {
        context.state.resultSuffix = "";
        return new Container();
      }

      if (result.isError) {
        context.state.resultSuffix = "";
        return new Text(theme.fg("error", output), 0, 0);
      }

      if (expanded) {
        context.state.resultSuffix = "";
        const styled = output
          .split("\n")
          .map((l: string) => theme.fg("toolOutput", l))
          .join("\n");
        return new Text(`\n${styled}`, 0, 0);
      }

      // Collapsed: single-line suffix
      let warningText: string | undefined;
      const details = result.details;
      const notices: string[] = [];
      if (details?.matchLimitReached)
        notices.push(`${details.matchLimitReached} match limit`);
      if (details?.truncation?.truncated) notices.push("output truncated");
      if (details?.linesTruncated) notices.push("lines truncated");
      if (notices.length > 0)
        warningText = theme.fg("warning", `[${notices.join(". ")}]`);

      context.state.resultSuffix = expandSuffix(
        countLines(output),
        theme,
        warningText,
      );
      return new Container();
    },
  }); */
}
