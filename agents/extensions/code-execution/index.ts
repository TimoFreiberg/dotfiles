/**
 * Programmatic Tool Calling — Client-side code execution
 *
 * The model writes TypeScript that calls pi's tools as functions. The code
 * runs in an isolated child process. Only the final console.log output goes
 * back to the model — intermediate tool results stay out of context.
 *
 * Architecture:
 *   1. Model calls the `code_execution` tool with TypeScript code
 *   2. Extension spawns a child Node process (child-executor.ts)
 *   3. Child compiles the code, injects tool function stubs into scope
 *   4. When a tool function is called, child sends IPC message to parent
 *   5. Parent calls pi.callTool() — the real built-in tool with all its
 *      logic (hashlines, truncation, images, etc.)
 *   6. Parent sends result back to child, code continues
 *   7. Individual tool calls render in the CLI via onUpdate
 *   8. Only the final captured stdout goes back to the model
 *
 * The child process provides full isolation:
 *   - Infinite loops → killed after timeout
 *   - Memory bombs → child dies, pi lives
 *   - process.exit() → child exits, pi lives
 *   - No access to pi internals, extension state, or agent messages
 *
 * Prerequisites:
 *   - Requires pi.callTool() API (see REQUIREMENTS.md)
 *
 * Usage:
 *   pi -e ./code-execution
 */

import type { AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { type ChildProcess, fork } from "child_process";
import { join } from "path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Max execution time before the child is killed. */
const EXECUTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Max output size returned to the model. */
const MAX_OUTPUT_BYTES = 50 * 1024; // 50KB

// ---------------------------------------------------------------------------
// Child process management
// ---------------------------------------------------------------------------

interface ToolCallTracker {
	calls: { tool: string; args: Record<string, unknown>; resultPreview: string; isError: boolean }[];
	onUpdate?: AgentToolUpdateCallback;
}

function pushUpdate(tracker: ToolCallTracker) {
	const summary = tracker.calls
		.map((c, i) => {
			const status = c.isError ? "ERROR" : "ok";
			return `[${i + 1}] ${c.tool} → ${status}: ${c.resultPreview}`;
		})
		.join("\n");

	tracker.onUpdate?.({
		content: [{ type: "text", text: summary }],
		details: { callCount: tracker.calls.length },
	});
}

function truncateOutput(text: string): string {
	if (Buffer.byteLength(text, "utf-8") <= MAX_OUTPUT_BYTES) return text;

	// Truncate to fit, keeping the end (most relevant for aggregated results)
	const lines = text.split("\n");
	const kept: string[] = [];
	let bytes = 0;
	for (let i = lines.length - 1; i >= 0; i--) {
		const lineBytes = Buffer.byteLength(lines[i], "utf-8") + 1;
		if (bytes + lineBytes > MAX_OUTPUT_BYTES - 100) break; // leave room for notice
		kept.unshift(lines[i]);
		bytes += lineBytes;
	}

	const droppedLines = lines.length - kept.length;
	return `[Output truncated: first ${droppedLines} lines omitted]\n${kept.join("\n")}`;
}

/**
 * Extract text content from a callTool result.
 * Returns the concatenated text blocks.
 */
function extractText(content: readonly { type: string }[]): string {
	return content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

async function executeInChild(
	code: string,
	_ctx: ExtensionContext,
	pi: ExtensionAPI,
	signal: AbortSignal | undefined,
	tracker: ToolCallTracker,
): Promise<{ stdout: string; returnValue?: unknown; error?: string }> {
	return new Promise((resolve) => {
		// Spawn child process. Use jiti to handle TypeScript.
		const childPath = join(import.meta.dirname, "child-executor.ts");
		const child: ChildProcess = fork(childPath, [], {
			stdio: ["pipe", "pipe", "pipe", "ipc"],
			// Use the same tsx/jiti loader pi uses
			execArgv: ["--import", "jiti/register"],
		});

		let settled = false;
		const finish = (result: { stdout: string; returnValue?: unknown; error?: string }) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			child.kill("SIGKILL");
			resolve(result);
		};

		// Safe send — child may already be dead
		const safeSend = (msg: unknown) => {
			if (child.connected) child.send(msg);
		};

		// Timeout: kill child if it runs too long
		const timeout = setTimeout(() => {
			finish({ stdout: "", error: `Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000}s` });
		}, EXECUTION_TIMEOUT_MS);

		// Ready timeout: detect startup failures quickly
		const readyTimeout = setTimeout(() => {
			finish({ stdout: "", error: "Child process failed to start (ready timeout)" });
		}, 10_000);

		// Abort: kill child if the user cancels
		const onAbort = () => finish({ stdout: "", error: "Execution cancelled" });
		signal?.addEventListener("abort", onAbort, { once: true });

		// Handle child messages
		child.on("message", async (msg: any) => {
			switch (msg.type) {
				case "ready":
					// Child is ready, send the code
					clearTimeout(readyTimeout);
					safeSend({ type: "execute", code });
					break;

				case "tool_call": {
					// Child wants to call a tool — delegate to pi's real implementation
					try {
						const result = await pi.callTool(msg.name, msg.args, { signal });
						const text = extractText(result.content);
						const preview = text.length > 200 ? `${text.slice(0, 200)}...` : text;

						tracker.calls.push({
							tool: msg.name,
							args: msg.args,
							resultPreview: preview,
							isError: result.isError,
						});
						pushUpdate(tracker);

						child.send({
							type: "tool_result",
							id: msg.id,
							content: text,
							isError: result.isError,
						});
					} catch (e: any) {
						const errorMsg = e.message ?? String(e);
						tracker.calls.push({
							tool: msg.name,
							args: msg.args,
							resultPreview: errorMsg,
							isError: true,
						});
						pushUpdate(tracker);

						child.send({
							type: "tool_result",
							id: msg.id,
							content: errorMsg,
							isError: true,
						});
					}
					break;
				}

				case "done":
					finish({
						stdout: msg.stdout ?? "",
						returnValue: msg.returnValue,
						error: msg.error,
					});
					break;
			}
		});

		// Handle child crash
		child.on("exit", (code) => {
			if (!settled) {
				finish({
					stdout: "",
					error: code !== 0 ? `Child process exited with code ${code}` : undefined,
				});
			}
		});

		child.on("error", (err) => {
			finish({ stdout: "", error: `Child process error: ${err.message}` });
		});
	});
}

// ---------------------------------------------------------------------------
// Build tool documentation dynamically from registered tools
// ---------------------------------------------------------------------------

function buildToolDocs(pi: ExtensionAPI): string {
	const tools = pi.getAllTools().filter((t) => t.name !== "code_execution");
	const signatures = tools
		.filter((t) => t.callSignature)
		.map((t) => `// ${t.description.split(".")[0]}.\n${t.callSignature}`)
		.join("\n\n");

	return `
## code_execution tool — available functions

When using the \`code_execution\` tool, the following async functions are in scope.
Do NOT import anything — they are already defined. Use \`console.log()\` to produce
output. Only \`console.log\` output is returned to you. Individual tool call results
do NOT enter your context — log anything you need.

All functions are async and return strings. Use \`await\`.

\`\`\`typescript
${signatures}
\`\`\`

### When to use code_execution

Use \`code_execution\` instead of individual tool calls when:
- You need **3+ tool calls** in sequence where results feed into each other
- You need to **loop** over items (files, matches, directories) calling tools for each
- You want to **filter or aggregate** large results before they enter your context
- You need **conditional logic** based on intermediate tool results
- You're doing **batch operations** (e.g., check 20 files for a pattern, rename multiple files)

Do NOT use \`code_execution\` for:
- Simple single tool calls — use the tool directly
- Tasks where the user needs to see each step interactively

### Example

\`\`\`typescript
// Find all TypeScript files with "TODO", count by directory
const matches = await grep("TODO", { glob: "*.ts" });
const lines = matches.split("\\n").filter(Boolean);

const byDir: Record<string, number> = {};
for (const line of lines) {
  const dir = line.split("/").slice(0, -1).join("/") || ".";
  byDir[dir] = (byDir[dir] || 0) + 1;
}

const sorted = Object.entries(byDir).sort((a, b) => b[1] - a[1]);
for (const [dir, count] of sorted) {
  console.log(\`\${dir}: \${count} TODOs\`);
}
\`\`\`
`;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

const codeExecutionSchema = Type.Object({
	code: Type.String({
		description:
			"TypeScript code to execute. Use top-level await. " +
			"Tool functions (read, write, edit, bash, grep, ls, find, lsp) are in scope — no imports needed. " +
			"Use console.log() to produce output. Only logged output is returned.",
	}),
});

export default function (pi: ExtensionAPI) {
	// Inject tool function signatures into the system prompt (built dynamically from registered tools)
	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: event.systemPrompt + buildToolDocs(pi),
		};
	});

	// Register the code_execution tool
	pi.registerTool({
		name: "code_execution",
		label: "Code Execution",
		description:
			"Execute TypeScript code with pi tool functions (read, write, edit, bash, grep, ls, find, lsp) " +
			"available as async functions. Use console.log() to produce output. Only the final output is " +
			"returned — intermediate tool results do NOT enter your context, saving tokens. " +
			"Use for multi-step workflows, loops over files, filtering large results, and batch operations.",

		parameters: codeExecutionSchema,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const tracker: ToolCallTracker = {
				calls: [],
				onUpdate,
			};

			const result = await executeInChild(params.code, ctx, pi, signal, tracker);

			// Build final output for the LLM
			const parts: string[] = [];

			if (result.stdout) {
				parts.push(result.stdout);
			}

			if (result.returnValue !== undefined) {
				const formatted =
					typeof result.returnValue === "string"
						? result.returnValue
						: JSON.stringify(result.returnValue, null, 2);
				parts.push(`Return value: ${formatted}`);
			}

			if (result.error) {
				parts.push(`Error: ${result.error}`);
			}

			if (parts.length === 0) {
				parts.push("(no output)");
			}

			const output = truncateOutput(parts.join("\n"));

			const content: TextContent[] = [{ type: "text", text: output }];

			return {
				content,
				details: {
					toolCalls: tracker.calls.length,
					calls: tracker.calls,
					error: result.error,
				},
			};
		},
	});
}
