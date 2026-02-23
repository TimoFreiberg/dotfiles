/**
 * Child process for code execution.
 *
 * Runs in a separate Node process. Receives code from the parent,
 * executes it with tool functions in scope, and communicates tool
 * calls back to the parent via IPC.
 *
 * Protocol (all messages are JSON over Node IPC):
 *
 *   Parent → Child:
 *     { type: "execute", code: string }
 *     { type: "tool_result", id: string, content: string, isError: boolean }
 *
 *   Child → Parent:
 *     { type: "tool_call", id: string, name: string, args: Record<string, unknown> }
 *     { type: "done", stdout: string, returnValue?: unknown, error?: string }
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const stdout: string[] = [];
let callCounter = 0;
const pendingCalls = new Map<string, { resolve: (value: string) => void; reject: (error: Error) => void }>();

// ---------------------------------------------------------------------------
// IPC with parent
// ---------------------------------------------------------------------------

function sendToParent(msg: unknown): void {
	process.send!(msg);
}

/**
 * Call a tool in the parent process and wait for the result.
 * The parent calls pi's real tool implementation via callTool().
 */
async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
	const id = `call_${++callCounter}`;

	return new Promise<string>((resolve, reject) => {
		pendingCalls.set(id, { resolve, reject });
		sendToParent({ type: "tool_call", id, name, args });
	});
}

// ---------------------------------------------------------------------------
// Tool functions injected into the model's code scope
// ---------------------------------------------------------------------------

async function read(path: string, options?: { offset?: number; limit?: number }): Promise<string> {
	return callTool("read", { path, ...options });
}

async function write(path: string, content: string): Promise<string> {
	return callTool("write", { path, content });
}

async function edit(params: {
	path: string;
	newText: string;
	startLine?: string;
	endLine?: string;
	insertAfter?: string;
}): Promise<string> {
	return callTool("edit", params);
}

async function bash(command: string, options?: { timeout?: number }): Promise<string> {
	return callTool("bash", { command, ...options });
}

async function grep(
	pattern: string,
	options?: {
		path?: string;
		glob?: string;
		ignoreCase?: boolean;
		limit?: number;
		literal?: boolean;
		context?: number;
	},
): Promise<string> {
	return callTool("grep", { pattern, ...options });
}

async function ls(path?: string): Promise<string> {
	const args: Record<string, unknown> = {};
	if (path) args.path = path;
	return callTool("ls", args);
}

async function find(
	pattern: string,
	options?: { path?: string; type?: "file" | "directory"; maxDepth?: number },
): Promise<string> {
	return callTool("find", { pattern, ...options });
}

async function lsp(params: {
	action: "hover" | "definition" | "references" | "symbols" | "workspace_symbols";
	file?: string;
	line?: number;
	col?: number;
	query?: string;
	symbol?: string;
}): Promise<string> {
	return callTool("lsp", params);
}

// ---------------------------------------------------------------------------
// console.log capture
// ---------------------------------------------------------------------------

const capturedConsole = {
	log: (...args: unknown[]) => {
		stdout.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2))).join(" "));
	},
	warn: (...args: unknown[]) => {
		stdout.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2))).join(" "));
	},
	error: (...args: unknown[]) => {
		stdout.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2))).join(" "));
	},
	info: (...args: unknown[]) => {
		stdout.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2))).join(" "));
	},
	debug: () => {},
};

// ---------------------------------------------------------------------------
// Code execution
// ---------------------------------------------------------------------------

async function execute(code: string): Promise<void> {
	try {
		const fn = new Function(
			"read",
			"write",
			"edit",
			"bash",
			"grep",
			"ls",
			"find",
			"lsp",
			"console",
			`return (async () => {\n${code}\n})();`,
		);

		const returnValue = await fn(read, write, edit, bash, grep, ls, find, lsp, capturedConsole);

		sendToParent({
			type: "done",
			stdout: stdout.join("\n"),
			returnValue: returnValue !== undefined ? returnValue : undefined,
		});
	} catch (e: any) {
		sendToParent({
			type: "done",
			stdout: stdout.join("\n"),
			error: e.message ?? String(e),
		});
	}
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

process.on("message", (msg: any) => {
	switch (msg.type) {
		case "execute":
			execute(msg.code);
			break;

		case "tool_result": {
			const pending = pendingCalls.get(msg.id);
			if (pending) {
				pendingCalls.delete(msg.id);
				if (msg.isError) {
					pending.reject(new Error(msg.content));
				} else {
					pending.resolve(msg.content);
				}
			}
			break;
		}
	}
});

// Signal readiness
sendToParent({ type: "ready" });
