/**
 * Shared compact tool render helpers.
 *
 * Extracted from compact-output.ts so both compact-output.ts and
 * container/index.ts can use the same rendering without tool registration
 * conflicts.
 *
 * These match compact-output.ts's rendering EXACTLY.
 */

import {
  keyHint,
  highlightCode,
  getLanguageFromPath,
  formatSize,
  DEFAULT_MAX_BYTES,
} from "@earendil-works/pi-coding-agent";
import { Text, Container } from "@earendil-works/pi-tui";
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

function maxLineLength(): number {
  const cols = process.stdout.columns;
  return cols && cols > 0 ? cols : 200;
}

function truncateLine(line: string, width: number): string {
  if (width <= 0 || line.length <= width) return line;
  return line.slice(0, width - 1) + "…";
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function stripCdPrefix(command: string, cwd: string): string {
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

interface RenderState {
  resultSuffix?: string;
}

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

function cachedLazyLine(prefix: string, state: RenderState, context: any): any {
  const existing = context.lastComponent;
  if (existing && existing._cachedPrefix === prefix) return existing;
  const comp = lazyLine(() => prefix + (state.resultSuffix || ""));
  comp._cachedPrefix = prefix;
  return comp;
}

function buildPreviewLines(text: string, maxLines: number, theme: any): string {
  const lines = text.split("\n").slice(0, maxLines);
  if (lines.length === 0) return "";
  const width = maxLineLength();
  return (
    "\n" +
    lines
      .map((l: string) => theme.fg("toolOutput", truncateLine(l, width)))
      .join("\n")
  );
}

// ── Tool render factories ───────────────────────────────────────────

export interface ToolRenderers {
  renderCall(args: any, theme: any, context: any): any;
  renderResult(result: any, options: any, theme: any, context: any): any;
}

export function readToolRender(cwd: string): ToolRenderers {
  return {
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
      context.state.resultSuffix = expandSuffix(
        countLines(output),
        theme,
        warning || undefined,
      );
      const readPreview = buildPreviewLines(output, 2, theme);
      return new Text(readPreview, 0, 0);
    },
  };
}

export function writeToolRender(cwd: string): ToolRenderers {
  return {
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
      const writePreview = buildPreviewLines(fileContent, 5, theme);
      return new Text(writePreview, 0, 0);
    },
  };
}

export function bashToolRender(cwd: string): ToolRenderers {
  return {
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
      const bashPreview = buildPreviewLines(output, 2, theme);
      return new Text(bashPreview, 0, 0);
    },
  };
}

export function grepToolRender(cwd: string): ToolRenderers {
  return {
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
  };
}

export function findToolRender(cwd: string): ToolRenderers {
  return {
    renderCall(args: any, theme: any, context: any) {
      context.state.resultSuffix = "";
      const pattern = str(args?.pattern) || "...";
      const rawPath = str(args?.path);
      let detail = theme.fg("accent", pattern);
      if (rawPath) detail += ` ${pathDisplay(rawPath, cwd, theme)}`;
      if (args?.limit) detail += theme.fg("muted", ` --limit ${args.limit}`);
      const prefix = `${theme.fg("toolTitle", theme.bold("find"))} ${detail}`;
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
      let warningText: string | undefined;
      const details = result.details;
      const notices: string[] = [];
      if (details?.resultLimitReached)
        notices.push(`${details.resultLimitReached} result limit`);
      if (details?.truncation?.truncated) notices.push("output truncated");
      if (notices.length > 0)
        warningText = theme.fg("warning", `[${notices.join(". ")}]`);
      context.state.resultSuffix = expandSuffix(
        countLines(output),
        theme,
        warningText,
      );
      return new Container();
    },
  };
}
