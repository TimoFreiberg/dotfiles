/**
 * Compact Tool Output Extension
 *
 * Makes tool output much less verbose in the default (collapsed) view.
 * Ctrl+O still shows the full expanded output.
 *
 * Default collapsed views:
 * - read:  header + 3 preview lines (built-in shows 10)
 * - write: header + 3 preview lines (built-in shows 10)
 * - bash:  header + 3 visual lines (built-in shows 5)
 * - ls:    header + 5 lines (built-in shows 20)
 * - find:  header + 5 lines (built-in shows 20)
 * - grep:  header + 5 lines (built-in shows 15)
 *
 * Only overrides tools that are already active — won't accidentally add
 * grep/find/ls to sessions that only have read/bash/edit/write.
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
	DEFAULT_MAX_LINES,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { relative } from "path";

// Preview line limits for collapsed view
const READ_PREVIEW_LINES = 3;
const WRITE_PREVIEW_LINES = 3;
const BASH_PREVIEW_LINES = 3;
const LS_PREVIEW_LINES = 5;
const FIND_PREVIEW_LINES = 5;
const GREP_PREVIEW_LINES = 5;

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

/** Render code with syntax highlighting, truncated to maxLines when collapsed. */
function renderCodePreview(
	code: string,
	filePath: string | null,
	maxLines: number,
	expanded: boolean,
	theme: any,
): string {
	const lang = filePath ? getLanguageFromPath(filePath) : undefined;
	const lines = lang ? highlightCode(replaceTabs(code), lang) : code.split("\n");
	const limit = expanded ? lines.length : maxLines;
	const displayLines = lines.slice(0, limit);
	const remaining = lines.length - limit;

	let text =
		"\n\n" +
		displayLines
			.map((line: string) =>
				lang ? replaceTabs(line) : theme.fg("toolOutput", replaceTabs(line)),
			)
			.join("\n");

	if (remaining > 0) {
		text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("expandTools", "to expand")})`;
	}
	return text;
}

/** Render list output (ls, find, grep), truncated to maxLines when collapsed. */
function renderListPreview(
	output: string,
	maxLines: number,
	expanded: boolean,
	theme: any,
): string {
	const lines = output.split("\n");
	const limit = expanded ? lines.length : maxLines;
	const displayLines = lines.slice(0, limit);
	const remaining = lines.length - limit;

	let text = `\n\n${displayLines.map((l: string) => theme.fg("toolOutput", l)).join("\n")}`;

	if (remaining > 0) {
		text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("expandTools", "to expand")})`;
	}
	return text;
}

function renderTruncationWarning(result: any, theme: any): string {
	const t = result.details?.truncation;
	if (!t?.truncated) return "";
	if (t.firstLineExceedsLimit) {
		return "\n" + theme.fg("warning", `[First line exceeds ${formatSize(t.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`);
	}
	if (t.truncatedBy === "lines") {
		return "\n" + theme.fg("warning", `[Truncated: ${t.outputLines} of ${t.totalLines} lines]`);
	}
	return "\n" + theme.fg("warning", `[Truncated: ${t.outputLines} lines (${formatSize(t.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`);
}

// ── extension ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();

	// Only override tools that are already active — registerTool with a built-in
	// name activates it, which would unintentionally add grep/find/ls to sessions
	// that only have read/bash/edit/write.
	const activeTools = new Set(
		pi.getActiveTools().map((t: any) => (typeof t === "string" ? t : t.name)),
	);

	// renderCall and renderResult are always called synchronously in sequence
	// within the same ToolExecutionComponent.updateDisplay() call, so a simple
	// closure variable is safe for passing args from renderCall to renderResult.

	// --- read -----------------------------------------------------------
	if (activeTools.has("read")) {
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
				let text = renderCodePreview(output, rawPath, READ_PREVIEW_LINES, expanded, theme);
				text += renderTruncationWarning(result, theme);
				return new Text(text, 0, 0);
			},
		});
	}

	// --- write ----------------------------------------------------------
	if (activeTools.has("write")) {
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

				return new Text(
					renderCodePreview(fileContent, rawPath, WRITE_PREVIEW_LINES, expanded, theme),
					0,
					0,
				);
			},
		});
	}

	// --- bash -----------------------------------------------------------
	if (activeTools.has("bash")) {
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

				// Collapsed: visual line truncation with fewer preview lines
				return {
					_cw: undefined as number | undefined,
					_cl: undefined as string[] | undefined,
					_cs: undefined as number | undefined,
					render(width: number): string[] {
						if (this._cl === undefined || this._cw !== width) {
							const r = truncateToVisualLines(styled, BASH_PREVIEW_LINES, width);
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
	if (activeTools.has("ls")) {
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
				let text = renderListPreview(output, LS_PREVIEW_LINES, expanded, theme);
				const el = result.details?.entryLimitReached;
				const tr = result.details?.truncation;
				if (el || tr?.truncated) {
					const w: string[] = [];
					if (el) w.push(`${el} entries limit`);
					if (tr?.truncated) w.push(`${formatSize(tr.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
					text += `\n${theme.fg("warning", `[Truncated: ${w.join(", ")}]`)}`;
				}
				return new Text(text, 0, 0);
			},
		});
	}

	// --- find -----------------------------------------------------------
	if (activeTools.has("find")) {
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
				let text = renderListPreview(output, FIND_PREVIEW_LINES, expanded, theme);
				const rl = result.details?.resultLimitReached;
				const tr = result.details?.truncation;
				if (rl || tr?.truncated) {
					const w: string[] = [];
					if (rl) w.push(`${rl} results limit`);
					if (tr?.truncated) w.push(`${formatSize(tr.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
					text += `\n${theme.fg("warning", `[Truncated: ${w.join(", ")}]`)}`;
				}
				return new Text(text, 0, 0);
			},
		});
	}

	// --- grep -----------------------------------------------------------
	if (activeTools.has("grep")) {
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
				let text = renderListPreview(output, GREP_PREVIEW_LINES, expanded, theme);
				const ml = result.details?.matchLimitReached;
				const tr = result.details?.truncation;
				const lt = result.details?.linesTruncated;
				if (ml || tr?.truncated || lt) {
					const w: string[] = [];
					if (ml) w.push(`${ml} matches limit`);
					if (tr?.truncated) w.push(`${formatSize(tr.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
					if (lt) w.push("some lines truncated");
					text += `\n${theme.fg("warning", `[Truncated: ${w.join(", ")}]`)}`;
				}
				return new Text(text, 0, 0);
			},
		});
	}
}
