/**
 * Multi-Edit Extension — replaces the built-in `edit` tool.
 *
 * Supports all original parameters (path, oldText, newText) plus:
 * - `multi`: array of {path, oldText, newText} edits applied in sequence
 *
 * When both top-level params and `multi` are provided, the top-level edit
 * is treated as an implicit first item prepended to the multi list.
 *
 * A preflight pass is performed before mutating files using a virtualized
 * built-in edit tool, ensuring all edits succeed before any files are changed.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createEditTool, type EditToolDetails } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { constants } from "fs";
import { access as fsAccess, readFile as fsReadFile } from "fs/promises";

const editItemSchema = Type.Object({
	path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
	oldText: Type.String({ description: "Exact text to find and replace (must match exactly)" }),
	newText: Type.String({ description: "New text to replace the old text with" }),
});

const multiEditSchema = Type.Object({
	path: Type.Optional(Type.String({ description: "Path to the file to edit (relative or absolute)" })),
	oldText: Type.Optional(Type.String({ description: "Exact text to find and replace (must match exactly)" })),
	newText: Type.Optional(Type.String({ description: "New text to replace the old text with" })),
	multi: Type.Optional(
		Type.Array(editItemSchema, {
			description: "Multiple edits to apply in sequence. Each item has path, oldText, and newText.",
		}),
	),
});

interface EditItem {
	path: string;
	oldText: string;
	newText: string;
}

interface EditResult {
	path: string;
	success: boolean;
	message: string;
	diff?: string;
	firstChangedLine?: number;
}

function createVirtualEditOperations(): {
	readFile: (absolutePath: string) => Promise<Buffer>;
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	access: (absolutePath: string) => Promise<void>;
} {
	const files = new Map<string, string>();

	async function ensureLoaded(absolutePath: string): Promise<void> {
		if (files.has(absolutePath)) return;
		const content = await fsReadFile(absolutePath, "utf-8");
		files.set(absolutePath, content);
	}

	return {
		readFile: async (absolutePath) => {
			await ensureLoaded(absolutePath);
			return Buffer.from(files.get(absolutePath) ?? "", "utf-8");
		},
		writeFile: async (absolutePath, content) => {
			files.set(absolutePath, content);
		},
		access: async (absolutePath) => {
			if (files.has(absolutePath)) return;
			await fsAccess(absolutePath, constants.R_OK | constants.W_OK);
		},
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "edit",
		label: "edit",
		description:
			"Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits. Supports a `multi` parameter for batch edits across one or more files.",
		promptSnippet:
			"Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
		promptGuidelines: [
			"Use edit for precise changes (old text must match exactly)",
			"Use the `multi` parameter to apply multiple edits in a single tool call",
		],
		parameters: multiEditSchema,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const { path, oldText, newText, multi } = params;

			// Build classic edit list.
			const edits: EditItem[] = [];
			const hasTopLevel = path !== undefined && oldText !== undefined && newText !== undefined;

			if (hasTopLevel) {
				edits.push({ path: path!, oldText: oldText!, newText: newText! });
			} else if (path !== undefined || oldText !== undefined || newText !== undefined) {
				const missing: string[] = [];
				if (path === undefined) missing.push("path");
				if (oldText === undefined) missing.push("oldText");
				if (newText === undefined) missing.push("newText");
				throw new Error(
					`Incomplete top-level edit: missing ${missing.join(", ")}. Provide all three (path, oldText, newText) or use only the multi parameter.`,
				);
			}

			if (multi) {
				edits.push(...multi);
			}

			if (edits.length === 0) {
				throw new Error("No edits provided. Supply path/oldText/newText or a multi array.");
			}

			// Preflight pass before mutating files.
			const preflightTool = createEditTool(ctx.cwd, { operations: createVirtualEditOperations() });
			const preflightResults: EditResult[] = [];
			for (let i = 0; i < edits.length; i++) {
				if (signal?.aborted) {
					throw new Error("Operation aborted");
				}
				const edit = edits[i];
				try {
					await preflightTool.execute(`${toolCallId}_preflight_${i}`, edit, signal);
					preflightResults.push({ path: edit.path, success: true, message: "Preflight passed." });
				} catch (err: any) {
					preflightResults.push({ path: edit.path, success: false, message: err.message ?? String(err) });
					throw new Error(`Preflight failed before mutating files.\n${formatResults(preflightResults, edits.length)}`);
				}
			}

			// Apply for real with built-in edit tool.
			const innerTool = createEditTool(ctx.cwd);
			const results: EditResult[] = [];

			for (let i = 0; i < edits.length; i++) {
				if (signal?.aborted) {
					throw new Error("Operation aborted");
				}

				const edit = edits[i];
				try {
					const result = await innerTool.execute(`${toolCallId}_${i}`, edit, signal);
					const details = result.details as EditToolDetails | undefined;
					const text = result.content?.[0]?.type === "text" ? result.content[0].text : `Edit ${i + 1} applied.`;

					results.push({
						path: edit.path,
						success: true,
						message: text,
						diff: details?.diff,
						firstChangedLine: details?.firstChangedLine,
					});
				} catch (err: any) {
					results.push({ path: edit.path, success: false, message: err.message ?? String(err) });
					throw new Error(formatResults(results, edits.length));
				}
			}

			if (results.length === 1) {
				const r = results[0];
				return {
					content: [{ type: "text" as const, text: r.message }],
					details: {
						diff: r.diff ?? "",
						firstChangedLine: r.firstChangedLine,
					},
				};
			}

			const combinedDiff = results
				.filter((r) => r.diff)
				.map((r) => r.diff)
				.join("\n");

			const firstChanged = results.find((r) => r.firstChangedLine !== undefined)?.firstChangedLine;
			const summary = results.map((r, i) => `${i + 1}. ${r.message}`).join("\n");

			return {
				content: [{ type: "text" as const, text: `Applied ${results.length} edit(s) successfully.\n${summary}` }],
				details: {
					diff: combinedDiff,
					firstChangedLine: firstChanged,
				},
			};
		},
	});
}

function formatResults(results: EditResult[], totalEdits: number): string {
	const lines: string[] = [];

	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		const status = r.success ? "✓" : "✗";
		lines.push(`${status} Edit ${i + 1}/${totalEdits} (${r.path}): ${r.message}`);
	}

	const remaining = totalEdits - results.length;
	if (remaining > 0) {
		lines.push(`⊘ ${remaining} remaining edit(s) skipped due to error.`);
	}

	return lines.join("\n");
}
