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
import { Text } from "@mariozechner/pi-tui";
import { relative } from "path";

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
	const textBlocks = result.content?.filter((c: any) => c.type === "text") || [];
	return textBlocks
		.map((c: any) => (c.text || "").replace(/\r/g, ""))
		.join("\n");
}

function countLines(text: string): number {
	if (!text) return 0;
	return text.split("\n").length;
}

/** Build fully styled code string with syntax highlighting. */
function buildStyledCode(code: string, filePath: string | null, theme: any): string {
	const lang = filePath ? getLanguageFromPath(filePath) : undefined;
	const cleaned = replaceTabs(code);
	const lines = lang ? highlightCode(cleaned, lang) : cleaned.split("\n");
	return lines
		.map((line: string) => (lang ? line : theme.fg("toolOutput", line)))
		.join("\n");
}

/** Build the expand hint suffix: " — 42 lines (ctrl+o to expand)" */
function expandSuffix(lineCount: number, theme: any, warningText?: string): string {
	let s = theme.fg("muted", ` — ${lineCount} line${lineCount !== 1 ? "s" : ""} (`) +
		keyHint("expandTools", "to expand") +
		theme.fg("muted", ")");
	if (warningText) s += " " + warningText;
	return s;
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

/**
 * Create a lazy renderable whose text is built by `buildLine()` at render time.
 * This lets renderCall's component pick up info set later by renderResult.
 */
function lazyLine(buildLine: () => string): any {
	const inner = new Text("", 0, 0);
	return {
		render(width: number): string[] {
			inner.setText(buildLine());
			return inner.render(width);
		},
		invalidate() { inner.invalidate(); },
	};
}

// ── extension ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();

	// Strip redundant `cd <cwd> && ` prefix from bash commands (display + execution).
	pi.on("tool_call", async (event) => {
		if (event.toolName === "bash" && typeof event.input?.command === "string") {
			event.input.command = stripCdPrefix(event.input.command, cwd);
		}
	});

	// Only override read, write, and bash with compact rendering.
	// ls, find, and grep are left as built-in tools to avoid unnecessary
	// tool registrations (saves ~580 tokens in the tool schema).

	// renderCall and renderResult are always called synchronously in sequence
	// within the same ToolExecutionComponent.updateDisplay() call, so a simple
	// closure variable is safe for passing args from renderCall to renderResult.
	//
	// For the single-line collapsed view, renderResult stores a suffix string
	// in the closure and returns null. The renderCall component is a lazy
	// renderable that reads the suffix at paint time (after renderResult has set it).

	// --- read -----------------------------------------------------------
	{
		let resultSuffix = "";
		let readArgs: any = null;
		const builtinRead = createReadTool(cwd);
		pi.registerTool({
			...builtinRead,
			renderCall(args: any, theme: any) {
				resultSuffix = "";
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
				const prefix = `${theme.fg("toolTitle", theme.bold("read"))} ${pd}`;
				return lazyLine(() => prefix + resultSuffix);
			},
			renderResult(result: any, { expanded, isPartial }: any, theme: any) {
				if (isPartial) { resultSuffix = ""; return null; }
				const output = getTextOutput(result);
				if (result.isError) {
					resultSuffix = "";
					return new Text(theme.fg("error", output), 0, 0);
				}
				if (!output) { resultSuffix = ""; return null; }

				const rawPath = str(readArgs?.file_path ?? readArgs?.path);
				const warning = renderTruncationWarning(result, theme);

				if (expanded) {
					resultSuffix = "";
					let text = "\n\n" + buildStyledCode(output, rawPath, theme);
					if (warning) text += "\n" + warning;
					return new Text(text, 0, 0);
				}

				// Collapsed: set suffix for the lazy header line, return no component
				resultSuffix = expandSuffix(countLines(output), theme, warning || undefined);
				return null;
			},
		});
	}

	// --- write ----------------------------------------------------------
	{
		let resultSuffix = "";
		let writeArgs: any = null;
		const builtinWrite = createWriteTool(cwd);
		pi.registerTool({
			...builtinWrite,
			renderCall(args: any, theme: any) {
				resultSuffix = "";
				writeArgs = args;
				const rawPath = str(args?.file_path ?? args?.path);
				const pd = pathDisplay(rawPath, cwd, theme);
				const prefix = `${theme.fg("toolTitle", theme.bold("write"))} ${pd}`;
				return lazyLine(() => prefix + resultSuffix);
			},
			renderResult(result: any, { expanded, isPartial }: any, theme: any) {
				if (isPartial) { resultSuffix = ""; return null; }
				if (result.isError) {
					resultSuffix = "";
					return new Text(theme.fg("error", getTextOutput(result)), 0, 0);
				}

				const rawPath = str(writeArgs?.file_path ?? writeArgs?.path);
				const fileContent = str(writeArgs?.content);

				if (!fileContent) {
					resultSuffix = "";
					const output = getTextOutput(result);
					return output ? new Text(theme.fg("toolOutput", output), 0, 0) : null;
				}

				if (expanded) {
					resultSuffix = "";
					return new Text("\n\n" + buildStyledCode(fileContent, rawPath, theme), 0, 0);
				}

				resultSuffix = expandSuffix(countLines(fileContent), theme);
				return null;
			},
		});
	}

	// --- bash -----------------------------------------------------------
	{
		let resultSuffix = "";
		const builtinBash = createBashTool(cwd);
		pi.registerTool({
			...builtinBash,
			renderCall(args: any, theme: any) {
				resultSuffix = "";
				const raw = str(args?.command);
				const command = raw ? stripCdPrefix(raw, cwd) : raw;
				const timeout = args?.timeout;
				const tsuf = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
				const cd = command ? command : theme.fg("toolOutput", "...");
				const prefix = theme.fg("toolTitle", theme.bold(`$ ${cd}`)) + tsuf;
				return lazyLine(() => prefix + resultSuffix);
			},
			renderResult(result: any, { expanded, isPartial }: any, theme: any) {
				if (isPartial) { resultSuffix = ""; return null; }
				const output = getTextOutput(result).trim();
				if (!output) { resultSuffix = ""; return null; }

				if (expanded) {
					resultSuffix = "";
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
				resultSuffix = expandSuffix(countLines(output), theme, warningText);
				return null;
			},
		});
	}

}
