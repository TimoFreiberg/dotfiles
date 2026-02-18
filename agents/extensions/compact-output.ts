/**
 * Compact Tool Output Extension
 *
 * Makes tool output much less verbose in the default (collapsed) view.
 * Ctrl+O still shows the full expanded output.
 *
 * All collapsed views are limited to 3 visual terminal lines of content,
 * accounting for line wrapping at the current terminal width.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	createReadTool,
	createBashTool,
	createWriteTool,
	createLsTool,
	createFindTool,
	createGrepTool,
	keyHint,
	highlightCode,
	getLanguageFromPath,
	formatSize,
	truncateToVisualLines,
	DEFAULT_MAX_BYTES,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { relative } from "path";

// Maximum visual lines shown in any collapsed tool output.
const MAX_VISUAL_LINES = 3;

// ── helpers ─────────────────────────────────────────────────────────

function shortenPath(path: string, cwd: string): string {
	if (!path) return path;
	const clean = path.startsWith("@") ? path.slice(1) : path;
	try {
		const rel = relative(cwd, clean);
		if (rel && !rel.startsWith("../../../") && rel.length < clean.length) return rel;
	} catch {}
	return clean;
}

function replaceTabs(s: string): string {
	return s.replace(/\t/g, "  ");
}

function str(v: unknown): string | null {
	return typeof v === "string" ? v : null;
}

/** Format a path arg for display: accent if present, "..." if still streaming/missing. */
function pathDisplay(rawPath: string | null, cwd: string, theme: any): string {
	if (rawPath === null) return theme.fg("toolOutput", "...");
	if (!rawPath) return theme.fg("toolOutput", "...");
	return theme.fg("accent", shortenPath(rawPath, cwd));
}

function getTextOutput(result: any): string {
	if (!result) return "";
	const textBlocks = result.content?.filter((c: any) => c.type === "text") || [];
	return textBlocks
		.map((c: any) => (c.text || "").replace(/\r/g, ""))
		.join("\n");
}

/** Build fully styled code string with syntax highlighting (no truncation). */
function buildStyledCode(code: string, filePath: string | null, theme: any): string {
	const lang = filePath ? getLanguageFromPath(filePath) : undefined;
	const cleaned = replaceTabs(code);
	const lines = lang ? highlightCode(cleaned, lang) : cleaned.split("\n");
	return lines
		.map((line: string) => (lang ? line : theme.fg("toolOutput", line)))
		.join("\n");
}

/** Build fully styled list string (no truncation). */
function buildStyledList(output: string, theme: any): string {
	return output
		.split("\n")
		.map((l: string) => theme.fg("toolOutput", l))
		.join("\n");
}

/**
 * Create a renderable that truncates styled content to N visual lines
 * from the start. Used for collapsed views of read/write/ls/find/grep.
 */
function createCollapsedRenderable(
	styledContent: string,
	maxVisualLines: number,
	theme: any,
	warningText?: string,
): any {
	return {
		_cw: undefined as number | undefined,
		_cl: undefined as string[] | undefined,
		_ct: undefined as boolean | undefined,
		render(width: number): string[] {
			if (this._cl === undefined || this._cw !== width) {
				const tempText = new Text(styledContent, 0, 0);
				const allVisual = tempText.render(width);
				if (allVisual.length <= maxVisualLines) {
					this._cl = allVisual;
					this._ct = false;
				} else {
					this._cl = allVisual.slice(0, maxVisualLines);
					this._ct = true;
				}
				this._cw = width;
			}
			const out: string[] = ["", ...this._cl!];
			if (this._ct) {
				out.push(
					theme.fg("muted", "... (") +
						keyHint("expandTools", "to expand") +
						")",
				);
			}
			if (warningText) {
				out.push(warningText);
			}
			return out;
		},
		invalidate() {
			this._cw = undefined;
			this._cl = undefined;
			this._ct = undefined;
		},
	};
}

function renderTruncationWarning(result: any, theme: any): string {
	const t = result.details?.truncation;
	if (!t?.truncated) return "";
	if (t.firstLineExceedsLimit) {
		return theme.fg("warning", `[First line exceeds ${formatSize(t.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`);
	}
	if (t.truncatedBy === "lines") {
		return theme.fg("warning", `[Truncated: ${t.outputLines} of ${t.totalLines} lines]`);
	}
	return theme.fg("warning", `[Truncated: ${t.outputLines} lines (${formatSize(t.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`);
}

// ── extension ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();

	// TODO: This unconditionally registers overrides for all built-in tools,
	// which activates grep/find/ls even in sessions that don't normally have them.
	// To only override active tools: register all tools here unconditionally (as now),
	// then in a "session_start" handler call pi.getActiveTools() to snapshot the
	// original set, and pi.setActiveTools() to remove the ones that weren't active.
	// (pi.getActiveTools() is an action method — can't be called during loading.)
	// See examples/extensions/ssh.ts for the lazy-resolution pattern.

	// renderCall and renderResult are always called synchronously in sequence
	// within the same ToolExecutionComponent.updateDisplay() call, so a simple
	// closure variable is safe for passing args from renderCall to renderResult.

	// --- read -----------------------------------------------------------
	{
		let readArgs: any = null;
		const builtinRead = createReadTool(cwd);
		pi.registerTool({
			...builtinRead,
			renderCall(args: any, theme: any) {
				readArgs = args;
				const rawPath = str(args?.file_path ?? args?.path);
				const offset = args?.offset;
				const limit = args?.limit;

				let pd = pathDisplay(rawPath, cwd, theme);
				if (offset !== undefined || limit !== undefined) {
					const s = offset ?? 1;
					const e = limit !== undefined ? s + limit - 1 : "";
					pd += theme.fg("warning", `:${s}${e ? `-${e}` : ""}`);
				}
				return new Text(`${theme.fg("toolTitle", theme.bold("read"))} ${pd}`, 0, 0);
			},
			renderResult(result: any, { expanded, isPartial }: any, theme: any) {
				if (isPartial) return null;
				const output = getTextOutput(result);
				if (result.isError) return new Text(theme.fg("error", output), 0, 0);
				if (!output) return null;

				const rawPath = str(readArgs?.file_path ?? readArgs?.path);
				const warning = renderTruncationWarning(result, theme);

				if (expanded) {
					let text = "\n\n" + buildStyledCode(output, rawPath, theme);
					if (warning) text += "\n" + warning;
					return new Text(text, 0, 0);
				}

				return createCollapsedRenderable(
					buildStyledCode(output, rawPath, theme),
					MAX_VISUAL_LINES,
					theme,
					warning || undefined,
				);
			},
		});
	}

	// --- write ----------------------------------------------------------
	{
		let writeArgs: any = null;
		const builtinWrite = createWriteTool(cwd);
		pi.registerTool({
			...builtinWrite,
			renderCall(args: any, theme: any) {
				writeArgs = args;
				const rawPath = str(args?.file_path ?? args?.path);
				const pd = pathDisplay(rawPath, cwd, theme);
				return new Text(`${theme.fg("toolTitle", theme.bold("write"))} ${pd}`, 0, 0);
			},
			renderResult(result: any, { expanded, isPartial }: any, theme: any) {
				if (isPartial) return null;
				if (result.isError) return new Text(theme.fg("error", getTextOutput(result)), 0, 0);

				const rawPath = str(writeArgs?.file_path ?? writeArgs?.path);
				const fileContent = str(writeArgs?.content);

				if (!fileContent) {
					const output = getTextOutput(result);
					return output ? new Text(theme.fg("toolOutput", output), 0, 0) : null;
				}

				if (expanded) {
					return new Text("\n\n" + buildStyledCode(fileContent, rawPath, theme), 0, 0);
				}

				return createCollapsedRenderable(
					buildStyledCode(fileContent, rawPath, theme),
					MAX_VISUAL_LINES,
					theme,
				);
			},
		});
	}

	// --- bash -----------------------------------------------------------
	{
		const builtinBash = createBashTool(cwd);
		pi.registerTool({
			...builtinBash,
			renderCall(args: any, theme: any) {
				const command = str(args?.command);
				const timeout = args?.timeout;
				const tsuf = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
				const cd = command ? command : theme.fg("toolOutput", "...");
				return new Text(theme.fg("toolTitle", theme.bold(`$ ${cd}`)) + tsuf, 0, 0);
			},
			renderResult(result: any, { expanded, isPartial }: any, theme: any) {
				if (isPartial) return null;
				const output = getTextOutput(result).trim();
				if (!output) return null;

				const styled = output
					.split("\n")
					.map((l: string) => theme.fg("toolOutput", l))
					.join("\n");

				if (expanded) {
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

				// Collapsed: visual line truncation (last N lines for bash)
				return {
					_cw: undefined as number | undefined,
					_cl: undefined as string[] | undefined,
					_cs: undefined as number | undefined,
					render(width: number): string[] {
						if (this._cl === undefined || this._cw !== width) {
							const r = truncateToVisualLines(styled, MAX_VISUAL_LINES, width);
							this._cl = r.visualLines;
							this._cs = r.skippedCount;
							this._cw = width;
						}
						const out: string[] = [];
						if (this._cs && this._cs > 0) {
							out.push(
								"",
								theme.fg("muted", `... (${this._cs} earlier lines,`) +
									` ${keyHint("expandTools", "to expand")})`,
								...this._cl!,
							);
						} else {
							out.push("", ...this._cl!);
						}
						const tr = result.details?.truncation;
						const fp = result.details?.fullOutputPath;
						if (tr?.truncated || fp) {
							const w: string[] = [];
							if (fp) w.push(`Full output: ${fp}`);
							if (tr?.truncated) w.push("output truncated");
							out.push(theme.fg("warning", `[${w.join(". ")}]`));
						}
						return out;
					},
					invalidate() {
						this._cw = undefined;
						this._cl = undefined;
						this._cs = undefined;
					},
				} as any;
			},
		});
	}

	// --- ls -------------------------------------------------------------
	{
		const builtinLs = createLsTool(cwd);
		pi.registerTool({
			...builtinLs,
			renderCall(args: any, theme: any) {
				const rawPath = str(args?.path);
				const path = rawPath ? shortenPath(rawPath, cwd) : ".";
				const limit = args?.limit;
				let text = `${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", path)}`;
				if (limit !== undefined) text += theme.fg("toolOutput", ` (limit ${limit})`);
				return new Text(text, 0, 0);
			},
			renderResult(result: any, { expanded, isPartial }: any, theme: any) {
				if (isPartial) return null;
				const output = getTextOutput(result).trim();
				if (!output) return null;

				let warning: string | undefined;
				const el = result.details?.entryLimitReached;
				const tr = result.details?.truncation;
				if (el || tr?.truncated) {
					const w: string[] = [];
					if (el) w.push(`${el} entries limit`);
					if (tr?.truncated) w.push(`${formatSize(tr.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
					warning = theme.fg("warning", `[Truncated: ${w.join(", ")}]`);
				}

				if (expanded) {
					let text = "\n\n" + buildStyledList(output, theme);
					if (warning) text += "\n" + warning;
					return new Text(text, 0, 0);
				}

				return createCollapsedRenderable(
					buildStyledList(output, theme),
					MAX_VISUAL_LINES,
					theme,
					warning,
				);
			},
		});
	}

	// --- find -----------------------------------------------------------
	{
		const builtinFind = createFindTool(cwd);
		pi.registerTool({
			...builtinFind,
			renderCall(args: any, theme: any) {
				const pattern = str(args?.pattern);
				const rawPath = str(args?.path);
				const path = rawPath ? shortenPath(rawPath, cwd) : ".";
				const limit = args?.limit;
				let text =
					theme.fg("toolTitle", theme.bold("find")) +
					" " +
					theme.fg("accent", pattern || "...") +
					theme.fg("toolOutput", ` in ${path}`);
				if (limit !== undefined) text += theme.fg("toolOutput", ` (limit ${limit})`);
				return new Text(text, 0, 0);
			},
			renderResult(result: any, { expanded, isPartial }: any, theme: any) {
				if (isPartial) return null;
				const output = getTextOutput(result).trim();
				if (!output) return null;

				let warning: string | undefined;
				const rl = result.details?.resultLimitReached;
				const tr = result.details?.truncation;
				if (rl || tr?.truncated) {
					const w: string[] = [];
					if (rl) w.push(`${rl} results limit`);
					if (tr?.truncated) w.push(`${formatSize(tr.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
					warning = theme.fg("warning", `[Truncated: ${w.join(", ")}]`);
				}

				if (expanded) {
					let text = "\n\n" + buildStyledList(output, theme);
					if (warning) text += "\n" + warning;
					return new Text(text, 0, 0);
				}

				return createCollapsedRenderable(
					buildStyledList(output, theme),
					MAX_VISUAL_LINES,
					theme,
					warning,
				);
			},
		});
	}

	// --- grep -----------------------------------------------------------
	{
		const builtinGrep = createGrepTool(cwd);
		pi.registerTool({
			...builtinGrep,
			renderCall(args: any, theme: any) {
				const pattern = str(args?.pattern);
				const rawPath = str(args?.path);
				const path = rawPath ? shortenPath(rawPath, cwd) : ".";
				const glob = str(args?.glob);
				const limit = args?.limit;
				let text =
					theme.fg("toolTitle", theme.bold("grep")) +
					" " +
					theme.fg("accent", pattern ? `/${pattern}/` : "...") +
					theme.fg("toolOutput", ` in ${path}`);
				if (glob) text += theme.fg("toolOutput", ` (${glob})`);
				if (limit !== undefined) text += theme.fg("toolOutput", ` limit ${limit}`);
				return new Text(text, 0, 0);
			},
			renderResult(result: any, { expanded, isPartial }: any, theme: any) {
				if (isPartial) return null;
				const output = getTextOutput(result).trim();
				if (!output) return null;

				let warning: string | undefined;
				const ml = result.details?.matchLimitReached;
				const tr = result.details?.truncation;
				const lt = result.details?.linesTruncated;
				if (ml || tr?.truncated || lt) {
					const w: string[] = [];
					if (ml) w.push(`${ml} matches limit`);
					if (tr?.truncated) w.push(`${formatSize(tr.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
					if (lt) w.push("some lines truncated");
					warning = theme.fg("warning", `[Truncated: ${w.join(", ")}]`);
				}

				if (expanded) {
					let text = "\n\n" + buildStyledList(output, theme);
					if (warning) text += "\n" + warning;
					return new Text(text, 0, 0);
				}

				return createCollapsedRenderable(
					buildStyledList(output, theme),
					MAX_VISUAL_LINES,
					theme,
					warning,
				);
			},
		});
	}
}
