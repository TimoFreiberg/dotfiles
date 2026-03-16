/**
 * Autoformat Extension
 *
 * Runs a formatter on files after successful `edit` or `write` tool calls.
 *
 * Default formatters:
 *   .rs        → rustfmt
 *   .py        → uv run ruff format -q
 *   .ts/.tsx   → prettier --write
 *   .js/.jsx   → prettier --write
 *
 * Override or extend via `.pi/format.json` in the project root:
 * {
 *   ".go": "gofmt -w {path}",
 *   ".rs": "cargo fmt -- {path}",
 *   ".py": false              // disable for .py
 * }
 *
 * The `{path}` placeholder is replaced with the absolute file path.
 * If omitted, the path is appended as the last argument.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFile } from "fs/promises";
import { extname, resolve } from "path";

const DEFAULT_FORMATTERS: Record<string, string> = {
	".rs": "rustfmt {path}",
	".py": "uv run ruff format -q {path}",
	".ts": "prettier --write {path}",
	".tsx": "prettier --write {path}",
	".js": "prettier --write {path}",
	".jsx": "prettier --write {path}",
};

async function loadProjectConfig(cwd: string): Promise<Record<string, string | false> | null> {
	try {
		const raw = await readFile(resolve(cwd, ".pi", "format.json"), "utf-8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function buildCommand(template: string, absolutePath: string): string {
	if (template.includes("{path}")) {
		return template.replace(/\{path\}/g, absolutePath);
	}
	return `${template} ${absolutePath}`;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "edit" && event.toolName !== "write") return;
		if (event.isError) return;

		const filePath = event.input.path as string | undefined;
		if (!filePath) return;

		const absolutePath = resolve(ctx.cwd, filePath);
		const ext = extname(absolutePath).toLowerCase();
		if (!ext) return;

		// Merge defaults with project overrides
		const overrides = await loadProjectConfig(ctx.cwd);
		const formatters: Record<string, string | false> = { ...DEFAULT_FORMATTERS, ...overrides };

		const template = formatters[ext];
		if (!template) return; // no formatter or explicitly disabled

		const command = buildCommand(template, absolutePath);

		try {
			const result = await pi.exec("sh", ["-c", command], { timeout: 15_000 });
			if (result.code !== 0) {
				const stderr = result.stderr.trim();
				ctx.ui.notify(`autoformat (${ext}): exit ${result.code}${stderr ? `\n${stderr}` : ""}`, "warn");
			}
		} catch (err: any) {
			ctx.ui.notify(`autoformat (${ext}): ${err.message}`, "warn");
		}
	});
}
