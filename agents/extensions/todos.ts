/**
 * Todo extension — file-per-todo in .pi/todos/ (or PI_TODO_PATH).
 *
 * Each todo is a markdown file with YAML front-matter:
 *
 *   ---
 *   id: deadbeef
 *   title: Add tests
 *   tags: [qa]
 *   status: open
 *   created_at: "2026-01-25T17:00:00.000Z"
 *   assigned_to_session: session.json
 *   ---
 *
 *   Notes about the work go here.
 *
 * Storage settings in <todo-dir>/settings.json:
 *   { "gc": true, "gcDays": 7 }
 *
 * Use `/todos` for the interactive TUI or let the agent use the `todo` tool.
 *
 * Based on mitsuhiko's todos extension, adapted with YAML front-matter.
 */
import {
	DynamicBorder,
	copyToClipboard,
	getMarkdownTheme,
	keyHint,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import crypto from "node:crypto";
import {
	Container,
	type Focusable,
	Input,
	Key,
	Markdown,
	SelectList,
	Spacer,
	type SelectItem,
	Text,
	TUI,
	fuzzyMatch,
	getEditorKeybindings,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TODO_DIR_NAME = ".pi/todos";
const TODO_PATH_ENV = "PI_TODO_PATH";
const TODO_SETTINGS_NAME = "settings.json";
const TODO_ID_PREFIX = "TODO-";
const TODO_ID_PATTERN = /^[a-f0-9]{8}$/i;
const DEFAULT_TODO_SETTINGS: TodoSettings = { gc: true, gcDays: 7 };
const LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TodoFrontMatter {
	id: string;
	title: string;
	tags: string[];
	status: string;
	created_at: string;
	assigned_to_session?: string;
}

interface TodoRecord extends TodoFrontMatter {
	body: string;
}

interface LockInfo {
	id: string;
	pid: number;
	session?: string | null;
	created_at: string;
}

interface TodoSettings {
	gc: boolean;
	gcDays: number;
}

type TodoAction =
	| "list"
	| "list-all"
	| "get"
	| "create"
	| "update"
	| "append"
	| "delete"
	| "claim"
	| "release";

type TodoOverlayAction = "back" | "work";

type TodoMenuAction =
	| "work"
	| "refine"
	| "close"
	| "reopen"
	| "release"
	| "delete"
	| "copyPath"
	| "copyText"
	| "view";

type TodoToolDetails =
	| { action: "list" | "list-all"; todos: TodoFrontMatter[]; currentSessionId?: string; error?: string }
	| {
			action: "get" | "create" | "update" | "append" | "delete" | "claim" | "release";
			todo?: TodoRecord;
			error?: string;
	  };

const TodoParams = Type.Object({
	action: StringEnum([
		"list",
		"list-all",
		"get",
		"create",
		"update",
		"append",
		"delete",
		"claim",
		"release",
	] as const),
	id: Type.Optional(Type.String({ description: "Todo id (TODO-<hex> or raw hex filename)" })),
	title: Type.Optional(Type.String({ description: "Short summary shown in lists" })),
	status: Type.Optional(Type.String({ description: "Todo status" })),
	tags: Type.Optional(Type.Array(Type.String({ description: "Todo tag" }))),
	body: Type.Optional(
		Type.String({ description: "Long-form details (markdown). Update replaces; append adds." }),
	),
	force: Type.Optional(Type.Boolean({ description: "Override another session's assignment" })),
});

// ---------------------------------------------------------------------------
// YAML front-matter helpers (minimal, no dependency)
// ---------------------------------------------------------------------------

function serializeYamlFrontMatter(fm: TodoFrontMatter): string {
	const lines: string[] = ["---"];
	lines.push(`id: ${fm.id}`);
	lines.push(`title: ${yamlQuote(fm.title)}`);
	if (fm.tags.length) {
		lines.push(`tags: [${fm.tags.map(yamlQuote).join(", ")}]`);
	} else {
		lines.push("tags: []");
	}
	lines.push(`status: ${fm.status}`);
	lines.push(`created_at: "${fm.created_at}"`);
	if (fm.assigned_to_session) {
		lines.push(`assigned_to_session: ${yamlQuote(fm.assigned_to_session)}`);
	}
	lines.push("---");
	return lines.join("\n");
}

/** Quote a string value for YAML if it contains special chars */
function yamlQuote(s: string): string {
	if (!s) return '""';
	if (/[:{}\[\],&*?|>!%#`@"'\\\n\r\t]/.test(s) || s.trim() !== s || /^\d/.test(s)) {
		return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return s;
}

function parseYamlFrontMatter(content: string, idFallback: string): { fm: TodoFrontMatter; body: string } {
	const defaultFm: TodoFrontMatter = {
		id: idFallback,
		title: "",
		tags: [],
		status: "open",
		created_at: "",
		assigned_to_session: undefined,
	};

	const yamlMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (yamlMatch) {
		const fm = parseSimpleYaml(yamlMatch[1], idFallback);
		const body = (yamlMatch[2] ?? "").replace(/^\n+/, "");
		return { fm, body };
	}

	return { fm: defaultFm, body: content };
}

/** Minimal YAML key-value parser — handles the flat structure we write */
function parseSimpleYaml(yaml: string, idFallback: string): TodoFrontMatter {
	const fm: TodoFrontMatter = {
		id: idFallback,
		title: "",
		tags: [],
		status: "open",
		created_at: "",
		assigned_to_session: undefined,
	};

	for (const line of yaml.split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const key = line.slice(0, colonIdx).trim();
		const rawVal = line.slice(colonIdx + 1).trim();
		const val = unquoteYaml(rawVal);

		switch (key) {
			case "id":
				if (val) fm.id = val;
				break;
			case "title":
				fm.title = val;
				break;
			case "status":
				if (val) fm.status = val;
				break;
			case "created_at":
				fm.created_at = val;
				break;
			case "assigned_to_session":
				fm.assigned_to_session = val || undefined;
				break;
			case "tags": {
				const inner = rawVal.replace(/^\[/, "").replace(/\]$/, "").trim();
				if (inner) {
					fm.tags = inner.split(",").map((t) => unquoteYaml(t.trim())).filter(Boolean);
				}
				break;
			}
		}
	}

	return fm;
}

function unquoteYaml(s: string): string {
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
	}
	return s;
}

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------

function formatTodoId(id: string): string {
	return `${TODO_ID_PREFIX}${id}`;
}

function normalizeTodoId(id: string): string {
	let t = id.trim();
	if (t.startsWith("#")) t = t.slice(1);
	if (t.toUpperCase().startsWith(TODO_ID_PREFIX)) t = t.slice(TODO_ID_PREFIX.length);
	return t;
}

function validateTodoId(id: string): { id: string } | { error: string } {
	const n = normalizeTodoId(id);
	if (!n || !TODO_ID_PATTERN.test(n)) return { error: "Invalid todo id. Expected TODO-<hex>." };
	return { id: n.toLowerCase() };
}

function displayTodoId(id: string): string {
	return formatTodoId(normalizeTodoId(id));
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function isTodoClosed(status: string): boolean {
	return ["closed", "done"].includes(status.toLowerCase());
}

function clearAssignmentIfClosed(todo: TodoFrontMatter): void {
	if (isTodoClosed(todo.status ?? "open")) todo.assigned_to_session = undefined;
}

function getTodoStatus(todo: TodoFrontMatter): string {
	return todo.status || "open";
}

function getTodoTitle(todo: TodoFrontMatter): string {
	return todo.title || "(untitled)";
}

// ---------------------------------------------------------------------------
// Sorting & filtering
// ---------------------------------------------------------------------------

function sortTodos(todos: TodoFrontMatter[]): TodoFrontMatter[] {
	return [...todos].sort((a, b) => {
		const ac = isTodoClosed(a.status), bc = isTodoClosed(b.status);
		if (ac !== bc) return ac ? 1 : -1;
		const aA = !ac && Boolean(a.assigned_to_session);
		const bA = !bc && Boolean(b.assigned_to_session);
		if (aA !== bA) return aA ? -1 : 1;
		return (a.created_at || "").localeCompare(b.created_at || "");
	});
}

function buildSearchText(todo: TodoFrontMatter): string {
	const tags = todo.tags.join(" ");
	const assign = todo.assigned_to_session ? `assigned:${todo.assigned_to_session}` : "";
	return `${formatTodoId(todo.id)} ${todo.id} ${todo.title} ${tags} ${todo.status} ${assign}`.trim();
}

function filterTodos(todos: TodoFrontMatter[], query: string): TodoFrontMatter[] {
	const trimmed = query.trim();
	if (!trimmed) return todos;
	const tokens = trimmed.split(/\s+/).filter(Boolean);
	if (!tokens.length) return todos;

	const matches: Array<{ todo: TodoFrontMatter; score: number }> = [];
	for (const todo of todos) {
		const text = buildSearchText(todo);
		let totalScore = 0;
		let ok = true;
		for (const token of tokens) {
			const result = fuzzyMatch(token, text);
			if (!result.matches) { ok = false; break; }
			totalScore += result.score;
		}
		if (ok) matches.push({ todo, score: totalScore });
	}

	return matches
		.sort((a, b) => {
			const ac = isTodoClosed(a.todo.status), bc = isTodoClosed(b.todo.status);
			if (ac !== bc) return ac ? 1 : -1;
			const aA = !ac && Boolean(a.todo.assigned_to_session);
			const bA = !bc && Boolean(b.todo.assigned_to_session);
			if (aA !== bA) return aA ? -1 : 1;
			return a.score - b.score;
		})
		.map((m) => m.todo);
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function getTodosDir(cwd: string): string {
	const env = process.env[TODO_PATH_ENV];
	return env?.trim() ? path.resolve(cwd, env.trim()) : path.resolve(cwd, TODO_DIR_NAME);
}

function getTodosDirLabel(cwd: string): string {
	const env = process.env[TODO_PATH_ENV];
	return env?.trim() ? path.resolve(cwd, env.trim()) : TODO_DIR_NAME;
}

function getTodoPath(dir: string, id: string): string {
	return path.join(dir, `${id}.md`);
}

function getLockPath(dir: string, id: string): string {
	return path.join(dir, `${id}.lock`);
}

function getTodoSettingsPath(dir: string): string {
	return path.join(dir, TODO_SETTINGS_NAME);
}

async function ensureTodosDir(dir: string) {
	await fs.mkdir(dir, { recursive: true });
}

function parseTodoContent(content: string, idFallback: string): TodoRecord {
	const { fm, body } = parseYamlFrontMatter(content, idFallback);
	return { ...fm, id: idFallback, body: body ?? "" };
}

function serializeTodo(todo: TodoRecord): string {
	const fm: TodoFrontMatter = {
		id: todo.id,
		title: todo.title,
		tags: todo.tags ?? [],
		status: todo.status,
		created_at: todo.created_at,
		assigned_to_session: todo.assigned_to_session,
	};
	const header = serializeYamlFrontMatter(fm);
	const body = (todo.body ?? "").replace(/^\n+/, "").replace(/\s+$/, "");
	return body ? `${header}\n\n${body}\n` : `${header}\n`;
}

async function readTodoFile(filePath: string, idFallback: string): Promise<TodoRecord> {
	const content = await fs.readFile(filePath, "utf8");
	return parseTodoContent(content, idFallback);
}

async function writeTodoFile(filePath: string, todo: TodoRecord) {
	await fs.writeFile(filePath, serializeTodo(todo), "utf8");
}

async function generateTodoId(dir: string): Promise<string> {
	for (let attempt = 0; attempt < 10; attempt++) {
		const id = crypto.randomBytes(4).toString("hex");
		if (!existsSync(getTodoPath(dir, id))) return id;
	}
	throw new Error("Failed to generate unique todo id");
}

// ---------------------------------------------------------------------------
// Settings & GC
// ---------------------------------------------------------------------------

function normalizeTodoSettings(raw: Partial<TodoSettings>): TodoSettings {
	return {
		gc: raw.gc ?? DEFAULT_TODO_SETTINGS.gc,
		gcDays: Number.isFinite(raw.gcDays) ? Math.max(0, Math.floor(raw.gcDays!)) : DEFAULT_TODO_SETTINGS.gcDays,
	};
}

async function readTodoSettings(dir: string): Promise<TodoSettings> {
	try {
		const raw = JSON.parse(await fs.readFile(getTodoSettingsPath(dir), "utf8")) as Partial<TodoSettings>;
		return normalizeTodoSettings(raw);
	} catch {
		return { ...DEFAULT_TODO_SETTINGS };
	}
}

async function garbageCollectTodos(dir: string, settings: TodoSettings): Promise<void> {
	if (!settings.gc) return;
	let entries: string[];
	try { entries = await fs.readdir(dir); } catch { return; }

	const cutoff = Date.now() - settings.gcDays * 24 * 60 * 60 * 1000;
	await Promise.all(
		entries
			.filter((e) => e.endsWith(".md"))
			.map(async (entry) => {
				const id = entry.slice(0, -3);
				const filePath = path.join(dir, entry);
				try {
					const content = await fs.readFile(filePath, "utf8");
					const { fm } = parseYamlFrontMatter(content, id);
					if (!isTodoClosed(fm.status)) return;
					const created = Date.parse(fm.created_at);
					if (Number.isFinite(created) && created < cutoff) await fs.unlink(filePath);
				} catch { /* ignore */ }
			}),
	);
}

// ---------------------------------------------------------------------------
// Locking (atomic via O_EXCL)
// ---------------------------------------------------------------------------

async function readLockInfo(lockPath: string): Promise<LockInfo | null> {
	try {
		return JSON.parse(await fs.readFile(lockPath, "utf8")) as LockInfo;
	} catch {
		return null;
	}
}

async function acquireLock(
	dir: string,
	id: string,
	ctx: ExtensionContext,
): Promise<(() => Promise<void>) | { error: string }> {
	const lockPath = getLockPath(dir, id);
	const now = Date.now();
	const session = ctx.sessionManager.getSessionFile();

	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const handle = await fs.open(lockPath, "wx");
			const info: LockInfo = { id, pid: process.pid, session, created_at: new Date(now).toISOString() };
			await handle.writeFile(JSON.stringify(info, null, 2), "utf8");
			await handle.close();
			return async () => { try { await fs.unlink(lockPath); } catch { /* ignore */ } };
		} catch (error: any) {
			if (error?.code !== "EEXIST") {
				return { error: `Failed to acquire lock: ${error?.message ?? "unknown error"}` };
			}
			const stats = await fs.stat(lockPath).catch(() => null);
			const lockAge = stats ? now - stats.mtimeMs : LOCK_TTL_MS + 1;
			if (lockAge <= LOCK_TTL_MS) {
				const info = await readLockInfo(lockPath);
				const owner = info?.session ? ` (session ${info.session})` : "";
				return { error: `Todo ${displayTodoId(id)} is locked${owner}. Try again later.` };
			}
			if (!ctx.hasUI) {
				return { error: `Todo ${displayTodoId(id)} lock is stale; rerun in interactive mode to steal it.` };
			}
			const ok = await ctx.ui.confirm("Todo locked", `Todo ${displayTodoId(id)} appears locked. Steal the lock?`);
			if (!ok) return { error: `Todo ${displayTodoId(id)} remains locked.` };
			await fs.unlink(lockPath).catch(() => undefined);
		}
	}
	return { error: `Failed to acquire lock for todo ${displayTodoId(id)}.` };
}

async function withTodoLock<T>(
	dir: string,
	id: string,
	ctx: ExtensionContext,
	fn: () => Promise<T>,
): Promise<T | { error: string }> {
	const lock = await acquireLock(dir, id, ctx);
	if (typeof lock === "object" && "error" in lock) return lock;
	try { return await fn(); } finally { await lock(); }
}

// ---------------------------------------------------------------------------
// Todo listing
// ---------------------------------------------------------------------------

async function listTodos(dir: string): Promise<TodoFrontMatter[]> {
	let entries: string[];
	try { entries = await fs.readdir(dir); } catch { return []; }

	const todos: TodoFrontMatter[] = [];
	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue;
		const id = entry.slice(0, -3);
		try {
			const content = await fs.readFile(path.join(dir, entry), "utf8");
			const { fm } = parseYamlFrontMatter(content, id);
			todos.push({ id, title: fm.title, tags: fm.tags, status: fm.status, created_at: fm.created_at, assigned_to_session: fm.assigned_to_session });
		} catch { /* ignore */ }
	}
	return sortTodos(todos);
}

function listTodosSync(dir: string): TodoFrontMatter[] {
	let entries: string[];
	try { entries = readdirSync(dir); } catch { return []; }

	const todos: TodoFrontMatter[] = [];
	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue;
		const id = entry.slice(0, -3);
		try {
			const content = readFileSync(path.join(dir, entry), "utf8");
			const { fm } = parseYamlFrontMatter(content, id);
			todos.push({ id, title: fm.title, tags: fm.tags, status: fm.status, created_at: fm.created_at, assigned_to_session: fm.assigned_to_session });
		} catch { /* ignore */ }
	}
	return sortTodos(todos);
}

// ---------------------------------------------------------------------------
// Todo mutations
// ---------------------------------------------------------------------------

async function ensureTodoExists(filePath: string, id: string): Promise<TodoRecord | null> {
	if (!existsSync(filePath)) return null;
	return readTodoFile(filePath, id);
}

async function appendTodoBody(filePath: string, todo: TodoRecord, text: string): Promise<TodoRecord> {
	const spacer = todo.body.trim().length ? "\n\n" : "";
	todo.body = `${todo.body.replace(/\s+$/, "")}${spacer}${text.trim()}\n`;
	await writeTodoFile(filePath, todo);
	return todo;
}

async function updateTodoStatus(
	dir: string, id: string, status: string, ctx: ExtensionContext,
): Promise<TodoRecord | { error: string }> {
	const v = validateTodoId(id);
	if ("error" in v) return v;
	const filePath = getTodoPath(dir, v.id);
	if (!existsSync(filePath)) return { error: `Todo ${displayTodoId(id)} not found` };

	return (await withTodoLock(dir, v.id, ctx, async () => {
		const existing = await ensureTodoExists(filePath, v.id);
		if (!existing) return { error: `Todo ${displayTodoId(id)} not found` } as const;
		existing.status = status;
		clearAssignmentIfClosed(existing);
		await writeTodoFile(filePath, existing);
		return existing;
	})) as TodoRecord | { error: string };
}

async function claimTodoAssignment(
	dir: string, id: string, ctx: ExtensionContext, force = false,
): Promise<TodoRecord | { error: string }> {
	const v = validateTodoId(id);
	if ("error" in v) return v;
	const filePath = getTodoPath(dir, v.id);
	if (!existsSync(filePath)) return { error: `Todo ${displayTodoId(id)} not found` };

	const sessionId = ctx.sessionManager.getSessionId();
	return (await withTodoLock(dir, v.id, ctx, async () => {
		const existing = await ensureTodoExists(filePath, v.id);
		if (!existing) return { error: `Todo ${displayTodoId(id)} not found` } as const;
		if (isTodoClosed(existing.status)) return { error: `Todo ${displayTodoId(id)} is closed` } as const;
		const assigned = existing.assigned_to_session;
		if (assigned && assigned !== sessionId && !force) {
			return { error: `Todo ${displayTodoId(id)} is already assigned to session ${assigned}. Use force to override.` } as const;
		}
		if (assigned !== sessionId) {
			existing.assigned_to_session = sessionId;
			await writeTodoFile(filePath, existing);
		}
		return existing;
	})) as TodoRecord | { error: string };
}

async function releaseTodoAssignment(
	dir: string, id: string, ctx: ExtensionContext, force = false,
): Promise<TodoRecord | { error: string }> {
	const v = validateTodoId(id);
	if ("error" in v) return v;
	const filePath = getTodoPath(dir, v.id);
	if (!existsSync(filePath)) return { error: `Todo ${displayTodoId(id)} not found` };

	const sessionId = ctx.sessionManager.getSessionId();
	return (await withTodoLock(dir, v.id, ctx, async () => {
		const existing = await ensureTodoExists(filePath, v.id);
		if (!existing) return { error: `Todo ${displayTodoId(id)} not found` } as const;
		const assigned = existing.assigned_to_session;
		if (!assigned) return existing;
		if (assigned !== sessionId && !force) {
			return { error: `Todo ${displayTodoId(id)} is assigned to session ${assigned}. Use force to release.` } as const;
		}
		existing.assigned_to_session = undefined;
		await writeTodoFile(filePath, existing);
		return existing;
	})) as TodoRecord | { error: string };
}

async function deleteTodo(
	dir: string, id: string, ctx: ExtensionContext,
): Promise<TodoRecord | { error: string }> {
	const v = validateTodoId(id);
	if ("error" in v) return v;
	const filePath = getTodoPath(dir, v.id);
	if (!existsSync(filePath)) return { error: `Todo ${displayTodoId(id)} not found` };

	return (await withTodoLock(dir, v.id, ctx, async () => {
		const existing = await ensureTodoExists(filePath, v.id);
		if (!existing) return { error: `Todo ${displayTodoId(id)} not found` } as const;
		await fs.unlink(filePath);
		return existing;
	})) as TodoRecord | { error: string };
}

// ---------------------------------------------------------------------------
// Formatting for agent / display
// ---------------------------------------------------------------------------

function splitTodosByAssignment(todos: TodoFrontMatter[]) {
	const assigned: TodoFrontMatter[] = [];
	const open: TodoFrontMatter[] = [];
	const closed: TodoFrontMatter[] = [];
	for (const t of todos) {
		if (isTodoClosed(getTodoStatus(t))) { closed.push(t); continue; }
		(t.assigned_to_session ? assigned : open).push(t);
	}
	return { assigned, open, closed };
}

function serializeTodoForAgent(todo: TodoRecord): string {
	return JSON.stringify({ ...todo, id: formatTodoId(todo.id) }, null, 2);
}

function serializeTodoListForAgent(todos: TodoFrontMatter[]): string {
	const { assigned, open, closed } = splitTodosByAssignment(todos);
	const map = (t: TodoFrontMatter) => ({ ...t, id: formatTodoId(t.id) });
	return JSON.stringify({ assigned: assigned.map(map), open: open.map(map), closed: closed.map(map) }, null, 2);
}

function formatTodoHeading(todo: TodoFrontMatter): string {
	const tagText = todo.tags.length ? ` [${todo.tags.join(", ")}]` : "";
	const assignText = todo.assigned_to_session ? ` (assigned: ${todo.assigned_to_session})` : "";
	return `${formatTodoId(todo.id)} ${getTodoTitle(todo)}${tagText}${assignText}`;
}

function formatTodoList(todos: TodoFrontMatter[]): string {
	if (!todos.length) return "No todos.";
	const { assigned, open, closed } = splitTodosByAssignment(todos);
	const lines: string[] = [];
	const section = (label: string, items: TodoFrontMatter[]) => {
		lines.push(`${label} (${items.length}):`);
		if (!items.length) { lines.push("  none"); return; }
		for (const t of items) lines.push(`  ${formatTodoHeading(t)}`);
	};
	section("Assigned todos", assigned);
	section("Open todos", open);
	section("Closed todos", closed);
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// TUI rendering helpers
// ---------------------------------------------------------------------------

function renderAssignmentSuffix(theme: Theme, todo: TodoFrontMatter, currentSessionId?: string): string {
	if (!todo.assigned_to_session) return "";
	const isCurrent = todo.assigned_to_session === currentSessionId;
	const color = isCurrent ? "success" : "dim";
	const suffix = isCurrent ? ", current" : "";
	return theme.fg(color, ` (assigned: ${todo.assigned_to_session}${suffix})`);
}

function renderTodoHeading(theme: Theme, todo: TodoFrontMatter, currentSessionId?: string): string {
	const closed = isTodoClosed(getTodoStatus(todo));
	const titleColor = closed ? "dim" : "text";
	const tagText = todo.tags.length ? theme.fg("dim", ` [${todo.tags.join(", ")}]`) : "";
	return (
		theme.fg("accent", formatTodoId(todo.id)) +
		" " +
		theme.fg(titleColor, getTodoTitle(todo)) +
		tagText +
		renderAssignmentSuffix(theme, todo, currentSessionId)
	);
}

function renderTodoList(theme: Theme, todos: TodoFrontMatter[], expanded: boolean, currentSessionId?: string): string {
	if (!todos.length) return theme.fg("dim", "No todos");
	const { assigned, open, closed } = splitTodosByAssignment(todos);
	const lines: string[] = [];

	const section = (label: string, items: TodoFrontMatter[], idx: number) => {
		if (idx > 0) lines.push("");
		lines.push(theme.fg("muted", `${label} (${items.length})`));
		if (!items.length) { lines.push(theme.fg("dim", "  none")); return; }
		const max = expanded ? items.length : Math.min(items.length, 3);
		for (let i = 0; i < max; i++) lines.push(`  ${renderTodoHeading(theme, items[i], currentSessionId)}`);
		if (!expanded && items.length > max) lines.push(theme.fg("dim", `  ... ${items.length - max} more`));
	};

	section("Assigned todos", assigned, 0);
	section("Open todos", open, 1);
	section("Closed todos", closed, 2);
	return lines.join("\n");
}

function renderTodoDetail(theme: Theme, todo: TodoRecord, expanded: boolean): string {
	const summary = renderTodoHeading(theme, todo);
	if (!expanded) return summary;
	const tags = todo.tags.length ? todo.tags.join(", ") : "none";
	const bodyLines = (todo.body?.trim() || "No details yet.").split("\n");
	return [
		summary,
		theme.fg("muted", `Status: ${getTodoStatus(todo)}`),
		theme.fg("muted", `Tags: ${tags}`),
		theme.fg("muted", `Created: ${todo.created_at || "unknown"}`),
		"",
		theme.fg("muted", "Body:"),
		...bodyLines.map((l) => theme.fg("text", `  ${l}`)),
	].join("\n");
}

function appendExpandHint(theme: Theme, text: string): string {
	return `${text}\n${theme.fg("dim", `(${keyHint("expandTools", "to expand")})`)}`;
}

function buildRefinePrompt(todoId: string, title: string): string {
	return (
		`let's refine task ${formatTodoId(todoId)} "${title}": ` +
		"Ask me for the missing details needed to refine the todo together. Do not rewrite the todo yet and do not make assumptions. " +
		"Ask clear, concrete questions and wait for my answers before drafting any structured description.\n\n"
	);
}

// ---------------------------------------------------------------------------
// TUI components
// ---------------------------------------------------------------------------

class TodoSelectorComponent extends Container implements Focusable {
	private searchInput: Input;
	private listContainer: Container;
	private allTodos: TodoFrontMatter[];
	private filteredTodos: TodoFrontMatter[];
	private selectedIndex = 0;
	private onSelectCallback: (todo: TodoFrontMatter) => void;
	private onCancelCallback: () => void;
	private tui: TUI;
	private theme: Theme;
	private headerText: Text;
	private hintText: Text;
	private currentSessionId?: string;
	private onQuickAction?: (todo: TodoFrontMatter, action: "work" | "refine") => void;

	private _focused = false;
	get focused() { return this._focused; }
	set focused(v: boolean) { this._focused = v; this.searchInput.focused = v; }

	constructor(
		tui: TUI,
		theme: Theme,
		todos: TodoFrontMatter[],
		onSelect: (todo: TodoFrontMatter) => void,
		onCancel: () => void,
		initialSearch?: string,
		currentSessionId?: string,
		onQuickAction?: (todo: TodoFrontMatter, action: "work" | "refine") => void,
	) {
		super();
		this.tui = tui;
		this.theme = theme;
		this.allTodos = todos;
		this.filteredTodos = todos;
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;
		this.currentSessionId = currentSessionId;
		this.onQuickAction = onQuickAction;

		this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		this.addChild(new Spacer(1));
		this.headerText = new Text("", 1, 0);
		this.addChild(this.headerText);
		this.addChild(new Spacer(1));

		this.searchInput = new Input();
		if (initialSearch) this.searchInput.setValue(initialSearch);
		this.searchInput.onSubmit = () => {
			const sel = this.filteredTodos[this.selectedIndex];
			if (sel) this.onSelectCallback(sel);
		};
		this.addChild(this.searchInput);
		this.addChild(new Spacer(1));

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));

		this.hintText = new Text("", 1, 0);
		this.addChild(this.hintText);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		this.updateHeader();
		this.updateHints();
		this.applyFilter(this.searchInput.getValue());
	}

	setTodos(todos: TodoFrontMatter[]) {
		this.allTodos = todos;
		this.updateHeader();
		this.applyFilter(this.searchInput.getValue());
		this.tui.requestRender();
	}

	private updateHeader() {
		const openCount = this.allTodos.filter((t) => !isTodoClosed(t.status)).length;
		const closedCount = this.allTodos.length - openCount;
		this.headerText.setText(this.theme.fg("accent", this.theme.bold(`Todos (${openCount} open, ${closedCount} closed)`)));
	}

	private updateHints() {
		this.hintText.setText(
			this.theme.fg("dim", "Type to search • ↑↓ select • Enter actions • Ctrl+Shift+W work • Ctrl+Shift+R refine • Esc close"),
		);
	}

	private applyFilter(query: string) {
		this.filteredTodos = filterTodos(this.allTodos, query);
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredTodos.length - 1));
		this.updateList();
	}

	private updateList() {
		this.listContainer.clear();
		if (!this.filteredTodos.length) {
			this.listContainer.addChild(new Text(this.theme.fg("muted", "  No matching todos"), 0, 0));
			return;
		}
		const maxVisible = 10;
		const startIdx = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filteredTodos.length - maxVisible));
		const endIdx = Math.min(startIdx + maxVisible, this.filteredTodos.length);

		for (let i = startIdx; i < endIdx; i++) {
			const todo = this.filteredTodos[i];
			if (!todo) continue;
			const isSel = i === this.selectedIndex;
			const closed = isTodoClosed(todo.status);
			const prefix = isSel ? this.theme.fg("accent", "→ ") : "  ";
			const titleColor = isSel ? "accent" : closed ? "dim" : "text";
			const statusColor = closed ? "dim" : "success";
			const tagText = todo.tags.length ? ` [${todo.tags.join(", ")}]` : "";
			const line =
				prefix +
				this.theme.fg("accent", formatTodoId(todo.id)) + " " +
				this.theme.fg(titleColor, todo.title || "(untitled)") +
				this.theme.fg("muted", tagText) +
				renderAssignmentSuffix(this.theme, todo, this.currentSessionId) + " " +
				this.theme.fg(statusColor, `(${todo.status || "open"})`);
			this.listContainer.addChild(new Text(line, 0, 0));
		}

		if (startIdx > 0 || endIdx < this.filteredTodos.length) {
			const scrollInfo = this.theme.fg("dim", `  (${this.selectedIndex + 1}/${this.filteredTodos.length})`);
			this.listContainer.addChild(new Text(scrollInfo, 0, 0));
		}
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();
		if (kb.matches(keyData, "selectUp")) {
			if (!this.filteredTodos.length) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredTodos.length - 1 : this.selectedIndex - 1;
			this.updateList();
			return;
		}
		if (kb.matches(keyData, "selectDown")) {
			if (!this.filteredTodos.length) return;
			this.selectedIndex = this.selectedIndex === this.filteredTodos.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			return;
		}
		if (kb.matches(keyData, "selectConfirm")) {
			const sel = this.filteredTodos[this.selectedIndex];
			if (sel) this.onSelectCallback(sel);
			return;
		}
		if (kb.matches(keyData, "selectCancel")) {
			this.onCancelCallback();
			return;
		}
		if (matchesKey(keyData, Key.ctrlShift("r"))) {
			const sel = this.filteredTodos[this.selectedIndex];
			if (sel && this.onQuickAction) this.onQuickAction(sel, "refine");
			return;
		}
		if (matchesKey(keyData, Key.ctrlShift("w"))) {
			const sel = this.filteredTodos[this.selectedIndex];
			if (sel && this.onQuickAction) this.onQuickAction(sel, "work");
			return;
		}
		this.searchInput.handleInput(keyData);
		this.applyFilter(this.searchInput.getValue());
	}

	override invalidate(): void {
		super.invalidate();
		this.updateHeader();
		this.updateHints();
		this.updateList();
	}
}

class TodoActionMenuComponent extends Container {
	private selectList: SelectList;
	private onSelectCb: (action: TodoMenuAction) => void;
	private onCancelCb: () => void;

	constructor(theme: Theme, todo: TodoRecord, onSelect: (action: TodoMenuAction) => void, onCancel: () => void) {
		super();
		this.onSelectCb = onSelect;
		this.onCancelCb = onCancel;

		const closed = isTodoClosed(todo.status);
		const title = todo.title || "(untitled)";
		const options: SelectItem[] = [
			{ value: "view", label: "view", description: "View todo" },
			{ value: "work", label: "work", description: "Work on todo" },
			{ value: "refine", label: "refine", description: "Refine task" },
			...(closed
				? [{ value: "reopen", label: "reopen", description: "Reopen todo" }]
				: [{ value: "close", label: "close", description: "Close todo" }]),
			...(todo.assigned_to_session
				? [{ value: "release", label: "release", description: "Release assignment" }]
				: []),
			{ value: "copyPath", label: "copy path", description: "Copy absolute path to clipboard" },
			{ value: "copyText", label: "copy text", description: "Copy title and body to clipboard" },
			{ value: "delete", label: "delete", description: "Delete todo" },
		];

		this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		this.addChild(new Text(theme.fg("accent", theme.bold(`Actions for ${formatTodoId(todo.id)} "${title}"`)), 0, 0));

		this.selectList = new SelectList(options, options.length, {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		this.selectList.onSelect = (item) => this.onSelectCb(item.value as TodoMenuAction);
		this.selectList.onCancel = () => this.onCancelCb();

		this.addChild(this.selectList);
		this.addChild(new Text(theme.fg("dim", "Enter to confirm • Esc back"), 0, 0));
		this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
	}

	handleInput(keyData: string): void { this.selectList.handleInput(keyData); }
	override invalidate(): void { super.invalidate(); }
}

class TodoDeleteConfirmComponent extends Container {
	private selectList: SelectList;

	constructor(theme: Theme, message: string, onConfirm: (confirmed: boolean) => void) {
		super();

		const options: SelectItem[] = [
			{ value: "yes", label: "Yes" },
			{ value: "no", label: "No" },
		];

		this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		this.addChild(new Text(theme.fg("accent", message), 0, 0));

		this.selectList = new SelectList(options, options.length, {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		this.selectList.onSelect = (item) => onConfirm(item.value === "yes");
		this.selectList.onCancel = () => onConfirm(false);

		this.addChild(this.selectList);
		this.addChild(new Text(theme.fg("dim", "Enter to confirm • Esc back"), 0, 0));
		this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
	}

	handleInput(keyData: string): void { this.selectList.handleInput(keyData); }
	override invalidate(): void { super.invalidate(); }
}

class TodoDetailOverlayComponent {
	private todo: TodoRecord;
	private theme: Theme;
	private tui: TUI;
	private markdown: Markdown;
	private scrollOffset = 0;
	private viewHeight = 0;
	private totalLines = 0;
	private onAction: (action: TodoOverlayAction) => void;

	constructor(tui: TUI, theme: Theme, todo: TodoRecord, onAction: (action: TodoOverlayAction) => void) {
		this.tui = tui;
		this.theme = theme;
		this.todo = todo;
		this.onAction = onAction;
		this.markdown = new Markdown(this.getMarkdownText(), 1, 0, getMarkdownTheme());
	}

	private getMarkdownText(): string {
		const body = this.todo.body?.trim();
		return body || "_No details yet._";
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();
		if (kb.matches(keyData, "selectCancel")) { this.onAction("back"); return; }
		if (kb.matches(keyData, "selectConfirm")) { this.onAction("work"); return; }
		if (kb.matches(keyData, "selectUp")) { this.scrollBy(-1); return; }
		if (kb.matches(keyData, "selectDown")) { this.scrollBy(1); return; }
		if (kb.matches(keyData, "selectPageUp")) { this.scrollBy(-this.viewHeight || -1); return; }
		if (kb.matches(keyData, "selectPageDown")) { this.scrollBy(this.viewHeight || 1); return; }
	}

	render(width: number): string[] {
		const maxHeight = Math.max(10, Math.floor((this.tui.terminal.rows || 24) * 0.8));
		const headerLines = 3, footerLines = 3, borderLines = 2;
		const innerWidth = Math.max(10, width - 2);
		const contentHeight = Math.max(1, maxHeight - headerLines - footerLines - borderLines);

		const mdLines = this.markdown.render(innerWidth);
		this.totalLines = mdLines.length;
		this.viewHeight = contentHeight;
		const maxScroll = Math.max(0, this.totalLines - contentHeight);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));

		const visibleLines = mdLines.slice(this.scrollOffset, this.scrollOffset + contentHeight);
		const lines: string[] = [];
		lines.push(this.buildTitleLine(innerWidth));
		lines.push(this.buildMetaLine(innerWidth));
		lines.push("");
		for (const l of visibleLines) lines.push(truncateToWidth(l, innerWidth));
		while (lines.length < headerLines + contentHeight) lines.push("");
		lines.push("");
		lines.push(this.buildActionLine(innerWidth));

		const bc = (s: string) => this.theme.fg("borderMuted", s);
		const top = bc(`┌${"─".repeat(innerWidth)}┐`);
		const bottom = bc(`└${"─".repeat(innerWidth)}┘`);
		const framed = lines.map((line) => {
			const t = truncateToWidth(line, innerWidth);
			const pad = Math.max(0, innerWidth - visibleWidth(t));
			return bc("│") + t + " ".repeat(pad) + bc("│");
		});
		return [top, ...framed, bottom].map((l) => truncateToWidth(l, width));
	}

	invalidate(): void {
		this.markdown = new Markdown(this.getMarkdownText(), 1, 0, getMarkdownTheme());
	}

	private buildTitleLine(width: number): string {
		const titleText = this.todo.title ? ` ${this.todo.title} ` : ` Todo ${formatTodoId(this.todo.id)} `;
		const tw = visibleWidth(titleText);
		if (tw >= width) return truncateToWidth(this.theme.fg("accent", titleText.trim()), width);
		const left = Math.floor((width - tw) / 2);
		const right = width - tw - left;
		return this.theme.fg("borderMuted", "─".repeat(left)) + this.theme.fg("accent", titleText) + this.theme.fg("borderMuted", "─".repeat(right));
	}

	private buildMetaLine(width: number): string {
		const status = this.todo.status || "open";
		const statusColor = isTodoClosed(status) ? "dim" : "success";
		const tagText = this.todo.tags.length ? this.todo.tags.join(", ") : "no tags";
		return truncateToWidth(
			this.theme.fg("accent", formatTodoId(this.todo.id)) +
			this.theme.fg("muted", " • ") +
			this.theme.fg(statusColor, status) +
			this.theme.fg("muted", " • ") +
			this.theme.fg("muted", tagText),
			width,
		);
	}

	private buildActionLine(width: number): string {
		const work = this.theme.fg("accent", "enter") + this.theme.fg("muted", " work on todo");
		const back = this.theme.fg("dim", "esc back");
		let line = [work, back].join(this.theme.fg("muted", " • "));
		if (this.totalLines > this.viewHeight) {
			const start = Math.min(this.totalLines, this.scrollOffset + 1);
			const end = Math.min(this.totalLines, this.scrollOffset + this.viewHeight);
			line += this.theme.fg("dim", ` ${start}-${end}/${this.totalLines}`);
		}
		return truncateToWidth(line, width);
	}

	private scrollBy(delta: number): void {
		const max = Math.max(0, this.totalLines - this.viewHeight);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset + delta, max));
	}
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function todosExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const dir = getTodosDir(ctx.cwd);
		await ensureTodosDir(dir);
		const settings = await readTodoSettings(dir);
		await garbageCollectTodos(dir, settings);
	});

	const todosDirLabel = getTodosDirLabel(process.cwd());

	// -----------------------------------------------------------------------
	// Tool
	// -----------------------------------------------------------------------

	pi.registerTool({
		name: "todo",
		label: "Todo",
		description:
			`Manage file-based todos in ${todosDirLabel} (list, list-all, get, create, update, append, delete, claim, release). ` +
			"Title is the short summary; body is long-form markdown notes (update replaces, append adds). " +
			"Todo ids are shown as TODO-<hex>; id parameters accept TODO-<hex> or the raw hex filename. " +
			"Claim tasks before working on them to avoid conflicts, and close them when complete.",
		parameters: TodoParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const dir = getTodosDir(ctx.cwd);
			const action: TodoAction = params.action;

			switch (action) {
				case "list": {
					const todos = await listTodos(dir);
					const { assigned, open } = splitTodosByAssignment(todos);
					const listed = [...assigned, ...open];
					const currentSessionId = ctx.sessionManager.getSessionId();
					return {
						content: [{ type: "text", text: serializeTodoListForAgent(listed) }],
						details: { action: "list", todos: listed, currentSessionId },
					};
				}

				case "list-all": {
					const todos = await listTodos(dir);
					const currentSessionId = ctx.sessionManager.getSessionId();
					return {
						content: [{ type: "text", text: serializeTodoListForAgent(todos) }],
						details: { action: "list-all", todos, currentSessionId },
					};
				}

				case "get": {
					if (!params.id) return { content: [{ type: "text", text: "Error: id required" }], details: { action: "get", error: "id required" } };
					const v = validateTodoId(params.id);
					if ("error" in v) return { content: [{ type: "text", text: v.error }], details: { action: "get", error: v.error } };
					const filePath = getTodoPath(dir, v.id);
					const todo = await ensureTodoExists(filePath, v.id);
					if (!todo) return { content: [{ type: "text", text: `Todo ${formatTodoId(v.id)} not found` }], details: { action: "get", error: "not found" } };
					return { content: [{ type: "text", text: serializeTodoForAgent(todo) }], details: { action: "get", todo } };
				}

				case "create": {
					if (!params.title) return { content: [{ type: "text", text: "Error: title required" }], details: { action: "create", error: "title required" } };
					await ensureTodosDir(dir);
					const id = await generateTodoId(dir);
					const filePath = getTodoPath(dir, id);
					const todo: TodoRecord = {
						id,
						title: params.title,
						tags: params.tags ?? [],
						status: params.status ?? "open",
						created_at: new Date().toISOString(),
						body: params.body ?? "",
					};
					const result = await withTodoLock(dir, id, ctx, async () => {
						await writeTodoFile(filePath, todo);
						return todo;
					});
					if (typeof result === "object" && "error" in result) {
						return { content: [{ type: "text", text: result.error }], details: { action: "create", error: result.error } };
					}
					return { content: [{ type: "text", text: serializeTodoForAgent(todo) }], details: { action: "create", todo } };
				}

				case "update": {
					if (!params.id) return { content: [{ type: "text", text: "Error: id required" }], details: { action: "update", error: "id required" } };
					const v = validateTodoId(params.id);
					if ("error" in v) return { content: [{ type: "text", text: v.error }], details: { action: "update", error: v.error } };
					const filePath = getTodoPath(dir, v.id);
					if (!existsSync(filePath)) return { content: [{ type: "text", text: `Todo ${formatTodoId(v.id)} not found` }], details: { action: "update", error: "not found" } };

					const result = await withTodoLock(dir, v.id, ctx, async () => {
						const existing = await ensureTodoExists(filePath, v.id);
						if (!existing) return { error: `Todo ${formatTodoId(v.id)} not found` } as const;
						if (params.title !== undefined) existing.title = params.title;
						if (params.status !== undefined) existing.status = params.status;
						if (params.tags !== undefined) existing.tags = params.tags;
						if (params.body !== undefined) existing.body = params.body;
						if (!existing.created_at) existing.created_at = new Date().toISOString();
						clearAssignmentIfClosed(existing);
						await writeTodoFile(filePath, existing);
						return existing;
					});
					if (typeof result === "object" && "error" in result) {
						return { content: [{ type: "text", text: result.error }], details: { action: "update", error: result.error } };
					}
					return { content: [{ type: "text", text: serializeTodoForAgent(result as TodoRecord) }], details: { action: "update", todo: result as TodoRecord } };
				}

				case "append": {
					if (!params.id) return { content: [{ type: "text", text: "Error: id required" }], details: { action: "append", error: "id required" } };
					const v = validateTodoId(params.id);
					if ("error" in v) return { content: [{ type: "text", text: v.error }], details: { action: "append", error: v.error } };
					const filePath = getTodoPath(dir, v.id);
					if (!existsSync(filePath)) return { content: [{ type: "text", text: `Todo ${formatTodoId(v.id)} not found` }], details: { action: "append", error: "not found" } };

					const result = await withTodoLock(dir, v.id, ctx, async () => {
						const existing = await ensureTodoExists(filePath, v.id);
						if (!existing) return { error: `Todo ${formatTodoId(v.id)} not found` } as const;
						if (!params.body?.trim()) return existing;
						return await appendTodoBody(filePath, existing, params.body!);
					});
					if (typeof result === "object" && "error" in result) {
						return { content: [{ type: "text", text: result.error }], details: { action: "append", error: result.error } };
					}
					return { content: [{ type: "text", text: serializeTodoForAgent(result as TodoRecord) }], details: { action: "append", todo: result as TodoRecord } };
				}

				case "claim": {
					if (!params.id) return { content: [{ type: "text", text: "Error: id required" }], details: { action: "claim", error: "id required" } };
					const result = await claimTodoAssignment(dir, params.id, ctx, Boolean(params.force));
					if (typeof result === "object" && "error" in result) {
						return { content: [{ type: "text", text: result.error }], details: { action: "claim", error: result.error } };
					}
					return { content: [{ type: "text", text: serializeTodoForAgent(result as TodoRecord) }], details: { action: "claim", todo: result as TodoRecord } };
				}

				case "release": {
					if (!params.id) return { content: [{ type: "text", text: "Error: id required" }], details: { action: "release", error: "id required" } };
					const result = await releaseTodoAssignment(dir, params.id, ctx, Boolean(params.force));
					if (typeof result === "object" && "error" in result) {
						return { content: [{ type: "text", text: result.error }], details: { action: "release", error: result.error } };
					}
					return { content: [{ type: "text", text: serializeTodoForAgent(result as TodoRecord) }], details: { action: "release", todo: result as TodoRecord } };
				}

				case "delete": {
					if (!params.id) return { content: [{ type: "text", text: "Error: id required" }], details: { action: "delete", error: "id required" } };
					const v = validateTodoId(params.id);
					if ("error" in v) return { content: [{ type: "text", text: v.error }], details: { action: "delete", error: v.error } };
					const result = await deleteTodo(dir, v.id, ctx);
					if (typeof result === "object" && "error" in result) {
						return { content: [{ type: "text", text: result.error }], details: { action: "delete", error: result.error } };
					}
					return { content: [{ type: "text", text: serializeTodoForAgent(result as TodoRecord) }], details: { action: "delete", todo: result as TodoRecord } };
				}
			}
		},

		renderCall(args, theme) {
			const action = typeof args.action === "string" ? args.action : "";
			const id = typeof args.id === "string" ? args.id : "";
			const nId = id ? normalizeTodoId(id) : "";
			const title = typeof args.title === "string" ? args.title : "";
			let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", action);
			if (nId) text += " " + theme.fg("accent", formatTodoId(nId));
			if (title) text += " " + theme.fg("dim", `"${title}"`);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as TodoToolDetails | undefined;
			if (isPartial) return new Text(theme.fg("warning", "Processing..."), 0, 0);
			if (!details) {
				const t = result.content[0];
				return new Text(t?.type === "text" ? t.text : "", 0, 0);
			}
			if (details.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);

			if (details.action === "list" || details.action === "list-all") {
				let text = renderTodoList(theme, details.todos, expanded, details.currentSessionId);
				if (!expanded) {
					const { closed } = splitTodosByAssignment(details.todos);
					if (closed.length) text = appendExpandHint(theme, text);
				}
				return new Text(text, 0, 0);
			}

			if (!details.todo) {
				const t = result.content[0];
				return new Text(t?.type === "text" ? t.text : "", 0, 0);
			}

			let text = renderTodoDetail(theme, details.todo, expanded);
			const labels: Record<string, string> = {
				create: "Created", update: "Updated", append: "Appended to",
				delete: "Deleted", claim: "Claimed", release: "Released",
			};
			const label = labels[details.action];
			if (label) {
				const lines = text.split("\n");
				lines[0] = theme.fg("success", "✓ ") + theme.fg("muted", `${label} `) + lines[0];
				text = lines.join("\n");
			}
			if (!expanded) text = appendExpandHint(theme, text);
			return new Text(text, 0, 0);
		},
	});

	// -----------------------------------------------------------------------
	// /todos command
	// -----------------------------------------------------------------------

	pi.registerCommand("todos", {
		description: "List and manage todos",
		getArgumentCompletions: (prefix: string) => {
			const todos = listTodosSync(getTodosDir(process.cwd()));
			if (!todos.length) return null;
			const matches = filterTodos(todos, prefix);
			if (!matches.length) return null;
			return matches.map((t) => {
				const tags = t.tags.length ? ` • ${t.tags.join(", ")}` : "";
				return {
					value: t.title || "(untitled)",
					label: `${formatTodoId(t.id)} ${t.title || "(untitled)"}`,
					description: `${t.status || "open"}${tags}`,
				};
			});
		},
		handler: async (args, ctx) => {
			const dir = getTodosDir(ctx.cwd);
			const todos = await listTodos(dir);
			const currentSessionId = ctx.sessionManager.getSessionId();
			const searchTerm = (args ?? "").trim();

			if (!ctx.hasUI) {
				console.log(formatTodoList(todos));
				return;
			}

			let nextPrompt: string | null = null;
			let rootTui: TUI | null = null;

			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				rootTui = tui;
				let selector: TodoSelectorComponent | null = null;
				let actionMenu: TodoActionMenuComponent | null = null;
				let deleteConfirm: TodoDeleteConfirmComponent | null = null;
				let activeComponent: {
					render: (width: number) => string[];
					invalidate: () => void;
					handleInput?: (data: string) => void;
					focused?: boolean;
				} | null = null;
				let wrapperFocused = false;

				const setActive = (
					comp: typeof activeComponent,
				) => {
					if (activeComponent && "focused" in activeComponent) activeComponent.focused = false;
					activeComponent = comp;
					if (activeComponent && "focused" in activeComponent) activeComponent.focused = wrapperFocused;
					tui.requestRender();
				};

				const copyPath = (todoId: string) => {
					try {
						copyToClipboard(path.resolve(getTodoPath(dir, todoId)));
						ctx.ui.notify("Copied path to clipboard", "info");
					} catch (e) {
						ctx.ui.notify(e instanceof Error ? e.message : String(e), "error");
					}
				};

				const copyText = (record: TodoRecord) => {
					const title = record.title || "(untitled)";
					const body = record.body?.trim() || "";
					try {
						copyToClipboard(body ? `# ${title}\n\n${body}` : `# ${title}`);
						ctx.ui.notify("Copied todo text to clipboard", "info");
					} catch (e) {
						ctx.ui.notify(e instanceof Error ? e.message : String(e), "error");
					}
				};

				const resolveRecord = async (todo: TodoFrontMatter): Promise<TodoRecord | null> => {
					const record = await ensureTodoExists(getTodoPath(dir, todo.id), todo.id);
					if (!record) ctx.ui.notify(`Todo ${formatTodoId(todo.id)} not found`, "error");
					return record;
				};

				const openOverlay = async (record: TodoRecord): Promise<TodoOverlayAction> => {
					const action = await ctx.ui.custom<TodoOverlayAction>(
						(overlayTui, overlayTheme, _kb, overlayDone) =>
							new TodoDetailOverlayComponent(overlayTui, overlayTheme, record, overlayDone),
						{ overlay: true, overlayOptions: { width: "80%", maxHeight: "80%", anchor: "center" } },
					);
					return action ?? "back";
				};

				const applyAction = async (record: TodoRecord, action: TodoMenuAction): Promise<"stay" | "exit"> => {
					if (action === "refine") {
						nextPrompt = buildRefinePrompt(record.id, record.title || "(untitled)");
						done();
						return "exit";
					}
					if (action === "work") {
						nextPrompt = `work on todo ${formatTodoId(record.id)} "${record.title || "(untitled)"}"`;
						done();
						return "exit";
					}
					if (action === "view") return "stay";
					if (action === "copyPath") { copyPath(record.id); return "stay"; }
					if (action === "copyText") { copyText(record); return "stay"; }
					if (action === "release") {
						const r = await releaseTodoAssignment(dir, record.id, ctx, true);
						if ("error" in r) { ctx.ui.notify(r.error, "error"); return "stay"; }
						selector?.setTodos(await listTodos(dir));
						ctx.ui.notify(`Released todo ${formatTodoId(record.id)}`, "info");
						return "stay";
					}
					if (action === "delete") {
						const r = await deleteTodo(dir, record.id, ctx);
						if ("error" in r) { ctx.ui.notify(r.error, "error"); return "stay"; }
						selector?.setTodos(await listTodos(dir));
						ctx.ui.notify(`Deleted todo ${formatTodoId(record.id)}`, "info");
						return "stay";
					}
					// close / reopen
					const nextStatus = action === "close" ? "closed" : "open";
					const r = await updateTodoStatus(dir, record.id, nextStatus, ctx);
					if ("error" in r) { ctx.ui.notify(r.error, "error"); return "stay"; }
					selector?.setTodos(await listTodos(dir));
					ctx.ui.notify(`${action === "close" ? "Closed" : "Reopened"} todo ${formatTodoId(record.id)}`, "info");
					return "stay";
				};

				const handleActionSelection = async (record: TodoRecord, action: TodoMenuAction) => {
					if (action === "view") {
						const overlayAction = await openOverlay(record);
						if (overlayAction === "work") { await applyAction(record, "work"); return; }
						if (actionMenu) setActive(actionMenu);
						return;
					}
					if (action === "delete") {
						const msg = `Delete todo ${formatTodoId(record.id)}? This cannot be undone.`;
						deleteConfirm = new TodoDeleteConfirmComponent(theme, msg, (confirmed) => {
							if (!confirmed) { setActive(actionMenu); return; }
							void (async () => { await applyAction(record, "delete"); setActive(selector); })();
						});
						setActive(deleteConfirm);
						return;
					}
					const result = await applyAction(record, action);
					if (result === "stay") setActive(selector);
				};

				const showActionMenu = async (todo: TodoFrontMatter | TodoRecord) => {
					const record = "body" in todo ? (todo as TodoRecord) : await resolveRecord(todo);
					if (!record) return;
					actionMenu = new TodoActionMenuComponent(
						theme,
						record,
						(action) => { void handleActionSelection(record, action); },
						() => { setActive(selector); },
					);
					setActive(actionMenu);
				};

				selector = new TodoSelectorComponent(
					tui, theme, todos,
					(todo) => { void showActionMenu(todo); },
					() => done(),
					searchTerm || undefined,
					currentSessionId,
					(todo, action) => {
						const title = todo.title || "(untitled)";
						nextPrompt = action === "refine"
							? buildRefinePrompt(todo.id, title)
							: `work on todo ${formatTodoId(todo.id)} "${title}"`;
						done();
					},
				);
				setActive(selector);

				return {
					get focused() { return wrapperFocused; },
					set focused(v: boolean) {
						wrapperFocused = v;
						if (activeComponent && "focused" in activeComponent) activeComponent.focused = v;
					},
					render(width: number) { return activeComponent ? activeComponent.render(width) : []; },
					invalidate() { activeComponent?.invalidate(); },
					handleInput(data: string) { activeComponent?.handleInput?.(data); },
				};
			});

			if (nextPrompt) {
				ctx.ui.setEditorText(nextPrompt);
				rootTui?.requestRender();
			}
		},
	});
}
